import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Database } from '../src/database';
import { QqMusicService } from '../src/qq';
import { RoomEngine } from '../src/engine';
import { MusicImport, musicDownloadUrl } from '../src/music-import';
import { normalizeAlbumCover, trackSchema } from '../../../packages/shared/src';
const mid='001TestSong';
function fixture(){
 const db=new Database(':memory:');let code=801,time=1000;
 const song={file:{size_128mp3:1004},mid,name:'测试歌曲',singer:[{name:'测试歌手'}],album:{mid:'001Album',name:'专辑'},interval:120};
 const request=vi.fn(async(input:any,options:any)=>{
  const url=new URL(String(input));
  const body=url.pathname==='/login/channels'?{code:200,data:{channels:['qq','wechat'],sessionMode:'stored'}}:
   url.pathname==='/login/qr/key'?{code:200,data:{unikey:'upstream-key'}}:
   url.pathname==='/login/qr/create'?{code:200,data:{qrimg:'data:image/jpeg;base64,AA=='}}:
   url.pathname==='/login/qr/check'?{code,cookie:'qqmusic_session=test-session; Path=/'}:
   url.pathname==='/login/status'?{code:200,data:options.headers?.['X-QQ-Session']?{profile:{id:'tester'}}:{}}:
   url.pathname==='/search'?{code:200,items:[song],total:1}:
   url.pathname==='/getSongInfo'?{response:{code:0,songinfo:{code:0,data:{track_info:song}}}}:
   url.pathname.startsWith('/getMusicPlay/')?{data:{playUrl:{[mid]:{url:'https://isure.stream.qqmusic.qq.com/song.mp3',error:false}}}}:
   url.pathname==='/getLyric'?{response:{code:0,lyric:'[00:01.00]你好',trans:''}}:{code:200};
  return Response.json(body);
 });
 const service=new QqMusicService(db,'http://127.0.0.1:3200',request as typeof fetch,()=>time);
 return {db,request,service,song,status:(v:number)=>{code=v;time+=2500;}};
}
it('loads supported channels, polls real status and keeps credentials server-only',async()=>{
 const f=fixture();try{
  const qr=await f.service.begin('qq');expect(qr.image).toContain('image/jpeg');
  expect(await f.service.check(qr.sessionId)).toEqual({code:801});
  f.status(802);expect(await f.service.check(qr.sessionId)).toEqual({code:802});
  f.status(803);const success=await f.service.check(qr.sessionId);
  expect(success).toEqual({code:803});expect(f.db.getSetting('qq.session')).toBe('test-session');
  expect(JSON.stringify(success)).not.toContain('test-session');
  expect(await f.service.status()).toEqual({loggedIn:true});
  expect(f.request.mock.calls.at(-1)?.[1]).toMatchObject({redirect:'error',headers:{'X-QQ-Session':'test-session'}});
 }finally{f.db.close();}
});
it('keeps old credentials until verified success and rejects unsupported channels and obsolete attempts',async()=>{
 const f=fixture();try{
  f.db.setSetting('qq.session','previous');await expect(f.service.begin('qqmusic')).rejects.toThrow('QQ_CHANNEL_UNAVAILABLE');
  const first=await f.service.begin('qq'),second=await f.service.begin('wechat');
  await expect(f.service.check(first.sessionId)).rejects.toThrow('QQ_LOGIN_REPLACED');
  expect(f.db.getSetting('qq.session')).toBe('previous');
  await f.service.cancel(second.sessionId);await expect(f.service.check(second.sessionId)).rejects.toThrow('QQ_LOGIN_REPLACED');
  expect(f.db.getSetting('qq.session')).toBe('previous');
 }finally{f.db.close();}
});
it('normalizes search, details and lyrics without leaking upstream objects or session tokens',async()=>{
 const f=fixture();try{
  const found=await f.service.search('测试',20);expect(found).toMatchObject({total:1,songs:[{id:mid,name:'测试歌曲',durationMs:120000,coverUrl:'https://y.gtimg.cn/music/photo_new/T002R300x300M000001Album.jpg'}]});
  const url=new URL(String(f.request.mock.calls[0][0]));expect(url.searchParams.get('page')).toBe('2');
  expect((await f.service.audio(mid)).url).toContain('.stream.qqmusic.qq.com/');
  expect(await f.service.lyrics(mid)).toEqual({lrc:{lyric:'[00:01.00]你好'},tlyric:{lyric:''}});
 }finally{f.db.close();}
});
it('reports missing configuration and sanitizes network errors',async()=>{
 const db=new Database(':memory:');try{
  await expect(new QqMusicService(db,'').channels()).rejects.toThrow('QQ_MUSIC_NOT_CONFIGURED');
  const request=vi.fn(async()=>{throw new Error('private-token-upstream-url');});
  await expect(new QqMusicService(db,'http://localhost:3200',request).channels()).rejects.toThrow(/^QQ_MUSIC_UNAVAILABLE$/);
 }finally{db.close();}
});
it('searches the public catalog without the playback session and coalesces/caches only successful results',async()=>{
 const f=fixture();try{
  f.db.setSetting('qq.session','private-playback-session');
  const [a,b]=await Promise.all([f.service.search('公开歌曲',0),f.service.search('公开歌曲',0)]);
  expect(a).toEqual(b);expect(f.request).toHaveBeenCalledOnce();expect(f.request.mock.calls[0][1].headers).toEqual({});
  expect(await f.service.search('公开歌曲',0)).toEqual(a);expect(f.request).toHaveBeenCalledOnce();
  await f.service.search('公开歌曲',20);expect(f.request).toHaveBeenCalledTimes(2);
  for(let i=0;i<7;i++)f.status(801);await f.service.search('公开歌曲',0);expect(f.request).toHaveBeenCalledTimes(3);
  await f.service.audio(mid);expect(f.request.mock.calls.at(-1)?.[1].headers).toEqual({'X-QQ-Session':'private-playback-session'});
 }finally{f.db.close();}
});
it('retries a transient search failure once using the same overall deadline and never caches failures',async()=>{
 const f=fixture();try{
  f.request.mockRejectedValueOnce(new Error('private-token-and-url'));
  expect((await f.service.search('retry',0)).songs).toHaveLength(1);expect(f.request).toHaveBeenCalledTimes(2);
  expect(f.request.mock.calls[0][1].signal).toBe(f.request.mock.calls[1][1].signal);
  f.request.mockResolvedValueOnce(Response.json({retryable:true},{status:503})).mockResolvedValueOnce(Response.json({retryable:true},{status:503}));
  await expect(f.service.search('failed',0)).rejects.toThrow('QQ_MUSIC_UNAVAILABLE');expect(f.request).toHaveBeenCalledTimes(4);
  expect((await f.service.search('failed',0)).songs).toHaveLength(1);expect(f.request).toHaveBeenCalledTimes(5);
 }finally{f.db.close();}
});
it('does not retry rate limits, credential failures or explicit non-retryable business rejections',async()=>{
 const f=fixture(),warn=vi.spyOn(console,'warn').mockImplementation(()=>{});try{
  for(const [status,body,code] of [[429,{},'QQ_MUSIC_RATE_LIMITED'],[401,{},'QQ_LOGIN_REQUIRED'],[502,{retryable:false,errorKey:'upstream.unknown'},'QQ_MUSIC_UNAVAILABLE'],[403,{retryable:true},'QQ_MUSIC_UNAVAILABLE']] as const){
   const before=f.request.mock.calls.length;f.request.mockResolvedValueOnce(Response.json(body,{status}));
   await expect(f.service.search(String(status),0)).rejects.toThrow(code);expect(f.request.mock.calls.length-before).toBe(1);
  }
  f.request.mockResolvedValueOnce(Response.json({code:200,items:[]}));expect(await f.service.search('empty',0)).toEqual({songs:[],total:0});
  f.request.mockResolvedValueOnce(Response.json({code:502,message:'private upstream error'}));await expect(f.service.search('bad-shape',0)).rejects.toThrow('QQ_INVALID_RESPONSE');
  expect(JSON.stringify(warn.mock.calls)).not.toMatch(/private|bad-shape|https?:/);
 }finally{warn.mockRestore();f.db.close();}
});
it('never downloads QQ audio to hash it, shares jobs, persists MID and reuses existing enqueue permissions/idempotency',async()=>{
 const f=fixture();try{
  const bytes=Buffer.concat([Buffer.from([255,251,144,0]),Buffer.alloc(1000)]);
  const ref:{value?:MusicImport}={},engine=new RoomEngine(undefined,undefined,()=>1000,(url,digest)=>ref.value?.registered(url,digest)??false);
  const user=randomUUID(),room=engine.create('测试',user);engine.join(room.id,{id:user,name:'房主'});
  const download=vi.fn(async()=>new Response(bytes));
  const service=new MusicImport(engine,{call:vi.fn(),songBatch:vi.fn()},download as typeof fetch,f.db,()=>1000,f.service);ref.value=service;
  const requestId=randomUUID();const [a,b]=await Promise.all([service.addQq(room.id,user,mid,requestId),service.addQq(room.id,user,mid,requestId)]);
  expect(a).toEqual(b);expect(a).toMatchObject({qqId:mid,contentHash:expect.stringMatching(/^[a-f0-9]{32}$/),sizeBytes:bytes.length});
  expect(download).not.toHaveBeenCalled();expect(engine.snapshot(room.id).playlist).toHaveLength(1);
  expect(()=>service.add(room.id,user,'123',requestId)).toThrow('COMMAND_ID_REUSED');
  expect(f.db.musicLibrary('',0,20).songs[0]).toMatchObject({qqId:mid,canAdd:true});
  const prior=engine.snapshot(room.id);expect((await service.playbackSource(room.id,user,a.id,true)).contentHash).toBe(a.contentHash);
  expect(download).not.toHaveBeenCalled();expect(engine.snapshot(room.id)).toEqual(prior);
  await service.addUploaded(room.id,user,a.contentHash,randomUUID());expect(engine.snapshot(room.id).playlist).toHaveLength(2);
  expect(()=>service.addQq(room.id,randomUUID(),mid,randomUUID())).toThrow('NOT_IN_ROOM');
 }finally{f.db.close();}
});
it('never persists a stale in-flight confirmation after a replacement QR starts',async()=>{
 const f=fixture();try{
  const first=await f.service.begin('qq');let finish!:(response:Response)=>void;
  f.request.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=f.service.check(first.sessionId);await f.service.begin('qq');
  finish(Response.json({code:803,cookie:'qqmusic_session=stale'}));
  await expect(pending).rejects.toThrow('QQ_LOGIN_REPLACED');expect(f.db.getSetting('qq.session')).toBeUndefined();
 }finally{f.db.close();}
});
it('does not save a malformed successful login or forward its cookie',async()=>{
 const f=fixture();try{
  f.db.setSetting('qq.session','previous');const qr=await f.service.begin('qq');
  f.request.mockResolvedValueOnce(Response.json({code:803,cookie:'raw-private-cookie'}));
  await expect(f.service.check(qr.sessionId)).rejects.toThrow('QQ_INVALID_RESPONSE');
  expect(f.db.getSetting('qq.session')).toBe('previous');
 }finally{f.db.close();}
});
it('allows only dedicated QQ audio/cover hosts and rejects lookalike domains, credentials and nonstandard ports',()=>{
 expect(musicDownloadUrl('http://isure.stream.qqmusic.qq.com/song.mp3').protocol).toBe('https:');
 expect(normalizeAlbumCover('https://y.gtimg.cn/music/a.jpg')).toBeTruthy();
 for(const url of ['https://isure.stream.qqmusic.qq.com.evil.test/a','https://a.b.stream.qqmusic.qq.com/a','https://127.0.0.1/a','https://u:p@isure.stream.qqmusic.qq.com/a','https://isure.stream.qqmusic.qq.com:8443/a']){
  expect(()=>musicDownloadUrl(url)).toThrow('MUSIC_SOURCE_INVALID');
  expect(trackSchema.shape.sourceUrl.safeParse(url).success).toBe(false);
 }
 expect(normalizeAlbumCover('https://y.gtimg.cn.evil.test/a')).toBeNull();
});

it('normalizes real QQ suggestions anonymously and only treats explicit no-match as empty',async()=>{
 const f=fixture();try{
  f.db.setSetting('qq.session','private-session');f.request.mockResolvedValueOnce(Response.json({code:200,suggestions:[' 晴天 ','晴天','晴天现场','',123]}));
  expect(await f.service.suggest('晴')).toEqual({suggestions:['晴天','晴天现场']});expect(f.request.mock.calls[0][1].headers).toEqual({});
  f.request.mockResolvedValueOnce(Response.json({errorKey:'resource.not-found'},{status:422}));expect(await f.service.suggest('无结果')).toEqual({suggestions:[]});
  f.request.mockResolvedValueOnce(Response.json({retryable:false},{status:502}));await expect(f.service.suggest('故障')).rejects.toThrow('QQ_MUSIC_UNAVAILABLE');
 }finally{f.db.close();}
});

it('rejects unavailable QQ file sizes without downloading audio or saving a source',async()=>{
 for(const size of [undefined,0,101*1024*1024]) {
  const f=fixture();try {
   f.song.file.size_128mp3=size as number;
   const download=vi.fn(),service=new MusicImport(new RoomEngine(),{call:vi.fn(),songBatch:vi.fn()},download,f.db,()=>1000,f.service);
   await expect(service.importQqSong(mid)).rejects.toThrow(/MUSIC_SOURCE_INVALID|MUSIC_TOO_LARGE/);
   expect(download).not.toHaveBeenCalled();expect(f.db.getMusicSource('qq',`qq:128:${mid}`)).toBeUndefined();
  } finally {f.db.close();}
 }
});
