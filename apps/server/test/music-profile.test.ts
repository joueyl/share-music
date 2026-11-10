import { expect,it,vi } from 'vitest';
import { MusicProfile } from '../src/music-profile';
import { ApiController } from '../src/controller';
import type { AppService } from '../src/app.service';
function fixture(){
 const settings=new Map<string,string>(),bindings=new Map<string,string|null>();
 const db={getUserMusicProfileUrl:vi.fn(async(id:string)=>bindings.get(id)??null),setUserMusicProfileUrl:vi.fn(async(id:string,url:string|null)=>{bindings.set(id,url);settings.delete('music.profile.'+id);}),getSetting:vi.fn(async(key:string)=>settings.get(key)??null),setSetting:vi.fn(async(key:string,value:string)=>{settings.set(key,value);})};
 const upstream={call:vi.fn(async(_name:string,{uid}:{uid:unknown})=>({code:200,profile:{userId:uid,nickname:'真实昵称',avatarUrl:'http://p1.music.126.net/avatar.jpg',signature:'签名',cookie:'private'}}))};
 return {db,upstream,service:new MusicProfile(db,upstream)};
}
it('validates upstream identity and persists only the per-user public-profile reference',async()=>{
 const f=fixture();expect(await f.service.get('a')).toBeNull();
 expect(await f.service.set('a','https://music.163.com/#/user?id=123')).toEqual({source:'netease',id:'123',nickname:'真实昵称',avatarUrl:'https://p1.music.126.net/avatar.jpg',signature:'签名'});
 expect(f.upstream.call).toHaveBeenCalledWith('user_detail',{uid:'123'});
 expect(await f.service.get('b')).toBeNull();expect(await new MusicProfile(f.db,f.upstream).get('a')).toMatchObject({id:'123'});
 expect(f.db.setUserMusicProfileUrl).toHaveBeenCalledWith('a','https://music.163.com/user?id=123');expect(f.db.setSetting).not.toHaveBeenCalled();
 f.upstream.call.mockResolvedValueOnce({code:200,profile:{userId:'999',nickname:'错人'}} as any);
 await expect(f.service.set('a','https://music.163.com/user?id=456')).rejects.toThrow('MUSIC_PROFILE_UNAVAILABLE');
 expect(await f.service.get('a')).toMatchObject({id:'123'});
});
it('rejects unsupported QQ, non-profile and arbitrary URLs without reading a different account',async()=>{
 const f=fixture();
 await expect(f.service.set('a','https://y.qq.com/n/ryqq/profile/123')).rejects.toThrow('QQ_PUBLIC_PROFILE_UNSUPPORTED');
 await expect(f.service.set('a','https://music.163.com/playlist?id=123')).rejects.toThrow('MUSIC_PROFILE_LINK_REQUIRED');
 for(const url of ['https://music.163.com.evil.test/user?id=1','https://evil.test/user?id=1','https://user@music.163.com/user?id=1'])await expect(f.service.set('a',url)).rejects.toThrow('MUSIC_LINK_INVALID');
 expect(f.upstream.call).not.toHaveBeenCalled();expect(f.db.setUserMusicProfileUrl).not.toHaveBeenCalled();
});
it('serializes replacement and unlink; corrupt storage is not reported as unbound',async()=>{
 const f=fixture();await Promise.all([f.service.set('a','https://music.163.com/user?id=123'),f.service.set('a',null)]);expect(await f.service.get('a')).toBeNull();
 await f.db.setSetting('music.profile.a','bad');await expect(f.service.get('a')).rejects.toThrow('MUSIC_PROFILE_INVALID');
});
it('requires authentication, rejects injected user IDs and accepts explicit unlink only',async()=>{
 const f=fixture(),controller=new ApiController({flush:async()=>{},auth:{verify:async()=>({id:'a'})},limit:vi.fn(),musicProfile:f.service} as unknown as AppService);
 await expect(controller.musicProfile()).rejects.toMatchObject({status:401});
 await expect(controller.setMusicProfile({input:null,userId:'b'},'Bearer token')).rejects.toMatchObject({status:400});
 await expect(controller.setMusicProfile({},'Bearer token')).rejects.toMatchObject({status:400});
 expect(await controller.setMusicProfile({input:'https://music.163.com/user?id=123'},'Bearer token')).toMatchObject({profile:{id:'123'}});
 expect(await controller.musicProfile('Bearer token')).toMatchObject({profile:{nickname:'真实昵称'}});
 expect(await controller.setMusicProfile({input:null},'Bearer token')).toEqual({profile:null});
});

it('migrates legacy settings to the private user link once, including when the upstream is unavailable',async()=>{
 const f=fixture();await f.db.setSetting('music.profile.a','{"source":"netease","id":"123"}');f.upstream.call.mockRejectedValueOnce(Error('OFFLINE'));
 await expect(f.service.get('a')).rejects.toThrow('OFFLINE');expect(await f.db.getUserMusicProfileUrl('a')).toBe('https://music.163.com/user?id=123');expect(await f.db.getSetting('music.profile.a')).toBeNull();
 expect(await new MusicProfile(f.db,f.upstream).get('a')).toMatchObject({id:'123'});expect(f.db.setUserMusicProfileUrl).toHaveBeenCalledTimes(1);
 await f.service.set('a',null);expect(await f.service.get('a')).toBeNull();expect(await new MusicProfile(f.db,f.upstream).get('a')).toBeNull();
});
it('serializes old-binding migration with replacement and unlink so an old reference cannot resurrect',async()=>{
 const f=fixture();await f.db.setSetting('music.profile.a','{"source":"netease","id":"123"}');
 await Promise.all([f.service.get('a'),f.service.set('a','https://music.163.com/user?id=456'),f.service.set('a',null)]);
 expect(await f.db.getUserMusicProfileUrl('a')).toBeNull();expect(await f.db.getSetting('music.profile.a')).toBeNull();expect(await f.service.get('a')).toBeNull();
});
it('does not rewrite corrupt old or new stored profile bindings as successful unbound data',async()=>{
 const f=fixture();await f.db.setUserMusicProfileUrl('a','https://evil.test/user?id=123');await expect(f.service.get('a')).rejects.toThrow('MUSIC_PROFILE_INVALID');expect(f.upstream.call).not.toHaveBeenCalled();
 expect(await f.db.getUserMusicProfileUrl('a')).toBe('https://evil.test/user?id=123');
});
it('does not replace a verified binding when the database write fails',async()=>{
 const f=fixture();await f.service.set('a','https://music.163.com/user?id=123');f.db.setUserMusicProfileUrl.mockRejectedValueOnce(Error('DATABASE_UNAVAILABLE'));
 await expect(f.service.set('a','https://music.163.com/user?id=456')).rejects.toThrow('DATABASE_UNAVAILABLE');expect(await f.service.get('a')).toMatchObject({id:'123'});
});
