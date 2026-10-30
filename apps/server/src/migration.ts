import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import type { MySqlDatabase } from './mysql';
import { isDeepStrictEqual } from 'node:util';
import type { RoomRecord } from './engine';
import type { TrackMetadata } from '../../../packages/shared/src';

export function readLegacy(path:string) {
  const source=new DatabaseSync(resolve(path),{readOnly:true});
  try {
    source.exec('BEGIN');
    const tables=new Set(source.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
    if(!tables.has('users')||!tables.has('rooms'))throw new Error('Not a music-share SQLite database');
    const read=(name:string)=>tables.has(name)?source.prepare(`SELECT * FROM ${name}`).all():[];
    const snapshot={users:read('users'),rooms:read('rooms'),assets:read('music_assets'),sources:read('music_sources'),details:read('music_details'),settings:read('settings')};
    // Validate cross references before opening a target transaction.
    const ids=new Set(snapshot.users.map(u=>u.id));
    for(const r of snapshot.rooms){const record=JSON.parse(String(r.record));if(record.id!==r.id||!ids.has(record.hostId))throw new Error('Legacy room has an invalid owner or id');}
    source.exec('COMMIT');return snapshot;
  } finally {source.close();}
}
export type LegacySnapshot=ReturnType<typeof readLegacy>;
export const legacyCounts=(s:LegacySnapshot)=>Object.fromEntries(Object.entries(s).map(([key,rows])=>[key,rows.length]));
export async function migrateLegacy(target:MySqlDatabase,s:LegacySnapshot) {
  await target.initialize();
  return target.transaction(async db=>{
    // Import only into a fresh, stopped application's database. Never merge accounts or replace songs.
    for(const table of ['users','rooms','songs','room_tracks','music_assets','settings']) {
      const [rows]=await db.pool.query<any[]>(`SELECT COUNT(*) AS total FROM ${table}`);
      if(Number(rows[0].total)!==0)throw new Error('Target is not empty; migration refused');
    }
    for(const u of s.users)await db.insertUser({id:String(u.id),name:String(u.name),passwordHash:String(u.password_hash),salt:String(u.salt)});
    for(const r of s.rooms)await db.saveRoom(JSON.parse(String(r.record)) as RoomRecord);
    for(const a of s.assets)await db.saveAsset(String(a.scope),String(a.hash),String(a.oss_key));
    for(const d of s.details)await db.saveMusicDetail(String(d.scope),String(d.source),JSON.parse(String(d.song)));
    for(const t of s.sources)await db.saveMusicSource(String(t.scope),String(t.source),JSON.parse(String(t.track)) as TrackMetadata);
    for(const v of s.settings)await db.setSetting(String(v.key),String(v.value));
    // Verify inside the transaction: a mismatch rolls back every imported row.
    for(const u of s.users){const saved=await db.getUser(String(u.id));if(!saved||saved.passwordHash!==u.password_hash||saved.salt!==u.salt||saved.name!==u.name)throw new Error('User verification failed');}
    for(const a of s.assets)if(await db.getAsset(String(a.scope),String(a.hash))!==a.oss_key)throw new Error('Asset verification failed');
    for(const t of s.sources)if(!isDeepStrictEqual(await db.getMusicSource(String(t.scope),String(t.source)),JSON.parse(String(t.track))))throw new Error('Song verification failed');
    for(const d of s.details)if(!isDeepStrictEqual(await db.getMusicDetail(String(d.scope),String(d.source)),JSON.parse(String(d.song))))throw new Error('Song detail verification failed');
    for(const v of s.settings)if(await db.getSetting(String(v.key))!==v.value)throw new Error('Setting verification failed');
    const rooms=await db.rooms();if(rooms.length!==s.rooms.length)throw new Error('Room verification failed');
    for(const row of s.rooms){
      const old=JSON.parse(String(row.record)),saved=rooms.find(r=>r.id===old.id);
      if(!saved||saved.name!==old.name||saved.hostId!==old.hostId||!isDeepStrictEqual(saved.defaults,old.defaults)
        ||!isDeepStrictEqual(saved.overrides,old.overrides)||!isDeepStrictEqual(saved.playlist,old.playlist??[])
        ||(old.inviteCode&&saved.inviteCode!==old.inviteCode)||(old.settings&&!isDeepStrictEqual(saved.settings,old.settings)))throw new Error('Room verification failed');
    }
    return legacyCounts(s);
  });
}
