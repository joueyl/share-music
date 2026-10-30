import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { ChatMessage, RoomSnapshot } from '../../../packages/shared/src';
import { MusicImport } from './music-import';
import { NeteaseService } from './netease';
import { Auth } from './auth';
import { Database, type DatabaseStore } from './database';
import { MySqlDatabase, mysqlPool } from './mysql';
import { RoomEngine, DomainError } from './engine';
import { Capacity } from './capacity';
import { PublicTurn } from './turn';
function configuredDatabase(): DatabaseStore {
  const driver=process.env.DATABASE_DRIVER ?? 'mysql';
  if(driver==='sqlite') {
    if(process.env.NODE_ENV==='production')throw new Error('SQLite is not permitted in production');
    return new Database(process.env.DATABASE_PATH ?? ':memory:');
  }
  if(driver!=='mysql')throw new Error('Unsupported DATABASE_DRIVER');
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required for MySQL');
  return new MySqlDatabase(mysqlPool(process.env.DATABASE_URL));
}
@Injectable()
export class AppService implements OnModuleDestroy, OnModuleInit {
  readonly database = configuredDatabase();
  readonly netease = new NeteaseService(this.database);
  readonly auth: Auth;
  readonly capacity = new Capacity();
  readonly turn = new PublicTurn();
  readonly publicCapacity = new Capacity(Date.now, this.turn.budget);
  readonly engine: RoomEngine;
  readonly musicImport: MusicImport;
  readonly subscribers = new Set<(room: RoomSnapshot) => void>();
  readonly activitySubscribers = new Set<(message: ChatMessage) => void>();
  private ticker?: ReturnType<typeof setInterval>;
  private pending: Promise<void> = Promise.resolve();
  private persistenceFailed = false;
  private persist(record: Parameters<DatabaseStore['saveRoom']>[0]) {
    const copy=structuredClone(record);
    this.pending=this.pending.then(async()=>{if(this.persistenceFailed)throw new DomainError('DATABASE_UNAVAILABLE');await this.database.saveRoom(copy);}).catch(()=>{
      if(!this.persistenceFailed)console.error('Room persistence failed. Writes are disabled until the database is repaired and the service restarted.');
      this.persistenceFailed=true;
    });
  }
  async flush() { await this.pending;if(this.persistenceFailed)throw new DomainError('DATABASE_UNAVAILABLE'); }
  private attempts = new Map<string, { count: number; since: number }>();
  constructor() {
    let secret = process.env.TOKEN_SECRET;
    if (!secret) {
      if (process.env.NODE_ENV === 'production') throw new Error('TOKEN_SECRET is required in production');
      secret = randomBytes(32).toString('hex'); console.warn('Development token secret is ephemeral: sessions expire after restart.');
    }
    this.turn.stun(); // Fail fast on invalid STUN configuration.
    this.auth = new Auth(this.database, secret);
    this.engine = new RoomEngine(r => this.persist(r), r => { void this.flush().then(()=>this.subscribers.forEach(fn=>fn(r))).catch(()=>{}); }, Date.now, (key,hash)=>this.musicImport?.registered(key,hash)??false, message => { void this.flush().then(()=>this.activitySubscribers.forEach(fn=>fn(message))).catch(()=>{}); });
    this.musicImport = new MusicImport(this.engine, this.netease, fetch, this.database);
  }
  async onModuleInit() {
    if(this.database instanceof MySqlDatabase) {
      await this.database.initialize();
    }
    const records = await this.database.rooms(); this.engine.restore(records); this.engine.restoreOverrides(records);
    this.ticker = setInterval(() => { if(!this.persistenceFailed)this.engine.tick(); }, 50); this.ticker.unref();
  }
  limit(key: string, maximum: number, windowMs: number) {
    const now = Date.now(); let record = this.attempts.get(key);
    if (!record || now - record.since >= windowMs) { record = { count: 0, since: now }; this.attempts.set(key, record); }
    if (++record.count > maximum) throw new DomainError('RATE_LIMITED');
    if (this.attempts.size > 10000) for (const [k, v] of this.attempts) if (now - v.since > windowMs) this.attempts.delete(k);
  }
  async onModuleDestroy() { clearInterval(this.ticker); try {await this.flush();} finally {await this.database.close();} }
}
