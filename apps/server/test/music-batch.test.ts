import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Database } from '../src/database';
import { RoomEngine, DomainError } from '../src/engine';
import { MusicImport } from '../src/music-import';
import { NeteaseService, musicMethods } from '../src/netease';
import { ApiController } from '../src/controller';
import { createHanaInvoker } from '../src/hana-music';
const detailRoute='/api/v3/song/detail',urlRoute='/api/song/enhance/player/url';
const databases:Database[]=[];afterEach(()=>databases.splice(0).forEach(db=>db.close()));
function fixture(){
 const db=new Database(':memory:');databases.push(db);
 const api=vi.fn(async(name:string,params:Record<string,unknown>)=>{
  if(name!=='batch')throw new Error('unexpected single request');
  const ids=JSON.parse((params[urlRoute] as {ids:string}).ids) as number[];
  return {body:{code:200,[detailRoute]:{code:200,songs:ids.map(id=>({id,name:'song '+id,dt:120000}))},[urlRoute]:{code:200,data:ids.map(id=>({id,url:`https://m801.music.126.net/${id}.mp3`,size:4,type:'mp3',expi:300,code:200}))}}};
 });
 const log=vi.fn(),netease=new NeteaseService(db,api,()=>1000,log),request=vi.fn();
 const ref:{value?:MusicImport}={},engine=new RoomEngine(undefined,undefined,()=>1000,(url,key)=>ref.value?.registered(url,key)??false);
 const user=randomUUID(),room=engine.create('room',user);engine.join(room.id,{id:user,name:'host'});
 const service=new MusicImport(engine,netease,request,db,()=>1000);ref.value=service;
 const items=[1,2,3].map(id=>({songId:String(id),requestId:randomUUID()}));
 const flush=vi.fn(async()=>{}),limit=vi.fn(),controller=new ApiController({auth:{verify:async()=>({id:user})},musicImport:service,flush,limit} as any);
 return {db,api,netease,log,request,engine,user,room,service,items,controller,flush,limit};
}
it('uses one actual SDK batch with two fixed multi-song read routes and preserves enqueue order',async()=>{
 const f=fixture(),result=await f.controller.addNeteaseBatch(f.room.id,{items:f.items},'Bearer test');
 expect(result?.results.every(item=>item.ok)).toBe(true);expect(f.api).toHaveBeenCalledOnce();expect(f.api.mock.calls[0][0]).toBe('batch');
 const params=f.api.mock.calls[0][1];expect(params[detailRoute]).toEqual({c:'[{"id":1},{"id":2},{"id":3}]'});
 expect(params[urlRoute]).toEqual({ids:'["1","2","3"]',br:128000});
 expect(f.engine.snapshot(f.room.id).playlist.map(track=>track.neteaseId)).toEqual(['1','2','3']);
 expect(f.request).not.toHaveBeenCalled();expect(f.flush).toHaveBeenCalledTimes(2);expect(f.limit).toHaveBeenCalledTimes(3);
 expect(musicMethods.has('batch')).toBe(false);await expect(f.netease.call('batch',{'/api/private/write':'{}'})).rejects.toThrow('NETEASE_METHOD_NOT_ALLOWED');
});
it('reuses per-song idempotency keys and cached links without another upstream batch',async()=>{
 const f=fixture();const first=await f.service.addBatch(f.room.id,f.user,f.items),retry=await f.service.addBatch(f.room.id,f.user,f.items);
 expect(retry).toEqual(first);expect(f.api).toHaveBeenCalledOnce();expect(f.engine.snapshot(f.room.id).playlist).toHaveLength(3);
 const fresh=f.items.map(item=>({...item,requestId:randomUUID()}));await f.service.addBatch(f.room.id,f.user,fresh);
 expect(f.api).toHaveBeenCalledOnce();expect(f.engine.snapshot(f.room.id).playlist).toHaveLength(6);
 await expect(f.service.addBatch(f.room.id,f.user,[{...f.items[0],songId:'9'}])).rejects.toThrow('COMMAND_ID_REUSED');
});
it('returns per-song failures while keeping successful items in order, and retries only failures',async()=>{
 const f=fixture(),api=f.api.getMockImplementation()!;
 f.api.mockImplementationOnce(async(name,params)=>{const result=await api(name,params);result.body[urlRoute].data[1].url='';return result;});
 const result=await f.service.addBatch(f.room.id,f.user,f.items);
 expect(result.map(item=>item.ok)).toEqual([true,false,true]);expect(result[1]).toMatchObject({songId:'2',error:'MUSIC_NOT_AVAILABLE'});
 expect(f.engine.snapshot(f.room.id).playlist.map(track=>track.neteaseId)).toEqual(['1','3']);
 const retried=await f.service.addBatch(f.room.id,f.user,[f.items[1]]);expect(retried[0].ok).toBe(true);expect(f.api).toHaveBeenCalledTimes(2);
 expect((f.api.mock.calls[1][1][urlRoute] as {ids:string}).ids).toBe('["2"]');
});
it('validates input, authentication, capacity and membership before contacting upstream',async()=>{
 const f=fixture();
 await expect(f.controller.addNeteaseBatch(f.room.id,{items:f.items})).rejects.toMatchObject({status:401});
 for(const items of [[],Array(51).fill(f.items[0]),[f.items[0],f.items[0]],[{songId:'not-id',requestId:randomUUID()}]])await expect(f.controller.addNeteaseBatch(f.room.id,{items},'Bearer test')).rejects.toMatchObject({status:400});
 await expect(f.controller.addNeteaseBatch(f.room.id,{items:f.items,cookie:'injected'},'Bearer test')).rejects.toMatchObject({status:400});
 await expect(f.service.addBatch(f.room.id,randomUUID(),f.items)).rejects.toThrow('NOT_IN_ROOM');
 const original=f.engine.snapshot.bind(f.engine);vi.spyOn(f.engine,'snapshot').mockImplementation(id=>({...original(id),playlist:Array(199).fill({})}));
 await expect(f.service.addBatch(f.room.id,f.user,f.items)).rejects.toThrow('PLAYLIST_FULL');expect(f.api).not.toHaveBeenCalled();
});
it('rechecks room membership after a pending batch and never enqueues after leaving',async()=>{
 const f=fixture(),api=f.api.getMockImplementation()!;
 f.api.mockImplementationOnce(async(name,params)=>{const result=await api(name,params);f.engine.leave(f.room.id,f.user);return result;});
 const result=await f.service.addBatch(f.room.id,f.user,f.items);
 expect(result.every(item=>!item.ok&&item.error==='NOT_IN_ROOM')).toBe(true);expect(f.engine.snapshot(f.room.id).playlist).toHaveLength(0);
});
it('sanitizes failed batch requests into item failures without falling back to single requests',async()=>{
 const f=fixture();f.api.mockRejectedValueOnce(new Error('private upstream URL'));
 const result=await f.service.addBatch(f.room.id,f.user,f.items);
 expect(result.every(item=>!item.ok&&item.error==='NETEASE_UNAVAILABLE')).toBe(true);expect(f.api).toHaveBeenCalledOnce();expect(f.engine.snapshot(f.room.id).playlist).toHaveLength(0);
});
it('rejects malformed batch envelopes and bounds internal calls',async()=>{
 const f=fixture();f.api.mockResolvedValueOnce({body:{code:200,[detailRoute]:{code:200,songs:[]},[urlRoute]:{code:403,data:[]}}} as any);
 await expect(f.netease.songBatch(['1'])).rejects.toThrow('NETEASE_UNAVAILABLE');
 for(const ids of [[],['1','1'],Array.from({length:51},(_,i)=>String(i+1)),['/api/private']])await expect(f.netease.songBatch(ids)).rejects.toThrow('INVALID_REQUEST');
 expect(f.api).toHaveBeenCalledOnce();
});

it('bounds concurrent batch tasks while coalescing successful enqueue identities',async()=>{
 const f=fixture(),api=f.api.getMockImplementation()!;
 const finishes:Array<()=>Promise<void>>=[];
 f.api.mockImplementation((name,params)=>new Promise(resolve=>finishes.push(async()=>resolve(await api(name,params)))));
 const first=f.service.addBatch(f.room.id,f.user,f.items),second=f.service.addBatch(f.room.id,f.user,f.items);
 for(let i=0;i<20&&finishes.length<2;i++)await Promise.resolve();
 await expect(f.service.addBatch(f.room.id,f.user,f.items)).rejects.toThrow('MUSIC_IMPORT_BUSY');
 await Promise.all(finishes.map(finish=>finish()));
 expect(await second).toEqual(await first);expect(f.engine.snapshot(f.room.id).playlist).toHaveLength(3);
});
it('accepts QQ batches through the project endpoint without pretending QQ supports Hana batch',async()=>{
 const f=fixture(),audio=vi.fn(async(mid:string)=>({song:{name:'QQ '+mid,artists:'artist',album:'album',coverUrl:'',durationMs:120000},url:`https://isure.stream.qqmusic.qq.com/${mid}.mp3`,detail:{file:{size_128mp3:4}}}));
 const service=new MusicImport(f.engine,f.netease,f.request,f.db,()=>1000,{audio});
 // Register sources from this instance for the real engine's existing source guard.
 vi.spyOn(f.service,'registered').mockImplementation((url,key)=>service.registered(url,key));
 const controller=new ApiController({auth:{verify:async()=>({id:f.user})},musicImport:service,flush:f.flush,limit:f.limit} as any);
 const items=['001ABC','002ABC'].map(songId=>({songId,requestId:randomUUID()}));
 const result=await controller.addQqBatch(f.room.id,{items},'Bearer test');
 expect(result?.results.every(item=>item.ok)).toBe(true);expect(audio).toHaveBeenCalledTimes(2);expect(f.api).not.toHaveBeenCalled();expect(f.request).not.toHaveBeenCalled();
 expect(f.engine.snapshot(f.room.id).playlist.map(track=>track.qqId)).toEqual(['001ABC','002ABC']);
 await controller.addQqBatch(f.room.id,{items},'Bearer test');expect(audio).toHaveBeenCalledTimes(2);expect(f.engine.snapshot(f.room.id).playlist).toHaveLength(2);
});

it('regresses the all-50-invalid-response failure through the actual worker serialization boundary',async()=>{
 const f=fixture();
 const module='data:text/javascript;base64,'+Buffer.from(`
 export async function invokeModule(){return {status:200,body:{code:400},cookie:[]};}
 export async function createRequest(path,data){
  if(path!=='/api/batch'||typeof data['/api/v3/song/detail']!=='string'||typeof data['/api/song/enhance/player/url']!=='string')return {status:200,body:{code:400},cookie:[]};
  const ids=JSON.parse(JSON.parse(data['/api/song/enhance/player/url']).ids);
  return {status:200,cookie:[],body:{code:200,'/api/v3/song/detail':{code:200,songs:ids.map(id=>({id,name:'song '+id,dt:120000}))},'/api/song/enhance/player/url':{code:200,data:ids.map(id=>({id,url:'https://m801.music.126.net/'+id+'.mp3',size:4,type:'mp3',code:200,expi:300}))}}};
 }`).toString('base64');
 const api=vi.fn(createHanaInvoker(module)),netease=new NeteaseService(f.db,api,()=>1000);
 const importer=new MusicImport(f.engine,netease,f.request,f.db,()=>1000);
 vi.spyOn(f.service,'registered').mockImplementation((url,key)=>importer.registered(url,key));
 const items=Array.from({length:50},(_,i)=>({songId:String(i+1),requestId:randomUUID()}));
 const results=await importer.addBatch(f.room.id,f.user,items);
 expect(results.every(result=>result.ok)).toBe(true);expect(f.engine.snapshot(f.room.id).playlist).toHaveLength(50);
 expect(api).toHaveBeenCalledOnce();expect(api.mock.calls[0][0]).toBe('batch');expect(f.request).not.toHaveBeenCalled();
});

it('single enqueue and forced renewal both use one fixed batch instead of a direct song_url call',async()=>{
 const f=fixture(),track=await f.service.add(f.room.id,f.user,'1',randomUUID());
 expect(track.neteaseId).toBe('1');expect(f.api).toHaveBeenCalledOnce();
 expect(f.api.mock.calls[0][0]).toBe('batch');expect((f.api.mock.calls[0][1][urlRoute] as {ids:string}).ids).toBe('["1"]');
 const prior=f.engine.snapshot(f.room.id),source=await f.service.playbackSource(f.room.id,f.user,track.id,true);
 expect(source.contentHash).toBe(track.contentHash);expect(f.api).toHaveBeenCalledTimes(2);
 expect(f.api.mock.calls.every(([name])=>name==='batch')).toBe(true);expect(f.engine.snapshot(f.room.id)).toEqual(prior);
 expect(f.request).not.toHaveBeenCalled();
});
it('renews a proxy CDN 403 via the fixed batch once without retrying the direct endpoint',async()=>{
 const f=fixture(),track=await f.service.add(f.room.id,f.user,'1',randomUUID());
 f.request.mockResolvedValueOnce(new Response(null,{status:403})).mockResolvedValueOnce(new Response(new Uint8Array([1,2,3,4])));
 const before=f.engine.snapshot(f.room.id);expect(await f.service.readAudio(f.room.id,f.user,track.id)).toEqual(Buffer.from([1,2,3,4]));
 expect(f.api.mock.calls.map(([name])=>name)).toEqual(['batch','batch']);expect(f.request).toHaveBeenCalledTimes(2);
 expect(f.engine.snapshot(f.room.id)).toEqual(before);
});
it('does not fall back or loop when the batch route is itself rejected for a single song',async()=>{
 const f=fixture();f.api.mockRejectedValueOnce({status:400,body:{code:-460}});
 await expect(f.service.add(f.room.id,f.user,'1',randomUUID())).rejects.toThrow('NETEASE_UNAVAILABLE');
 expect(f.api).toHaveBeenCalledOnce();expect(f.api.mock.calls[0][0]).toBe('batch');expect(f.engine.snapshot(f.room.id).playlist).toHaveLength(0);
});

it.each([
 [{code:400,msg:'private upstream body'},'NETEASE_UNAVAILABLE','business_rejected','batch'],
 [{code:200,[detailRoute]:{code:200,songs:[]},[urlRoute]:{code:-460,msg:'private upstream body'}},'NETEASE_UNAVAILABLE','business_rejected','song_url'],
 [{code:200,[detailRoute]:{code:301},[urlRoute]:{code:200,data:[]}},'NETEASE_LOGIN_REQUIRED','business_rejected','song_detail'],
 [{code:200,[detailRoute]:{code:200,songs:{}},[urlRoute]:{code:200,data:[]}},'NETEASE_INVALID_RESPONSE','response_shape','song_detail'],
 [{code:200,[detailRoute]:{code:200,songs:[]},[urlRoute]:'private unexpected string'},'NETEASE_INVALID_RESPONSE','response_shape','song_url'],
])('distinguishes business rejection from shape errors using only sanitized batch diagnostics',async(body,error,phase,stage)=>{
 const f=fixture();f.api.mockResolvedValueOnce({body} as any);
 await expect(f.netease.songBatch(['1'])).rejects.toThrow(error);
 expect(f.log).toHaveBeenCalledOnce();const line=f.log.mock.calls[0][0] as string;
 expect(line.startsWith('网易云 batch 响应校验失败 ')).toBe(true);
 expect(JSON.parse(line.slice('网易云 batch 响应校验失败 '.length))).toMatchObject({phase,stage});
 expect(line).not.toContain('private');expect(line).not.toContain('http');expect(f.api).toHaveBeenCalledOnce();
});
it('does not mark all nested -460 failures as invalid response or issue fifty extra requests',async()=>{
 const f=fixture();f.api.mockResolvedValueOnce({body:{code:200,[detailRoute]:{code:200,songs:[]},[urlRoute]:{code:-460,msg:'private',cookie:'private'}}} as any);
 const items=Array.from({length:50},(_,i)=>({songId:String(i+1),requestId:randomUUID()}));
 const result=await f.service.addBatch(f.room.id,f.user,items);
 expect(result).toHaveLength(50);expect(result.every(item=>!item.ok&&item.error==='NETEASE_UNAVAILABLE')).toBe(true);
 expect(f.api).toHaveBeenCalledOnce();expect(f.log).toHaveBeenCalledOnce();
 const diagnostic=JSON.parse((f.log.mock.calls[0][0] as string).slice('网易云 batch 响应校验失败 '.length));
 expect(diagnostic).toMatchObject({phase:'business_rejected',stage:'song_url',rootCode:200,sourceCode:-460});
 expect(f.engine.snapshot(f.room.id).playlist).toHaveLength(0);
});

it('disables v1 direct-link proxy calls and sends only the non-v1 source route with 128K bitrate',async()=>{
 const f=fixture();
 expect(musicMethods.has('song_url_v1')).toBe(false);
 await expect(f.netease.call('song_url_v1',{id:'1',level:'standard'})).rejects.toThrow('NETEASE_METHOD_NOT_ALLOWED');
 expect(f.api).not.toHaveBeenCalled();
 await f.service.addBatch(f.room.id,f.user,f.items);
 const payload=f.api.mock.calls[0][1];expect(payload[urlRoute]).toEqual({ids:'["1","2","3"]',br:128000});
 expect(payload).not.toHaveProperty('/api/song/enhance/player/url/v1');
 expect(Object.values(payload).some(value=>value&&typeof value==='object'&&('level' in value||'encodeType' in value))).toBe(false);
});
