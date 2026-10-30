import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>false,invoke:vi.fn()}));
vi.mock('@tauri-apps/api/event',()=>({listen:vi.fn()}));
class Socket{static OPEN=1;readyState=1;send(){}close(){}}
beforeEach(()=>{vi.resetModules();vi.useFakeTimers();vi.stubGlobal('WebSocket',Socket);});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();});
async function session(){
 const request=vi.fn(async()=>new Response(JSON.stringify({token:'project-token',user:{id:'user',name:'tester'}})));
 vi.stubGlobal('fetch',request);const bridge=await import('../src/bridge');await bridge.login('http://localhost:3000','tester','test-password',false);return {bridge,request};
}
it('resolves only short shares through the authenticated backend while parsing full links locally',async()=>{
 const {bridge,request}=await session();const initial=request.mock.calls.length;
 expect(await bridge.resolvePlaylistLink('https://music.163.com/#/playlist?id=123')).toEqual({id:'123'});expect(request).toHaveBeenCalledTimes(initial);
 request.mockResolvedValueOnce(new Response(JSON.stringify({id:'456'})));
 expect(await bridge.resolvePlaylistLink('分享歌单 https://163cn.tv/Abc (@网易云音乐)')).toEqual({id:'456'});
 const [url,options]=request.mock.calls.at(-1) as unknown as [string,RequestInit];expect(new URL(url).pathname).toBe('/api/music/playlist/resolve');
 expect(JSON.parse(String(options.body))).toEqual({input:'https://163cn.tv/Abc'});expect(options.headers).toMatchObject({Authorization:'Bearer project-token'});
 const count=request.mock.calls.length;await expect(bridge.resolvePlaylistLink('http://127.0.0.1/a')).rejects.toThrow();expect(request).toHaveBeenCalledTimes(count);
});
it('reports a missing short-link API separately from provider redirect failures',async()=>{
 const {bridge,request}=await session();
 for(const body of ['<html>404</html>',JSON.stringify({statusCode:404,error:'Not Found'})]){
  request.mockResolvedValueOnce(new Response(body,{status:404}));
  await expect(bridge.resolvePlaylistLink('https://163cn.tv/Abc')).rejects.toThrow('PLAYLIST_LINK_ENDPOINT_UNAVAILABLE');
 }
 const calls=request.mock.calls.length;
 await expect(bridge.resolvePlaylistLink('https://music.163.com/album/38306/')).rejects.toThrow('PLAYLIST_LINK_IS_ALBUM');expect(request).toHaveBeenCalledTimes(calls);
});
it('loads real similar-song results with auth and cancellation, removing self and duplicates',async()=>{
 const {bridge,request}=await session();
 request.mockResolvedValueOnce(new Response(JSON.stringify({code:200,songs:[{id:123,name:'当前歌曲'},{id:456,name:'推荐歌曲',artists:[{name:'歌手'}],album:{name:'专辑',picUrl:'http://p1.music.126.net/similar.jpg'},duration:120000},{id:456,name:'重复'},{id:'bad',name:'无效'}]})));
 const signal=new AbortController().signal;
 expect(await bridge.similarMusic('123',signal)).toEqual([{id:'456',name:'推荐歌曲',artists:'歌手',album:'专辑',coverUrl:'https://p1.music.126.net/similar.jpg',durationMs:120000}]);
 const [url,options]=request.mock.calls.at(-1) as unknown as [string,RequestInit];
 expect(new URL(url).pathname).toBe('/api/netease/simi_song');expect(new URL(url).searchParams.get('id')).toBe('123');
 expect(options.signal).toBe(signal);expect(options.headers).toMatchObject({Authorization:'Bearer project-token'});
 const count=request.mock.calls.length;await expect(bridge.similarMusic('bad')).rejects.toThrow('INVALID_REQUEST');expect(request).toHaveBeenCalledTimes(count);
});
it('searches through the authenticated server proxy and normalizes search results',async()=>{
 const {bridge,request}=await session();request.mockResolvedValueOnce(new Response(JSON.stringify({code:200,result:{songs:[{id:123,name:'歌曲',ar:[{name:'歌手'}],al:{name:'专辑',picUrl:'http://p1.music.126.net/cover.jpg'},dt:123000}],songCount:21}})));
 expect(await bridge.searchMusic(' 晴天 ',20)).toEqual({songs:[{id:'123',name:'歌曲',artists:'歌手',album:'专辑',coverUrl:'https://p1.music.126.net/cover.jpg',durationMs:123000}],total:21});
 const [url,options]=request.mock.calls.at(-1) as unknown as [string,RequestInit];expect(new URL(url).searchParams.get('keywords')).toBe('晴天');expect(new URL(url).searchParams.get('offset')).toBe('20');expect(options.headers).toMatchObject({Authorization:'Bearer project-token'});
});
it('waits for server link persistence and enqueue confirmation rather than resolving on click',async()=>{
 const {bridge,request}=await session();let finish!:(r:Response)=>void;request.mockImplementationOnce(()=>new Promise(r=>finish=r));let completed=false;
 const pending=bridge.addSearchedMusic('room','123','request-id').then(track=>{completed=true;return track;});await Promise.resolve();expect(completed).toBe(false);
 finish(new Response(JSON.stringify({ok:true,track:{id:'track',sourceUrl:'https://m801.music.126.net/song.mp3'}})));await expect(pending).resolves.toMatchObject({sourceUrl:'https://m801.music.126.net/song.mp3'});expect(completed).toBe(true);
 const [,options]=request.mock.calls.at(-1) as unknown as [string,RequestInit];expect(JSON.parse(String(options.body))).toEqual({songId:'123',requestId:'request-id'});
});
it('does not accept failure or incomplete success responses as successful adds',async()=>{
 const {bridge,request}=await session();request.mockResolvedValueOnce(new Response(JSON.stringify({error:'OSS_UPLOAD_FAILED',details:{ossCode:'AccessDenied'}}),{status:502}));
 await expect(bridge.addSearchedMusic('room','123','request-id')).rejects.toThrow('AccessDenied');
 request.mockResolvedValueOnce(new Response(JSON.stringify({ok:true,track:{id:'track'}})));
 await expect(bridge.addSearchedMusic('room','123','request-id')).rejects.toThrow('MUSIC_IMPORT_FAILED');
});

it('normalizes, deduplicates and bounds mobile keyword suggestions through the authenticated server',async()=>{
 const {bridge,request}=await session();request.mockResolvedValueOnce(new Response(JSON.stringify({code:200,result:{allMatch:[{keyword:' 晴天 '},{keyword:'晴天'},{keyword:'晴天 现场'},{keyword:''},{keyword:123}]}})));
 const controller=new AbortController();expect(await bridge.suggestMusic(' 晴 ',controller.signal)).toEqual(['晴天','晴天 现场']);
 const [url,options]=request.mock.calls.at(-1) as unknown as [string,RequestInit];expect(new URL(url).pathname).toBe('/api/netease/search_suggest');expect(new URL(url).searchParams.get('type')).toBe('mobile');expect(options.signal).toBe(controller.signal);expect(options.headers).toMatchObject({Authorization:'Bearer project-token'});
 const count=request.mock.calls.length;expect(await bridge.suggestMusic('   ')).toEqual([]);expect(request).toHaveBeenCalledTimes(count);
});

it('supports legacy album covers and safely handles missing or invalid cover URLs',async()=>{
 const {bridge,request}=await session();
 request.mockResolvedValueOnce(new Response(JSON.stringify({code:200,result:{songs:[
  {id:1,album:{name:'旧专辑',picUrl:'https://p2.music.126.net/legacy.jpg'}},
  {id:2,al:{name:'无封面'}},
  {id:3,al:{picUrl:'javascript:alert(1)'}},
  {id:4,al:{picUrl:123}},
  {id:5,al:{picUrl:'not a url'}}
 ]}})));
 const {songs}=await bridge.searchMusic('test');
 expect(songs.map(song=>song.coverUrl)).toEqual(['https://p2.music.126.net/legacy.jpg','','','','']);
 expect(songs[0].album).toBe('旧专辑');
});

it('retains search artwork for a legacy production import response that lacks cover metadata',async()=>{
 const {bridge,request}=await session();const hash='c'.repeat(64);
 request.mockResolvedValueOnce(new Response(JSON.stringify({ok:true,track:{id:'legacy',sourceUrl:'https://m801.music.126.net/song.mp3',contentHash:hash}})));
 const track=await bridge.addSearchedMusic('room','123','request-id','http://p1.music.126.net/from-search.jpg');
 expect(bridge.playingTrackCover(track)).toBe('https://p1.music.126.net/from-search.jpg');
 const calls=request.mock.calls.length;
 expect(await bridge.loadTrackCover('room',track)).toBe('https://p1.music.126.net/from-search.jpg');expect(request.mock.calls.length).toBe(calls);
});
it('backfills currently playing legacy artwork and tolerates old servers without the new endpoint',async()=>{
 const {bridge,request}=await session();const track={id:'legacy',ossKey:'music/legacy',contentHash:'d'.repeat(64)} as any;
 request.mockResolvedValueOnce(new Response(JSON.stringify({coverUrl:'https://p2.music.126.net/recovered.jpg'})));
 expect(await bridge.loadTrackCover('room',track)).toBe('https://p2.music.126.net/recovered.jpg');
 expect(request.mock.calls.at(-1)?.[0]).toBe('http://localhost:3000/api/rooms/room/music/legacy/cover');
 request.mockResolvedValueOnce(new Response(JSON.stringify({error:'TRACK_NOT_FOUND'}),{status:404}));
 expect(await bridge.loadTrackCover('room',{...track,contentHash:'e'.repeat(64)})).toBe('');
});
