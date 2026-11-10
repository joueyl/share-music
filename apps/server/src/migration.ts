import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import type { MySqlDatabase } from './mysql';
import { isDeepStrictEqual } from 'node:util';
import type { RoomRecord } from './engine';
import { favoriteSongSchema, type TrackMetadata } from '../../../packages/shared/src';

export function readLegacy(path:string) {
  const source=new DatabaseSync(resolve(path),{readOnly:true});
  try {
    source.exec('BEGIN');
    const tables=new Set(source.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
    if(!tables.has('users')||!tables.has('rooms'))throw new Error('Not a music-share SQLite database');
    const read=(name:string)=>tables.has(name)?source.prepare(`SELECT * FROM ${name}`).all():[];
    const snapshot={users:read('users'),rooms:read('rooms'),assets:read('music_assets'),sources:read('music_sources'),details:read('music_details'),settings:read('settings'),favoriteSongs:read('user_favorite_songs')};
    // Validate cross references before opening a target transaction.
    const ids=new Set(snapshot.users.map(u=>u.id));
    for(const user of snapshot.users)if(user.netease_profile_url!=null&&!/^https:\/\/music\.163\.com\/user\?id=\d{1,20}$/.test(String(user.netease_profile_url)))throw new Error('Legacy user has an invalid music profile binding');
    for(const row of snapshot.favoriteSongs)if(!ids.has(row.user_id))throw new Error('Legacy favorite song has an invalid user');
    for(const r of snapshot.rooms){const record=JSON.parse(String(r.record));if(record.id!==r.id||!ids.has(record.hostId)||(record.creatorId&&!ids.has(record.creatorId)))throw new Error('Legacy room has an invalid owner or id');}
    source.exec('COMMIT');return snapshot;
  } finally {source.close();}
}
export type LegacySnapshot=ReturnType<typeof readLegacy>;
export const legacyCounts=(s:LegacySnapshot)=>Object.fromEntries(Object.entries(s).map(([key,rows])=>[key,rows.length]));
export async function migrateLegacy(target:MySqlDatabase,s:LegacySnapshot) {
  await target.initialize();
  return target.transaction(async db=>{
    // Import only into a fresh, stopped application's database. Never merge accounts or replace songs.
    for(const table of ['users','rooms','songs','room_tracks','music_assets','settings','user_favorite_songs']) {
      const [rows]=await db.pool.query<any[]>(`SELECT COUNT(*) AS total FROM ${table}`);
      if(Number(rows[0].total)!==0)throw new Error('Target is not empty; migration refused');
    }
    for(const u of s.users)await db.insertUser({id:String(u.id),name:String(u.name),passwordHash:String(u.password_hash),salt:String(u.salt),lastLoginIp:u.last_login_ip == null ? null : String(u.last_login_ip),neteaseProfileUrl:u.netease_profile_url==null?null:String(u.netease_profile_url)});
    for(const r of s.rooms)await db.saveRoom(JSON.parse(String(r.record)) as RoomRecord);
    for(const a of s.assets)await db.saveAsset(String(a.scope),String(a.hash),String(a.oss_key));
    for(const d of s.details)await db.saveMusicDetail(String(d.scope),String(d.source),JSON.parse(String(d.song)));
    for(const t of s.sources)await db.saveMusicSource(String(t.scope),String(t.source),JSON.parse(String(t.track)) as TrackMetadata);
    for(const v of s.settings)await db.setSetting(String(v.key),String(v.value));
    for(const row of s.favoriteSongs)await db.saveFavoriteSong(String(row.user_id),favoriteSongSchema.parse({source:row.source,id:row.song_id,name:row.name,artists:row.artists,album:row.album,coverUrl:row.cover_url,durationMs:Number(row.duration_ms),savedAt:Number(row.saved_at)}));
    for(const userId of new Set(s.favoriteSongs.map(row=>String(row.user_id)))){
      const saved=await db.listFavoriteSongs(userId),original=s.favoriteSongs.filter(row=>String(row.user_id)===userId);
      if(saved.length!==original.length)throw new Error('Favorite song verification failed');
      for(const row of original){const expected=favoriteSongSchema.parse({source:row.source,id:row.song_id,name:row.name,artists:row.artists,album:row.album,coverUrl:row.cover_url,durationMs:Number(row.duration_ms),savedAt:Number(row.saved_at)});if(!isDeepStrictEqual(saved.find(song=>song.source===expected.source&&song.id===expected.id),expected))throw new Error('Favorite song verification failed');}
    }
    // Verify inside the transaction: a mismatch rolls back every imported row.
    for(const u of s.users){const saved=await db.getUser(String(u.id));if(!saved||saved.passwordHash!==u.password_hash||saved.salt!==u.salt||saved.name!==u.name||(saved.lastLoginIp??null)!==(u.last_login_ip??null))throw new Error('User verification failed');if((await db.getUserMusicProfileUrl(String(u.id)))!==(u.netease_profile_url??null))throw new Error('User profile binding verification failed');}
    for(const a of s.assets)if(await db.getAsset(String(a.scope),String(a.hash))!==a.oss_key)throw new Error('Asset verification failed');
    for(const t of s.sources)if(!isDeepStrictEqual(await db.getMusicSource(String(t.scope),String(t.source)),JSON.parse(String(t.track))))throw new Error('Song verification failed');
    for(const d of s.details)if(!isDeepStrictEqual(await db.getMusicDetail(String(d.scope),String(d.source)),JSON.parse(String(d.song))))throw new Error('Song detail verification failed');
    for(const v of s.settings)if(await db.getSetting(String(v.key))!==v.value)throw new Error('Setting verification failed');
    const rooms=await db.rooms();if(rooms.length!==s.rooms.length)throw new Error('Room verification failed');
    for(const row of s.rooms){
      const old=JSON.parse(String(row.record)),saved=rooms.find(r=>r.id===old.id);
      if(!saved||saved.name!==old.name||saved.hostId!==old.hostId||(saved.creatorId??null)!==(old.creatorId??null)||!isDeepStrictEqual(saved.creatorInfo??null,old.creatorInfo??null)||!isDeepStrictEqual(saved.defaults,old.defaults)
        ||!isDeepStrictEqual(saved.overrides,old.overrides)||!isDeepStrictEqual(saved.playlist,old.playlist??[])
        ||(old.inviteCode&&saved.inviteCode!==old.inviteCode)||(old.settings&&!isDeepStrictEqual(saved.settings,old.settings)))throw new Error('Room verification failed');
    }
    return legacyCounts(s);
  });
}
