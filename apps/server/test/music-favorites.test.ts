import { afterEach,expect,it,vi } from 'vitest';
import { Database } from '../src/database';
import { MusicFavorites } from '../src/music-favorites';
import { ApiController } from '../src/controller';
import type { AppService } from '../src/app.service';
const databases:Database[]=[];afterEach(()=>{for(const db of databases.splice(0))db.close();});
function fixture(){const db=new Database(':memory:');databases.push(db);const api={call:vi.fn(async(name:string,{id}:{id:string})=>({code:200,...(name==='album'?{album:{id,name:'真实专辑',size:2,picUrl:'https://p1.music.126.net/cover.jpg'},songs:[]}:{playlist:{id,name:'真实歌单',trackCount:2,creator:{userId:123},coverImgUrl:'https://p1.music.126.net/cover.jpg'}})}))};return {db,api,service:new MusicFavorites(db,api)};}
it('persists per-TONE-user favorites, separates album/playlist IDs and makes repeat writes idempotent',async()=>{
 const f=fixture();expect(await f.service.list('a')).toEqual([]);await f.service.set('a','playlist','1',true);await f.service.set('a','playlist','1',true);await f.service.set('a','album','1',true);
 expect(await f.service.list('a')).toHaveLength(2);expect(await f.service.list('b')).toEqual([]);expect(f.api.call).toHaveBeenCalledTimes(2);
 const restored=new MusicFavorites(f.db,f.api);expect(await restored.list('a')).toHaveLength(2);await restored.set('a','playlist','1',false);expect(await restored.list('a')).toMatchObject([{kind:'album',id:'1'}]);
});
it('serializes concurrent changes and refuses fake upstream successes or corrupt stored data',async()=>{
 const f=fixture();await Promise.all([f.service.set('a','playlist','1',true),f.service.set('a','playlist','2',true)]);expect(await f.service.list('a')).toHaveLength(2);
 f.api.call.mockResolvedValueOnce({code:500} as any);await expect(f.service.set('a','album','3',true)).rejects.toThrow('NETEASE_INVALID_RESPONSE');expect(await f.service.list('a')).toHaveLength(2);
 f.db.setSetting('music.favorites.a','invalid');await expect(f.service.set('a','playlist','4',true)).rejects.toThrow('MUSIC_FAVORITES_INVALID');expect(f.db.getSetting('music.favorites.a')).toBe('invalid');
});
it('requires auth and rejects user/metadata injection on favorite routes',async()=>{
 const f=fixture(),app={flush:async()=>{},auth:{verify:vi.fn().mockResolvedValue({id:'a'})},limit:vi.fn(),musicFavorites:f.service} as unknown as AppService,controller=new ApiController(app);
 await expect(controller.setMusicFavorite({kind:'playlist',id:'1',saved:true})).rejects.toMatchObject({status:401});
 await expect(controller.setMusicFavorite({kind:'playlist',id:'1',saved:true,userId:'b'},'Bearer token')).rejects.toMatchObject({status:400});
 expect(await controller.setMusicFavorite({kind:'playlist',id:'1',saved:true},'Bearer token')).toMatchObject({collections:[{id:'1',name:'真实歌单'}]});expect(await f.service.list('b')).toEqual([]);
});
