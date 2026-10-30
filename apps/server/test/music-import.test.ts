import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Database } from '../src/database';
import { RoomEngine } from '../src/engine';
import { MusicImport, downloadMusic, musicDownloadUrl, mp3Spec, songFilename, songCover } from '../src/music-import';
const bytes=Buffer.concat([Buffer.from([255,251,144,0]),Buffer.alloc(1000)]);
const databases:Database[]=[];afterEach(()=>{for(const db of databases.splice(0))db.close();});
function fixture(){
 const db=new Database(':memory:');databases.push(db);let now=100000,version=1;
 const ref:{value?:MusicImport}={};const engine=new RoomEngine(undefined,undefined,()=>now,(url,hash)=>ref.value?.registered(url,hash)??false);
 const user=randomUUID(),room=engine.create('test',user);engine.join(room.id,{id:user,name:'host'});
 const call=vi.fn(async(method:string)=>method==='song_detail'?{songs:[{id:123,name:'测试歌曲',ar:[{name:'测试歌手'}],dt:120000,al:{name:'专辑',picUrl:'http://p1.music.126.net/cover.jpg'}}]}:{data:[{id:123,url:`https://m801.music.126.net/song.mp3?version=${version}`,code:200,type:'mp3',br:128000,expi:60}]} as any);
 const request=vi.fn(async(_url:unknown)=>new Response(bytes));
 const service=new MusicImport(engine,{call},request as typeof fetch,db,()=>now);ref.value=service;
 return {db,engine,user,room,call,request,service,ref,time:(value:number)=>now=value,version:(value:number)=>version=value};
}
it('persists the original music link and expiry, never an OSS object, while validating audio metadata',async()=>{
 const f=fixture(),id=randomUUID(),track=await f.service.add(f.room.id,f.user,'123',id);
 expect(track).toMatchObject({sourceUrl:'https://m801.music.126.net/song.mp3?version=1',sourceExpiresAt:160000,neteaseId:'123',artists:'测试歌手',album:'专辑',spec:{sampleRate:44100,bits:16,channels:2}});
 expect(track.ossKey).toBeUndefined();expect(track.ossUrl).toBeUndefined();expect(track.contentHash).toMatch(/^[a-f0-9]{64}$/);
 expect(String(f.request.mock.calls[0][0])).toBe(track.sourceUrl);
 expect(f.db.getMusicSource('netease','netease:standard:123')).toMatchObject({...track,id:expect.any(String)});
 expect(f.db.db.prepare('SELECT COUNT(*) AS total FROM music_assets').get()?.total).toBe(0);
 expect((await f.service.add(f.room.id,f.user,'123',id)).id).toBe(track.id);expect(f.request).toHaveBeenCalledOnce();
});
it('coalesces parallel imports, rejects request reuse and reuses saved links after service recreation',async()=>{
 const f=fixture(),id=randomUUID();const [a,b]=await Promise.all([f.service.add(f.room.id,f.user,'123',id),f.service.add(f.room.id,f.user,'123',id)]);
 expect(a).toEqual(b);expect(()=>f.service.add(f.room.id,f.user,'124',id)).toThrow('COMMAND_ID_REUSED');
 const restarted=new MusicImport(f.engine,{call:f.call},f.request as typeof fetch,f.db,()=>100000);f.ref.value=restarted;
 const other=await restarted.add(f.room.id,f.user,'123',randomUUID());expect(other.id).not.toBe(a.id);expect(other.sourceUrl).toBe(a.sourceUrl);expect(f.request).toHaveBeenCalledOnce();
});
it('refreshes expired links by stable song id and persists the new URL without uploading',async()=>{
 const f=fixture(),track=await f.service.add(f.room.id,f.user,'123',randomUUID());f.time(140000);f.version(2);
 expect(await f.service.url(f.room.id,f.user,track.id)).toContain('version=2');
 expect(f.db.getMusicSource('netease','netease:standard:123')).toMatchObject({sourceExpiresAt:200000,sourceUrl:expect.stringContaining('version=2')});
 expect(f.call).toHaveBeenCalledTimes(4);expect(f.request).toHaveBeenCalledTimes(2);
});
it('forces exactly one refresh after an early 403 and verifies the replacement bytes',async()=>{
 const f=fixture(),track=await f.service.add(f.room.id,f.user,'123',randomUUID());f.version(2);
 f.request.mockImplementation(async(url)=>String(url).includes('version=1')?new Response(null,{status:403}):new Response(bytes));
 expect(await f.service.readAudio(f.room.id,f.user,track.id)).toEqual(bytes);
 expect(f.call).toHaveBeenCalledTimes(4);expect(f.request).toHaveBeenCalledTimes(4);
});
it('does not loop when refreshed links are also invalid and sanitizes transport errors',async()=>{
 const f=fixture(),track=await f.service.add(f.room.id,f.user,'123',randomUUID());
 f.request.mockResolvedValue(new Response(null,{status:403}));
 await expect(f.service.readAudio(f.room.id,f.user,track.id)).rejects.toThrow('MUSIC_LINK_EXPIRED');expect(f.call).toHaveBeenCalledTimes(4);
 const secret=vi.fn(async()=>{throw Error('https://secret-provider-url/token');});
 await expect(downloadMusic('https://m801.music.126.net/a',secret)).rejects.toThrow(/^MUSIC_DOWNLOAD_FAILED$/);
});
it('rejects changed content rather than weakening the verified client cache',async()=>{
 const f=fixture(),track=await f.service.add(f.room.id,f.user,'123',randomUUID());f.time(140000);
 f.request.mockResolvedValue(new Response(Buffer.concat([bytes,Buffer.from('changed')])));
 await expect(f.service.url(f.room.id,f.user,track.id)).rejects.toThrow('MUSIC_CONTENT_CHANGED');
});
it('rechecks membership after awaiting remote work and retains a reusable database record',async()=>{
 const f=fixture();f.request.mockImplementationOnce(async()=>{f.engine.leave(f.room.id,f.user);return new Response(bytes);});
 await expect(f.service.add(f.room.id,f.user,'123',randomUUID())).rejects.toThrow('NOT_IN_ROOM');
 expect(f.engine.snapshot(f.room.id).playlist).toHaveLength(0);expect(f.db.getMusicSource('netease','netease:standard:123')?.sourceUrl).toBeDefined();
 f.engine.join(f.room.id,{id:f.user,name:'host'});await f.service.add(f.room.id,f.user,'123',randomUUID());expect(f.request).toHaveBeenCalledOnce();
});
it('makes legacy database songs refreshable by song id without contacting OSS',async()=>{
 const f=fixture(),track=await f.service.add(f.room.id,f.user,'123',randomUUID());
 const old={...track,sourceUrl:undefined,sourceExpiresAt:undefined,neteaseId:undefined,ossKey:'music/old/key'};
 f.db.saveMusicSource('old-bucket','netease:standard:123',old);
 expect(f.db.musicLibrary('',0,20).total).toBe(1);
 const added=await f.service.addUploaded(f.room.id,f.user,track.contentHash,randomUUID());expect(added.sourceUrl).toBeDefined();expect(added.ossKey).toBeUndefined();
 await expect(f.service.addUploaded(f.room.id,f.user,'f'.repeat(64),randomUUID())).rejects.toThrow('TRACK_NOT_FOUND');
});
it('rejects forged remote references in the engine unless registered by the server',async()=>{
 const f=fixture(),track=await f.service.add(f.room.id,f.user,'123',randomUUID());
 expect(()=>f.engine.command(f.user,{roomId:f.room.id,commandId:randomUUID(),expectedStateVersion:f.engine.snapshot(f.room.id).stateVersion,action:{type:'enqueue',payload:{...track,id:randomUUID(),contentHash:'f'.repeat(64)}}})).toThrow('FORBIDDEN');
});
it('blocks credentials, private hosts, ports, fragments and untrusted redirects',async()=>{
 for(const url of ['http://127.0.0.1/a','https://m801.music.126.net.evil.test/a','https://u:p@m801.music.126.net/a','file:///secret','https://m801.music.126.net:8443/a','https://m801.music.126.net/a#fragment'])expect(()=>musicDownloadUrl(url)).toThrow('MUSIC_SOURCE_INVALID');
 expect(musicDownloadUrl('http://m801.music.126.net/a').protocol).toBe('https:');
 await expect(downloadMusic('https://m801.music.126.net/a',async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}}))).rejects.toThrow('MUSIC_SOURCE_INVALID');
});
it('rejects trial-only or unavailable audio before downloading',async()=>{
 for(const audio of [{id:123,url:null},{id:123,url:'https://m801.music.126.net/a',freeTrialInfo:{}}]){
 const f=fixture();f.call.mockImplementation(async method=>method==='song_detail'?{songs:[{id:123,name:'test',dt:120000}]}:{data:[audio]});
 await expect(f.service.add(f.room.id,f.user,'123',randomUUID())).rejects.toThrow(/MUSIC_NOT_AVAILABLE|MUSIC_TRIAL_ONLY/);expect(f.request).not.toHaveBeenCalled();}
});
it('bounds downloads and rejects empty or non-audio responses',async()=>{
 await expect(downloadMusic('https://m801.music.126.net/a',async()=>new Response('big',{headers:{'content-length':String(101*1024*1024)}}))).rejects.toThrow('MUSIC_TOO_LARGE');
 await expect(downloadMusic('https://m801.music.126.net/a',async()=>new Response(''))).rejects.toThrow('MUSIC_DOWNLOAD_FAILED');expect(()=>mp3Spec(Buffer.from('<html>'))).toThrow('MUSIC_AUDIO_UNSUPPORTED');
 expect(songCover({al:{picUrl:'http://p1.music.126.net/cover.jpg'}})).toBe('https://p1.music.126.net/cover.jpg');expect(songFilename({name:'曲名',ar:[{name:'歌手'}]})).toBe('曲名 - 歌手.mp3');
});
