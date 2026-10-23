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
it('searches through the authenticated server proxy and normalizes search results',async()=>{
 const {bridge,request}=await session();request.mockResolvedValueOnce(new Response(JSON.stringify({code:200,result:{songs:[{id:123,name:'歌曲',ar:[{name:'歌手'}],al:{name:'专辑'},dt:123000}],songCount:21}})));
 expect(await bridge.searchMusic(' 晴天 ',20)).toEqual({songs:[{id:'123',name:'歌曲',artists:'歌手',album:'专辑',durationMs:123000}],total:21});
 const [url,options]=request.mock.calls.at(-1) as unknown as [string,RequestInit];expect(new URL(url).searchParams.get('keywords')).toBe('晴天');expect(new URL(url).searchParams.get('offset')).toBe('20');expect(options.headers).toMatchObject({Authorization:'Bearer project-token'});
});
it('waits for server upload and enqueue confirmation rather than resolving on click',async()=>{
 const {bridge,request}=await session();let finish!:(r:Response)=>void;request.mockImplementationOnce(()=>new Promise(r=>finish=r));let completed=false;
 const pending=bridge.addSearchedMusic('room','123','request-id').then(track=>{completed=true;return track;});await Promise.resolve();expect(completed).toBe(false);
 finish(new Response(JSON.stringify({ok:true,track:{id:'track',ossKey:'music/u/id'}})));await expect(pending).resolves.toMatchObject({ossKey:'music/u/id'});expect(completed).toBe(true);
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
