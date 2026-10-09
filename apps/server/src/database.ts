import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RoomRecord } from './engine';
export type UserRecord = { id: string; name: string; passwordHash: string; salt: string };
export class Database {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,salt TEXT NOT NULL); CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY,record TEXT NOT NULL);');
  }
  findUser(name: string): UserRecord | undefined {
    const r = this.db.prepare('SELECT id,name,password_hash AS passwordHash,salt FROM users WHERE name=?').get(name);
    return r as UserRecord | undefined;
  }
  getUser(id: string): UserRecord | undefined { return this.db.prepare('SELECT id,name,password_hash AS passwordHash,salt FROM users WHERE id=?').get(id) as UserRecord | undefined; }
  insertUser(user: UserRecord) { this.db.prepare('INSERT INTO users(id,name,password_hash,salt) VALUES(?,?,?,?)').run(user.id, user.name, user.passwordHash, user.salt); }
  saveRoom(record: RoomRecord) { this.db.prepare('INSERT INTO rooms(id,record) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(record.id, JSON.stringify(record)); }
  rooms(): RoomRecord[] { return this.db.prepare('SELECT record FROM rooms').all().map(r => JSON.parse(r.record as string)); }
  close() { this.db.close(); }
}
