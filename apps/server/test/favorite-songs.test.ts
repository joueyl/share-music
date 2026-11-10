import { afterEach,expect,it,vi } from 'vitest';
import { Database } from '../src/database';
import { FavoriteSongs } from '../src/favorite-songs';
import { ApiController } from '../src/controller';
import type { AppService } from '../src/app.service';
import { MYSQL_SCHEMA } from '../src/mysql-schema';
const databases:Database[]=[];afterEach(()=>{for(const db of databases.splice(0))db.close();});
function fixture(){
 const db=new Database(':memory:');databases.push(db);for(const id of ['a','b'])db.insertUser({id,name:id,passwordHash:'hash',salt:'salt'});
 const netease={call:vi.fn(async(_name:string,{ids}:{ids:string})=>({code:200,songs:[{id:ids,name:'真实歌曲',ar:[{name:'歌手'}],al:{name:'专辑',picUrl:'https://p1.music.126.net/cover.jpg'},dt:180000}]}))};
 const qq={songDetail:vi.fn(async(id:string)=>({id,name:'QQ歌曲',artists:'QQ歌手',album:'QQ专辑',coverUrl:'',durationMs:200000}))};
 return {db,netease,qq,service:new FavoriteSongs(db,netease,qq,()=>100)};
}
it('uses a dedicated user/source/song table, isolates users and preserves same-source idempotency',async()=>{
 const f=fixture();expect(await f.service.list('a')).toEqual([]);await f.service.set('a','netease','1',true);await f.service.set('a','netease','1',true);await f.service.set('a','qq','1',true);
 expect(f.netease.call).toHaveBeenCalledExactlyOnceWith('song_detail',{ids:'1'});expect(f.qq.songDetail).toHaveBeenCalledExactlyOnceWith('1');expect(await f.service.list('a')).toHaveLength(2);expect(await f.service.list('b')).toEqual([]);
 expect(f.db.getSetting('music.favorites.a')).toBeUndefined();expect(f.db.db.prepare('SELECT COUNT(*) AS n FROM user_favorite_songs').get()?.n).toBe(2);
 const restored=new FavoriteSongs(f.db,f.netease,f.qq);expect(await restored.list('a')).toMatchObject([{source:'netease',id:'1',savedAt:100},{source:'qq',id:'1'}]);
 await restored.set('a','netease','1',false);await restored.set('a','netease','1',false);expect(await restored.list('a')).toMatchObject([{source:'qq',id:'1'}]);
});
it('serializes writes without losing concurrent favorites and keeps existing songs on upstream failure',async()=>{
 const f=fixture();await Promise.all([f.service.set('a','netease','1',true),f.service.set('a','netease','2',true)]);expect(await f.service.list('a')).toHaveLength(2);
 f.netease.call.mockResolvedValueOnce({code:200,songs:[{id:'9',name:'错误歌曲'}]} as any);await expect(f.service.set('a','netease','3',true)).rejects.toThrow('NETEASE_INVALID_RESPONSE');expect(await f.service.list('a')).toHaveLength(2);
 await f.service.set('a','netease','3',true);expect(await f.service.list('a')).toHaveLength(3);
});
it('requires auth, rejects metadata/user injection and invalid IDs, and always scopes reads to the token user',async()=>{
 const f=fixture(),app={flush:async()=>{},auth:{verify:vi.fn(async()=>({id:'a'}))},limit:vi.fn(),favoriteSongs:f.service} as unknown as AppService,controller=new ApiController(app);
 await expect(controller.favoriteSongs()).rejects.toMatchObject({status:401});
 for(const body of [{source:'netease',id:'abc',saved:true},{source:'local',id:'1',saved:true},{source:'netease',id:'1',saved:true,userId:'b'},{source:'qq',id:'abc',saved:true,name:'fake'}])await expect(controller.setFavoriteSong(body,'Bearer token')).rejects.toMatchObject({status:400});
 expect(f.netease.call).not.toHaveBeenCalled();expect(f.qq.songDetail).not.toHaveBeenCalled();
 expect(await controller.setFavoriteSong({source:'netease',id:'1',saved:true},'Bearer token')).toMatchObject({songs:[{id:'1',name:'真实歌曲'}]});
 expect(await controller.favoriteSongs('Bearer token')).toMatchObject({songs:[{id:'1'}]});expect(await f.service.list('b')).toEqual([]);
});
it('rejects corrupt stored metadata instead of returning a successful empty list',async()=>{
 const f=fixture();f.db.db.prepare('INSERT INTO user_favorite_songs VALUES(?,?,?,?,?,?,?,?,?)').run('a','netease','1','真实歌曲','','','',-1,0);
 await expect(f.service.list('a')).rejects.toThrow('FAVORITE_SONGS_INVALID');
});
it('enforces the collection limit without metadata requests or partial writes',async()=>{
 const db={listFavoriteSongs:vi.fn(async()=>Array.from({length:5000},(_,i)=>({source:'netease',id:String(i+1),name:'歌曲',artists:'',album:'',coverUrl:'',durationMs:1,savedAt:0}))),saveFavoriteSong:vi.fn(),removeFavoriteSong:vi.fn()},netease={call:vi.fn()},qq={songDetail:vi.fn()},service=new FavoriteSongs(db,netease,qq);
 await expect(service.set('a','netease','5001',true)).rejects.toThrow('FAVORITE_SONGS_FULL');expect(netease.call).not.toHaveBeenCalled();expect(db.saveFavoriteSong).not.toHaveBeenCalled();
});
it('adds an indexed MySQL table with user FK and source-aware uniqueness without dropping existing data',()=>{
 const sql=MYSQL_SCHEMA.join('\n');expect(sql).toContain('CREATE TABLE IF NOT EXISTS user_favorite_songs');expect(sql).toContain('PRIMARY KEY(user_id,source,song_id)');expect(sql).toContain('REFERENCES users(id) ON DELETE CASCADE');expect(sql).toContain('idx_favorite_songs_user_saved');expect(sql).not.toMatch(/DROP TABLE|TRUNCATE/i);
});
