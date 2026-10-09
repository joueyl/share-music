import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { RoomSnapshot } from '../../../packages/shared/src';
import { Auth } from './auth';
import { Database } from './database';
import { RoomEngine, DomainError } from './engine';
import { Capacity } from './capacity';
import { PublicTurn } from './turn';
@Injectable()
export class AppService implements OnModuleDestroy {
  readonly database = new Database(process.env.DATABASE_PATH ?? './data/music-share.sqlite');
  readonly auth: Auth;
  readonly capacity = new Capacity();
  readonly turn = new PublicTurn();
  readonly publicCapacity = new Capacity(Date.now, this.turn.budget);
  readonly engine: RoomEngine;
  readonly subscribers = new Set<(room: RoomSnapshot) => void>();
  private ticker: ReturnType<typeof setInterval>;
  private attempts = new Map<string, { count: number; since: number }>();
  constructor() {
    let secret = process.env.TOKEN_SECRET;
    if (!secret) {
      if (process.env.NODE_ENV === 'production') throw new Error('TOKEN_SECRET is required in production');
      secret = randomBytes(32).toString('hex'); console.warn('Development token secret is ephemeral: sessions expire after restart.');
    }
    this.turn.stun(); // Fail fast on invalid STUN configuration.
    this.auth = new Auth(this.database, secret);
    this.engine = new RoomEngine(r => this.database.saveRoom(r), r => this.subscribers.forEach(fn => fn(r)));
    const records = this.database.rooms(); this.engine.restore(records); this.engine.restoreOverrides(records);
    this.ticker = setInterval(() => this.engine.tick(), 50); this.ticker.unref();
  }
  limit(key: string, maximum: number, windowMs: number) {
    const now = Date.now(); let record = this.attempts.get(key);
    if (!record || now - record.since >= windowMs) { record = { count: 0, since: now }; this.attempts.set(key, record); }
    if (++record.count > maximum) throw new DomainError('RATE_LIMITED');
    if (this.attempts.size > 10000) for (const [k, v] of this.attempts) if (now - v.since > windowMs) this.attempts.delete(k);
  }
  onModuleDestroy() { clearInterval(this.ticker); this.database.close(); }
}
