import { createPool, type Pool, type PoolConnection, type RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { trackSchema, roomSettingsSchema, type TrackMetadata, type Track } from '../../../packages/shared/src';
import { songInfo, type DatabaseStore, type UserRecord } from './database';
import type { RoomRecord } from './engine';
import { MYSQL_SCHEMA } from './mysql-schema';
import { DomainError } from './engine';

const json = (v: any): any => typeof v === 'string' ? JSON.parse(v) : v;
type Executor = Pick<PoolConnection, 'execute' | 'query'>;
export function mysqlPool(url: string): Pool {
  let parsed:URL;try{parsed=new URL(url);}catch{throw new Error('Invalid DATABASE_URL');}
  if (parsed.protocol !== 'mysql:' || !parsed.pathname.slice(1)) throw new Error('DATABASE_URL must specify a MySQL database');
  return createPool({ host:parsed.hostname, port:Number(parsed.port || 3306), user:decodeURIComponent(parsed.username),
    password:decodeURIComponent(parsed.password), database:decodeURIComponent(parsed.pathname.slice(1)),
    charset:'utf8mb4', connectionLimit:10, waitForConnections:true, queueLimit:100, connectTimeout:10000,
    ...(process.env.MYSQL_SSL_CA ? {ssl:{ca:readFileSync(process.env.MYSQL_SSL_CA),rejectUnauthorized:true}} : {}),
  });
}
/** No synchronous SQL and no silent fallback. The room engine remains single-process. */
export class MySqlDatabase implements DatabaseStore {
  constructor(readonly pool: Pool, private executor: Executor = pool) {}
  async initialize() {
    for(const statement of MYSQL_SCHEMA)await this.executor.query(statement);
    const [columns]=await this.executor.query<RowDataPacket[]>("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='songs'");
    const names=new Set(columns.map(c=>c.COLUMN_NAME));
    if(!names.has('source_url'))await this.executor.query('ALTER TABLE songs ADD COLUMN source_url TEXT NULL');
    if(!names.has('source_expires_at'))await this.executor.query('ALTER TABLE songs ADD COLUMN source_expires_at BIGINT UNSIGNED NULL');
    await this.executor.query('INSERT IGNORE INTO schema_migrations(version) VALUES(2)');
  }
  private async rows(sql:string, params:any[] = []):Promise<RowDataPacket[]> {
    try {const [rows] = await this.executor.execute<RowDataPacket[]>(sql,params); return rows;}catch{throw new DomainError('DATABASE_UNAVAILABLE');}
  }
  private async run(sql:string, params:any[]) { try{await this.executor.execute(sql,params);}catch(e){if((e as {code?:string}).code==='ER_DUP_ENTRY')throw new DomainError('DUPLICATE_RECORD');throw new DomainError('DATABASE_UNAVAILABLE');} }
  async transaction<T>(work:(db:MySqlDatabase)=>Promise<T>):Promise<T> {
    const connection=await this.pool.getConnection();
    try { await connection.beginTransaction();const value=await work(new MySqlDatabase(this.pool,connection));await connection.commit();return value; }
    catch(e) { await connection.rollback();throw e; } finally {connection.release();}
  }
  async getAsset(scope:string,hash:string) { return (await this.rows('SELECT oss_key FROM music_assets WHERE scope=? AND hash=?',[scope,hash]))[0]?.oss_key as string|undefined; }
  async listAssets(scope:string) { return (await this.rows('SELECT hash AS contentHash,oss_key AS ossKey FROM music_assets WHERE scope=?',[scope])) as {contentHash:string;ossKey:string}[]; }
  async saveAsset(scope:string,hash:string,key:string) { await this.run('INSERT INTO music_assets(scope,hash,oss_key) VALUES(?,?,?) ON DUPLICATE KEY UPDATE oss_key=VALUES(oss_key)',[scope,hash,key]); }
  async getMusicSource(scope:string,source:string):Promise<TrackMetadata|undefined> {
    const row=(await this.rows('SELECT track_json FROM songs WHERE scope=? AND source=?',[scope,source]))[0];return row?.track_json ? json(row.track_json) : undefined;
  }
  async getMusicSourceByHash(scope:string,hash:string):Promise<{source:string;track:TrackMetadata}|undefined> {
    const row=(await this.rows('SELECT source,track_json FROM songs WHERE scope=? AND content_hash=? AND track_json IS NOT NULL ORDER BY (detail_json IS NOT NULL) DESC,sequence DESC LIMIT 1',[scope,hash]))[0];
    return row?{source:row.source,track:json(row.track_json)}:undefined;
  }
  async saveMusicSource(scope:string,source:string,track:TrackMetadata) {
    const info=songInfo(track,await this.getMusicDetail(scope,source));
    await this.run(`INSERT INTO songs(scope,source,content_hash,name,artists,album,cover_url,duration_ms,size_bytes,lossless,bitrate_bps,sample_rate,bits,channels,oss_key,netease_id,track_json,source_url,source_expires_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE content_hash=VALUES(content_hash),name=VALUES(name),artists=VALUES(artists),album=VALUES(album),cover_url=VALUES(cover_url),duration_ms=VALUES(duration_ms),size_bytes=VALUES(size_bytes),lossless=VALUES(lossless),bitrate_bps=VALUES(bitrate_bps),sample_rate=VALUES(sample_rate),bits=VALUES(bits),channels=VALUES(channels),oss_key=VALUES(oss_key),netease_id=VALUES(netease_id),track_json=VALUES(track_json),source_url=VALUES(source_url),source_expires_at=VALUES(source_expires_at)`,
      [scope,source,track.contentHash??null,track.name??'',info.artists,info.album,info.coverUrl,track.durationMs??null,track.sizeBytes??null,track.lossless??false,track.bitrateBps??null,track.spec?.sampleRate??null,track.spec?.bits??null,track.spec?.channels??null,track.ossKey??null,track.neteaseId??(/^netease:standard:(\d+)$/.exec(source)?.[1]??null),JSON.stringify(track),track.sourceUrl??null,track.sourceExpiresAt??null]);
  }
  async saveMusicDetail(scope:string,source:string,song:unknown) { await this.run('INSERT INTO songs(scope,source,detail_json) VALUES(?,?,?) ON DUPLICATE KEY UPDATE detail_json=VALUES(detail_json)',[scope,source,JSON.stringify(song)]); }
  async getMusicDetail(scope:string,source:string):Promise<unknown> { const row=(await this.rows('SELECT detail_json FROM songs WHERE scope=? AND source=?',[scope,source]))[0];return row?.detail_json?json(row.detail_json):undefined; }
  async uploadedTrack(scope:string,hash:string):Promise<TrackMetadata|undefined> {
    const key=await this.getAsset(scope,hash);if(!key)return undefined;
    const row=(await this.rows('SELECT source,track_json,detail_json FROM songs WHERE scope=? AND content_hash=? AND oss_key=? AND track_json IS NOT NULL ORDER BY (detail_json IS NOT NULL) DESC,sequence DESC LIMIT 1',[scope,hash,key]))[0];
    if(!row)return undefined; const track=json(row.track_json),detail=json(row.detail_json),neteaseId=/^netease:standard:(\d{1,20})$/.exec(row.source)?.[1];
    const parsed=trackSchema.safeParse({...track,...songInfo(track,detail),...(neteaseId?{neteaseId}:{})});return parsed.success?parsed.data:undefined;
  }
  async uploadedMusic(scope:string,query:string,offset:number,limit:number) {
    const sql=`FROM music_assets a LEFT JOIN songs s ON s.sequence=(SELECT c.sequence FROM songs c WHERE c.scope=a.scope AND c.content_hash=a.hash AND c.oss_key=a.oss_key AND c.track_json IS NOT NULL ORDER BY (c.detail_json IS NOT NULL) DESC,c.sequence DESC LIMIT 1)
      WHERE a.scope=? AND LOCATE(LOWER(?),LOWER(CONCAT(a.oss_key,' ',COALESCE(CAST(s.track_json AS CHAR),''),' ',COALESCE(CAST(s.detail_json AS CHAR),''))))>0`;
    const total=Number((await this.rows(`SELECT COUNT(*) AS total ${sql}`,[scope,query]))[0].total);
    const rows=await this.rows(`SELECT a.hash,a.oss_key,s.track_json,s.detail_json ${sql} ORDER BY a.sequence DESC LIMIT ? OFFSET ?`,[scope,query,limit,offset]);
    return {total,songs:rows.map(row=>{const track=json(row.track_json)??{},detail=json(row.detail_json),info=songInfo(track,detail);
      return {id:row.hash as string,name:track.name||detail?.name||String(row.oss_key).split('/').at(-1)||'未知音乐',...info,coverUrl:info.coverUrl??'',canAdd:trackSchema.safeParse({...track,...info}).success,durationMs:track.durationMs??null,sizeBytes:track.sizeBytes??null};})};
  }
  async findMusicByHash(hash:string):Promise<{source:string;track:TrackMetadata}|undefined> {
    const row=(await this.rows("SELECT source,track_json FROM songs WHERE content_hash=? AND source LIKE 'netease:standard:%' AND track_json IS NOT NULL ORDER BY (scope='netease') DESC,sequence DESC LIMIT 1",[hash]))[0];
    return row?{source:row.source,track:json(row.track_json)}:undefined;
  }
  async musicLibrary(query:string,offset:number,limit:number) {
    const cte=`WITH ranked AS (SELECT source,track_json,name,artists,album,content_hash,cover_url,duration_ms,size_bytes,sequence,ROW_NUMBER() OVER(PARTITION BY COALESCE(NULLIF(content_hash,''),source) ORDER BY (scope='netease') DESC,sequence DESC) AS ranking FROM songs WHERE source LIKE 'netease:standard:%' AND track_json IS NOT NULL)`;
    const where="FROM ranked WHERE ranking=1 AND LOCATE(LOWER(?),LOWER(CONCAT(name,' ',artists,' ',album)))>0";
    const total=Number((await this.rows(`${cte} SELECT COUNT(*) AS total ${where}`,[query]))[0].total);
    const rows=await this.rows(`${cte} SELECT * ${where} ORDER BY sequence DESC LIMIT ? OFFSET ?`,[query,limit,offset]);
    return {total,songs:rows.map(r=>{const track=json(r.track_json),neteaseId=/^netease:standard:(\d{1,20})$/.exec(r.source)?.[1];return {id:String(r.content_hash??''),name:r.name,artists:r.artists,album:r.album,coverUrl:r.cover_url??'',durationMs:r.duration_ms??null,sizeBytes:r.size_bytes===null?null:Number(r.size_bytes),canAdd:!!neteaseId,neteaseId};})};
  }
  async getSetting(key:string) { return (await this.rows('SELECT value FROM settings WHERE setting_key=?',[key]))[0]?.value as string|undefined; }
  async setSetting(key:string,value:string) { await this.run('INSERT INTO settings(setting_key,value) VALUES(?,?) ON DUPLICATE KEY UPDATE value=VALUES(value)',[key,value]); }
  async findUser(name:string):Promise<UserRecord|undefined> { return (await this.rows('SELECT id,name,email,display_name AS displayName,avatar_url AS avatarUrl,password_hash AS passwordHash,salt FROM users WHERE name=? LIMIT 1',[name]))[0] as UserRecord|undefined; }
  async getUser(id:string):Promise<UserRecord|undefined> { return (await this.rows('SELECT id,name,email,display_name AS displayName,avatar_url AS avatarUrl,password_hash AS passwordHash,salt FROM users WHERE id=?',[id]))[0] as UserRecord|undefined; }
  async insertUser(user:UserRecord) { await this.run('INSERT INTO users(id,name,email,display_name,avatar_url,password_hash,salt) VALUES(?,?,?,?,?,?,?)',[user.id,user.name,user.email??null,user.displayName??user.name,user.avatarUrl??null,user.passwordHash,user.salt]); }
  async saveRoom(record:RoomRecord):Promise<void> {
    // A room row and its ordered queue always commit together.
    if(this.executor===this.pool)return this.transaction(db=>db.saveRoom(record));
    const s=record.settings??roomSettingsSchema.parse({});
    await this.run(`INSERT INTO rooms(id,name,host_id,description,atmosphere,visibility,category,cover_url,invite_code,defaults_json,overrides_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE name=VALUES(name),host_id=VALUES(host_id),description=VALUES(description),atmosphere=VALUES(atmosphere),visibility=VALUES(visibility),category=VALUES(category),cover_url=VALUES(cover_url),defaults_json=VALUES(defaults_json),overrides_json=VALUES(overrides_json)`,
      [record.id,record.name,record.hostId,s.description,s.atmosphere,s.visibility,s.category,s.coverUrl,record.inviteCode??randomUUID().replaceAll('-','').slice(0,12),JSON.stringify(record.defaults),JSON.stringify(record.overrides)]);
    await this.run('DELETE FROM room_tracks WHERE room_id=?',[record.id]);
    for(const [index,t] of (record.playlist??[]).entries()) {
      // Queue entries already retain their complete metadata in room_tracks.
      // songs owns shared source metadata, not one copy per room/queue UUID.
      await this.run('INSERT INTO room_tracks(room_id,track_id,position,provider_id,track_json) VALUES(?,?,?,?,?)',[record.id,t.id,index,t.providerId,JSON.stringify(t)]);
    }
  }
  async rooms():Promise<RoomRecord[]> {
    const [rooms,tracks]=await Promise.all([this.rows('SELECT * FROM rooms ORDER BY created_at,id'),this.rows('SELECT room_id,track_json FROM room_tracks ORDER BY room_id,position')]);
    const queues=new Map<string,Track[]>();for(const t of tracks){const q=queues.get(t.room_id)??[];q.push(json(t.track_json));queues.set(t.room_id,q);}
    return rooms.map(r=>({id:r.id,name:r.name,hostId:r.host_id,defaults:json(r.defaults_json),overrides:json(r.overrides_json),inviteCode:r.invite_code,
      settings:{description:r.description,atmosphere:r.atmosphere,visibility:r.visibility,category:r.category,coverUrl:r.cover_url},playlist:queues.get(r.id)??[]}));
  }
  async close() { await this.pool.end(); }
}
