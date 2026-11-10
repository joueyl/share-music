import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FavoriteSong, TrackMetadata } from '../../../packages/shared/src';
import { normalizeAlbumCover, trackSchema } from '../../../packages/shared/src';
import { DomainError } from './engine';
import type { RoomRecord } from './engine';
export type UserRecord = { id: string; name: string; passwordHash: string; salt: string; lastLoginIp?: string|null; neteaseProfileUrl?: string|null; email?: string|null; displayName?: string; avatarUrl?: string|null };
export function songInfo(track:Partial<TrackMetadata>,detail:any) {
  const text=(value:unknown)=>typeof value==='string'?value.trim():'';
  const names=(value:unknown)=>Array.isArray(value)?[...new Set(value.map(a=>text(a?.name)).filter(Boolean))].join(' / '):'';
  return {artists:text(track.artists)||names(detail?.ar)||names(detail?.artists),
    album:text(track.album)||text(detail?.al?.name)||text(detail?.album?.name),
    coverUrl:normalizeAlbumCover(track.coverUrl)||normalizeAlbumCover(detail?.al?.picUrl)||normalizeAlbumCover(detail?.album?.picUrl)||null};
}
export class Database {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('CREATE TABLE IF NOT EXISTS music_details(scope TEXT NOT NULL,source TEXT NOT NULL,song TEXT NOT NULL,PRIMARY KEY(scope,source));');
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS music_assets(scope TEXT NOT NULL,hash TEXT NOT NULL,oss_key TEXT NOT NULL,PRIMARY KEY(scope,hash)); CREATE TABLE IF NOT EXISTS music_sources(scope TEXT NOT NULL,source TEXT NOT NULL,track TEXT NOT NULL,PRIMARY KEY(scope,source)); CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,salt TEXT NOT NULL); CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY,record TEXT NOT NULL);');
    this.db.exec(`CREATE TABLE IF NOT EXISTS user_favorite_songs (
      user_id TEXT NOT NULL, source TEXT NOT NULL, song_id TEXT NOT NULL, name TEXT NOT NULL,
      artists TEXT NOT NULL, album TEXT NOT NULL, cover_url TEXT NOT NULL, duration_ms INTEGER NOT NULL, saved_at INTEGER NOT NULL,
      PRIMARY KEY(user_id,source,song_id), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
      CREATE INDEX IF NOT EXISTS idx_favorite_songs_user_saved ON user_favorite_songs(user_id,saved_at DESC);`);
    if (!this.db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'last_login_ip')) this.db.exec('ALTER TABLE users ADD COLUMN last_login_ip TEXT NULL');
    if (!this.db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'netease_profile_url')) this.db.exec('ALTER TABLE users ADD COLUMN netease_profile_url TEXT NULL');
  }
  getAsset(scope: string, hash: string): string | undefined { return (this.db.prepare('SELECT oss_key FROM music_assets WHERE scope=? AND hash=?').get(scope,hash) as {oss_key:string}|undefined)?.oss_key; }
  saveAsset(scope:string,hash:string,key:string) { this.db.prepare('INSERT INTO music_assets(scope,hash,oss_key) VALUES(?,?,?) ON CONFLICT(scope,hash) DO UPDATE SET oss_key=excluded.oss_key').run(scope,hash,key); }
  uploadedMusic(scope:string,query:string,offset:number,limit:number) {
    // Assets are registered only after a successful upload (or OSS existence check).
    // Keep local uploads without song metadata visible too; one row per content hash.
    const sql=`WITH uploaded AS (
      SELECT a.hash,a.oss_key,a.rowid AS sequence,s.track,d.song
      FROM music_assets a
      LEFT JOIN music_sources s ON s.rowid=(
        SELECT candidate.rowid FROM music_sources candidate
        WHERE candidate.scope=a.scope AND json_extract(candidate.track,'$.contentHash')=a.hash
          AND json_extract(candidate.track,'$.ossKey')=a.oss_key
        ORDER BY EXISTS(SELECT 1 FROM music_details detail WHERE detail.scope=candidate.scope AND detail.source=candidate.source) DESC,candidate.rowid DESC LIMIT 1
      )
      LEFT JOIN music_details d ON d.scope=s.scope AND d.source=s.source
      WHERE a.scope=?
    ) SELECT * FROM uploaded WHERE instr(lower(oss_key || ' ' || coalesce(track,'') || ' ' || coalesce(song,'')),lower(?))>0`;
    const total=(this.db.prepare(`SELECT count(*) AS total FROM (${sql})`).get(scope,query) as {total:number}).total;
    const songs=this.db.prepare(`${sql} ORDER BY sequence DESC LIMIT ? OFFSET ?`).all(scope,query,limit,offset).map(row=>{
      const track:Partial<TrackMetadata>=row.track?JSON.parse(row.track as string):{};
      const detail=row.song?JSON.parse(row.song as string):null;
      const text=(value:unknown)=>typeof value==='string'?value.trim():'';
      // Older source records omit these fields even though full song details are saved.
      const {artists,album,coverUrl}=songInfo(track,detail);
      return {id:row.hash as string,name:text(track.name)||text(detail?.name)||String(row.oss_key).split('/').at(-1)||'未知音乐',
        artists,album,coverUrl:coverUrl??'',canAdd:trackSchema.safeParse({...track,...songInfo(track,detail)}).success,
        durationMs:track.durationMs??null,sizeBytes:track.sizeBytes??null};
    });
    return {songs,total};
  }
  uploadedTrack(scope:string,hash:string):TrackMetadata|undefined {
    const key=this.getAsset(scope,hash);if(!key)return undefined;
    const row=this.db.prepare(`SELECT s.source,s.track,d.song FROM music_sources s
      LEFT JOIN music_details d ON d.scope=s.scope AND d.source=s.source
      WHERE s.scope=? AND json_extract(s.track,'$.contentHash')=? AND json_extract(s.track,'$.ossKey')=?
      ORDER BY (d.song IS NOT NULL) DESC,s.rowid DESC LIMIT 1`).get(scope,hash,key);
    if(!row)return undefined;
    const track=JSON.parse(row.track as string),detail=row.song?JSON.parse(row.song as string):null;
    const neteaseId=/^netease:standard:(\d{1,20})$/.exec(row.source as string)?.[1];
    const parsed=trackSchema.safeParse({...track,...songInfo(track,detail),...(neteaseId?{neteaseId}:{})});
    return parsed.success?parsed.data:undefined;
  }
  getMusicSource(scope:string,source:string): TrackMetadata | undefined { const row=this.db.prepare('SELECT track FROM music_sources WHERE scope=? AND source=?').get(scope,source) as {track:string}|undefined;return row?JSON.parse(row.track):undefined; }
  getMusicSourceByHash(scope:string,hash:string): {source:string;track:TrackMetadata} | undefined {
    const row=this.db.prepare("SELECT source,track FROM music_sources WHERE scope=? AND json_extract(track,'$.contentHash')=? LIMIT 1").get(scope,hash) as {source:string;track:string}|undefined;
    return row?{source:row.source,track:JSON.parse(row.track)}:undefined;
  }
  saveMusicSource(scope:string,source:string,track:TrackMetadata) { this.db.prepare('INSERT INTO music_sources(scope,source,track) VALUES(?,?,?) ON CONFLICT(scope,source) DO UPDATE SET track=excluded.track').run(scope,source,JSON.stringify(track)); }
  saveMusicDetail(scope:string,source:string,song:unknown) { this.db.prepare('INSERT INTO music_details(scope,source,song) VALUES(?,?,?) ON CONFLICT(scope,source) DO UPDATE SET song=excluded.song').run(scope,source,JSON.stringify(song)); }
  getMusicDetail(scope:string,source:string):unknown { const row=this.db.prepare('SELECT song FROM music_details WHERE scope=? AND source=?').get(scope,source) as {song:string}|undefined; return row?JSON.parse(row.song):undefined; }
  findMusicByHash(hash:string): {source:string;track:TrackMetadata}|undefined {
    const row=this.db.prepare("SELECT source,track FROM music_sources WHERE json_extract(track,'$.contentHash')=? AND (source LIKE 'netease:standard:%' OR source LIKE 'qq:128:%') ORDER BY (scope='netease') DESC,rowid DESC LIMIT 1").get(hash) as {source:string;track:string}|undefined;
    return row?{source:row.source,track:JSON.parse(row.track)}:undefined;
  }
  musicLibrary(query:string,offset:number,limit:number) {
    const rows=this.db.prepare("SELECT source,track FROM music_sources WHERE (source LIKE 'netease:standard:%' OR source LIKE 'qq:128:%') ORDER BY (scope='netease') DESC,rowid DESC").all();
    const seen=new Set<string>();const songs=[];
    for(const row of rows){
      const track=JSON.parse(String(row.track)),key=String(track.contentHash||row.source);if(seen.has(key))continue;seen.add(key);
      const neteaseId=/^netease:standard:(\d{1,20})$/.exec(String(row.source))?.[1];
      if(!(String(track.name??'')+' '+String(track.artists??'')+' '+String(track.album??'')).toLowerCase().includes(query.toLowerCase()))continue;
      songs.push({id:String(track.contentHash??''),name:String(track.name??'未知音乐'),artists:String(track.artists??''),album:String(track.album??''),coverUrl:track.coverUrl??'',durationMs:track.durationMs??null,sizeBytes:track.sizeBytes??null,canAdd:!!neteaseId||!!track.qqId,neteaseId,...(track.qqId?{qqId:track.qqId}:{})});
    }
    return {total:songs.length,songs:songs.slice(offset,offset+limit)};
  }
  listFavoriteSongs(userId:string):FavoriteSong[] {
    return this.db.prepare('SELECT source,song_id AS id,name,artists,album,cover_url AS coverUrl,duration_ms AS durationMs,saved_at AS savedAt FROM user_favorite_songs WHERE user_id=? ORDER BY saved_at DESC,source,song_id').all(userId) as FavoriteSong[];
  }
  saveFavoriteSong(userId:string,song:FavoriteSong) {
    this.db.prepare('INSERT INTO user_favorite_songs(user_id,source,song_id,name,artists,album,cover_url,duration_ms,saved_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,source,song_id) DO NOTHING').run(userId,song.source,song.id,song.name,song.artists,song.album,song.coverUrl,song.durationMs,song.savedAt);
  }
  removeFavoriteSong(userId:string,source:FavoriteSong['source'],id:string) {
    this.db.prepare('DELETE FROM user_favorite_songs WHERE user_id=? AND source=? AND song_id=?').run(userId,source,id);
  }
  getSetting(key: string): string | undefined { return (this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined)?.value; }
  setSetting(key: string, value: string) { this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value); }
  getUserMusicProfileUrl(userId:string):string|null {
    const row=this.db.prepare('SELECT netease_profile_url AS url FROM users WHERE id=?').get(userId) as {url:string|null}|undefined;
    return row?.url??null;
  }
  setUserMusicProfileUrl(userId:string,url:string|null) {
    this.db.exec('SAVEPOINT music_profile_binding');
    try{
      const result=this.db.prepare('UPDATE users SET netease_profile_url=? WHERE id=?').run(url,userId);
      if(!result.changes)throw new DomainError('UNAUTHORIZED');
      this.db.prepare('DELETE FROM settings WHERE key=?').run('music.profile.'+userId);
      this.db.exec('RELEASE SAVEPOINT music_profile_binding');
    }catch(e){
      this.db.exec('ROLLBACK TO SAVEPOINT music_profile_binding');this.db.exec('RELEASE SAVEPOINT music_profile_binding');
      if(e instanceof DomainError)throw e;throw new DomainError('DATABASE_UNAVAILABLE');
    }
  }
  findUser(name: string): UserRecord | undefined {
    const r = this.db.prepare('SELECT id,name,password_hash AS passwordHash,salt,last_login_ip AS lastLoginIp FROM users WHERE name=?').get(name);
    return r as UserRecord | undefined;
  }
  getUser(id: string): UserRecord | undefined { return this.db.prepare('SELECT id,name,password_hash AS passwordHash,salt,last_login_ip AS lastLoginIp FROM users WHERE id=?').get(id) as UserRecord | undefined; }
  insertUser(user: UserRecord) { this.db.prepare('INSERT INTO users(id,name,password_hash,salt,last_login_ip,netease_profile_url) VALUES(?,?,?,?,?,?)').run(user.id, user.name, user.passwordHash, user.salt, user.lastLoginIp ?? null, user.neteaseProfileUrl ?? null); }
  updateLoginIp(id: string, ip: string|null) { this.db.prepare('UPDATE users SET last_login_ip=? WHERE id=?').run(ip, id); }
  saveRoom(record: RoomRecord) {
    const old = this.db.prepare('SELECT record FROM rooms WHERE id=?').get(record.id);
    const original = old ? JSON.parse(String(old.record)) as RoomRecord : record;
    const creatorId = original.creatorId ?? null, creatorInfo = original.creatorInfo ?? null;
    this.db.prepare('INSERT INTO rooms(id,record) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(record.id, JSON.stringify({...record, creatorId, creatorInfo}));
  }
  rooms(): RoomRecord[] { return this.db.prepare('SELECT record FROM rooms').all().map(r => JSON.parse(r.record as string)); }
  close() { this.db.close(); }
}

type Awaitable<T> = T | Promise<T>;
/** SQLite is retained for offline migration and isolated tests. */
export type DatabaseStore = { [K in Exclude<keyof Database, 'db'>]: Database[K] extends (...args: infer A) => infer R ? (...args: A) => Awaitable<R> : never };
