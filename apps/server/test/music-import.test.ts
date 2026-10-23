import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { OssStorage } from '../src/oss';
import { Database } from '../src/database';
import { RoomEngine } from '../src/engine';
import { MusicImport, downloadMusic, musicDownloadUrl, mp3Spec, songFilename } from '../src/music-import';
const bytes=Buffer.concat([Buffer.from([255,251,144,0]),Buffer.alloc(1000)]);
function setup(){
 const engine=new RoomEngine(),user=randomUUID(),room=engine.create('test',user);engine.join(room.id,{id:user,name:'host'});
 const call=vi.fn(async(method:string)=>method==='song_detail'?{songs:[{id:123,name:'测试歌曲',ar:[{name:'测试歌手'}],dt:120000}]}:{data:[{id:123,url:'https://m801.music.126.net/audio.mp3',code:200,type:'mp3',br:128000}]});
 const upload=vi.fn(async(id:string,data:Buffer,_filename?:string)=>({ossKey:`music/${id}/${randomUUID()}`}));
 const request=vi.fn(async()=>new Response(bytes,{headers:{'content-type':'audio/mpeg'}}));
 const importer=new MusicImport(engine,{call},{upload},request as typeof fetch);
 return {engine,user,room,call,upload,request,importer};
}
it('downloads on the server, uploads original bytes, enqueues and only then returns success',async()=>{
 const f=setup(),id=randomUUID();const track=await f.importer.add(f.room.id,f.user,'123',id);
 expect(f.call).toHaveBeenCalledWith('song_url_v1',{id:'123',level:'standard'});
 expect(f.upload).toHaveBeenCalledWith(f.user,bytes,'测试歌曲 - 测试歌手.mp3');expect(track.ossKey).toMatch(/^music\//);
 expect(track.spec).toEqual({sampleRate:44100,bits:16,channels:2});expect(track.contentHash).toMatch(/^[a-f0-9]{64}$/);
 expect(f.engine.snapshot(f.room.id).playlist[0].id).toBe(track.id);
 expect((await f.importer.add(f.room.id,f.user,'123',id)).id).toBe(track.id);expect(f.upload).toHaveBeenCalledOnce();
});
it('deduplicates simultaneous retries and rejects request ID reuse for another song',async()=>{
 const f=setup(),id=randomUUID();const [a,b]=await Promise.all([f.importer.add(f.room.id,f.user,'123',id),f.importer.add(f.room.id,f.user,'123',id)]);expect(a.id).toBe(b.id);expect(f.upload).toHaveBeenCalledOnce();
 expect(()=>f.importer.add(f.room.id,f.user,'124',id)).toThrow('COMMAND_ID_REUSED');
});
it('does not enqueue or report success when OSS rejects the upload; failed requests can retry',async()=>{
 const f=setup(),id=randomUUID();f.upload.mockRejectedValueOnce(new Error('OSS_UPLOAD_FAILED'));
 await expect(f.importer.add(f.room.id,f.user,'123',id)).rejects.toThrow('OSS_UPLOAD_FAILED');expect(f.engine.snapshot(f.room.id).playlist).toHaveLength(0);
 await expect(f.importer.add(f.room.id,f.user,'123',id)).resolves.toHaveProperty('ossKey');
});
it('rejects trial-only and unavailable sources before download or upload',async()=>{
 for(const audio of [{id:123,url:null},{id:123,url:'https://m801.music.126.net/a',freeTrialInfo:{start:0,end:30}}]){
 const f=setup();f.call.mockImplementation(async(method:string)=>method==='song_detail'?{songs:[{id:123,name:'test',dt:120000}]}:{data:[audio]} as any);
 await expect(f.importer.add(f.room.id,f.user,'123',randomUUID())).rejects.toThrow(/MUSIC_NOT_AVAILABLE|MUSIC_TRIAL_ONLY/);expect(f.request).not.toHaveBeenCalled();expect(f.upload).not.toHaveBeenCalled();}
});
it('checks membership before work and again after upload',async()=>{
 const f=setup();expect(()=>f.importer.add(f.room.id,randomUUID(),'123',randomUUID())).toThrow('NOT_IN_ROOM');
 f.upload.mockImplementationOnce(async(id:string)=>{f.engine.leave(f.room.id,f.user);return {ossKey:`music/${id}/${randomUUID()}`};});
 await expect(f.importer.add(f.room.id,f.user,'123',randomUUID())).rejects.toThrow('NOT_IN_ROOM');expect(f.engine.snapshot(f.room.id).playlist).toHaveLength(0);
});
it('blocks local/private destinations, credentials, ports and untrusted redirects',async()=>{
 for(const url of ['http://127.0.0.1/a','https://m801.music.126.net.evil.test/a','https://user:pass@m801.music.126.net/a','file:///etc/passwd','https://m801.music.126.net:8080/a'])expect(()=>musicDownloadUrl(url)).toThrow('MUSIC_SOURCE_INVALID');
 expect(musicDownloadUrl('http://m801.music.126.net/a').protocol).toBe('https:');
 const request=vi.fn(async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/secret'}}));
 await expect(downloadMusic('https://m801.music.126.net/a',request as typeof fetch)).rejects.toThrow('MUSIC_SOURCE_INVALID');expect(request).toHaveBeenCalledOnce();
});
it('rejects huge, empty or invalid audio instead of uploading an error page',async()=>{
 await expect(downloadMusic('https://m801.music.126.net/a',async()=>new Response('too big',{headers:{'content-length':String(101*1024*1024)}}))).rejects.toThrow('MUSIC_TOO_LARGE');
 await expect(downloadMusic('https://m801.music.126.net/a',async()=>new Response(''))).rejects.toThrow('MUSIC_DOWNLOAD_FAILED');
 expect(()=>mp3Spec(Buffer.from('<html>error</html>'))).toThrow('MUSIC_AUDIO_UNSUPPORTED');
});

it('reuses a persisted song index across service recreation, request IDs and rooms without downloading or uploading again',async()=>{
 const f=setup(),db=new Database(':memory:');const exists=vi.fn(async()=>true),oss={upload:f.upload,exists,scope:()=> 'bucket-a'};
 try{
 const first=new MusicImport(f.engine,{call:f.call},oss,f.request as typeof fetch,db);
 const a=await first.add(f.room.id,f.user,'123',randomUUID());
 const secondRoom=f.engine.create('other room',f.user);f.engine.join(secondRoom.id,{id:f.user,name:'host'});
 const restarted=new MusicImport(f.engine,{call:f.call},oss,f.request as typeof fetch,db);
 const b=await restarted.add(secondRoom.id,f.user,'123',randomUUID());
 expect(b.ossKey).toBe(a.ossKey);expect(b.id).not.toBe(a.id);expect(f.request).toHaveBeenCalledOnce();expect(f.upload).toHaveBeenCalledOnce();expect(f.call).toHaveBeenCalledTimes(2);
 }finally{db.close();}
});
it('coalesces simultaneous requests for the same song even with different request IDs',async()=>{
 const f=setup();const [a,b]=await Promise.all([f.importer.add(f.room.id,f.user,'123',randomUUID()),f.importer.add(f.room.id,f.user,'123',randomUUID())]);expect(a.ossKey).toBe(b.ossKey);expect(a.id).not.toBe(b.id);expect(f.upload).toHaveBeenCalledOnce();expect(f.engine.snapshot(f.room.id).playlist).toHaveLength(2);
});
it('persists successful uploads even when enqueue subsequently fails, so retry does not upload again',async()=>{
 const f=setup(),db=new Database(':memory:');let lost=false;f.upload.mockImplementationOnce(async(id:string)=>{lost=true;f.engine.leave(f.room.id,f.user);return {ossKey:`music/${id}/${randomUUID()}`};});
 const importer=new MusicImport(f.engine,{call:f.call},{upload:f.upload,exists:async()=>true,scope:()=> 'bucket-a'},f.request as typeof fetch,db);
 try{await expect(importer.add(f.room.id,f.user,'123',randomUUID())).rejects.toThrow('NOT_IN_ROOM');expect(lost).toBe(true);f.engine.join(f.room.id,{id:f.user,name:'host'});await importer.add(f.room.id,f.user,'123',randomUUID());expect(f.upload).toHaveBeenCalledOnce();}finally{db.close();}
});

it('accepts registered shared assets across users but rejects forged asset references',async()=>{
 const f=setup(),db=new Database(':memory:');const objects=new Set<string>();let puts=0;
 const network=vi.fn(async(url:unknown,options?:RequestInit)=>{const key=new URL(String(url)).pathname;if(options?.method==='HEAD')return new Response(null,{status:objects.has(key)?200:404});objects.add(key);puts++;return new Response(null,{status:200});});
 const oss=new OssStorage({OSS_BUCKET:'test-bucket',OSS_REGION:'cn-hangzhou',OSS_ACCESS_KEY_ID:'test',OSS_ACCESS_KEY_SECRET:'test'},network as typeof fetch,db);
 const engine=new RoomEngine(undefined,undefined,Date.now,(key,hash)=>oss.registered(key,hash));const room=engine.create('registered',f.user);engine.join(room.id,{id:f.user,name:'owner'});const other=randomUUID();engine.join(room.id,{id:other,name:'member'});
 try{
 const service=new MusicImport(engine,{call:f.call},oss,f.request as typeof fetch,db);
 const a=await service.add(room.id,f.user,'123',randomUUID());const b=await service.add(room.id,other,'123',randomUUID());expect(a.ossKey).toBe(b.ossKey);expect(a.ossKey).toMatch(/测试歌曲 - 测试歌手\.mp3$/);expect(puts).toBe(1);expect(engine.snapshot(room.id).playlist).toHaveLength(2);
 expect(()=>engine.command(other,{roomId:room.id,commandId:randomUUID(),expectedStateVersion:engine.snapshot(room.id).stateVersion,action:{type:'enqueue',payload:{...a,id:randomUUID(),contentHash:'f'.repeat(64)}}})).toThrow('FORBIDDEN');
 }finally{db.close();}
});

it('includes real artist names, supports both artist schemas and deduplicates featured artists',()=>{
 expect(songFilename({name:'晴天',ar:[{name:'周杰伦'}]})).toBe('晴天 - 周杰伦.mp3');
 expect(songFilename({name:'合唱歌曲',ar:[{name:'歌手甲'},{name:'歌手乙'},{name:'歌手甲'}]})).toBe('合唱歌曲 - 歌手甲、歌手乙.mp3');
 expect(songFilename({name:'Love Story',artists:[{name:'Taylor Swift'}]})).toBe('Love Story - Taylor Swift.mp3');
 expect(()=>songFilename({name:'缺少歌手'})).toThrow('MUSIC_SOURCE_INVALID');
});
