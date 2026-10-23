import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TrackMetadata } from '../../../packages/shared/src';
import type { RoomRecord } from './engine';
export type UserRecord = { id: string; name: string; passwordHash: string; salt: string };
export class Database {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS music_assets(scope TEXT NOT NULL,hash TEXT NOT NULL,oss_key TEXT NOT NULL,PRIMARY KEY(scope,hash)); CREATE TABLE IF NOT EXISTS music_sources(scope TEXT NOT NULL,source TEXT NOT NULL,track TEXT NOT NULL,PRIMARY KEY(scope,source)); CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,salt TEXT NOT NULL); CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY,record TEXT NOT NULL);');
  }
  getAsset(scope: string, hash: string): string | undefined { return (this.db.prepare('SELECT oss_key FROM music_assets WHERE scope=? AND hash=?').get(scope,hash) as {oss_key:string}|undefined)?.oss_key; }
  saveAsset(scope:string,hash:string,key:string) { this.db.prepare('INSERT INTO music_assets(scope,hash,oss_key) VALUES(?,?,?) ON CONFLICT(scope,hash) DO UPDATE SET oss_key=excluded.oss_key').run(scope,hash,key); }
  getMusicSource(scope:string,source:string): TrackMetadata | undefined { const row=this.db.prepare('SELECT track FROM music_sources WHERE scope=? AND source=?').get(scope,source) as {track:string}|undefined;return row?JSON.parse(row.track):undefined; }
  saveMusicSource(scope:string,source:string,track:TrackMetadata) { this.db.prepare('INSERT INTO music_sources(scope,source,track) VALUES(?,?,?) ON CONFLICT(scope,source) DO UPDATE SET track=excluded.track').run(scope,source,JSON.stringify(track)); }
  getSetting(key: string): string | undefined { return (this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined)?.value; }
  setSetting(key: string, value: string) { this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value); }
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
