import { pathToFileURL } from 'node:url';
import { expect, it, vi } from 'vitest';
import { createHanaInvoker } from '../src/hana-music';

const moduleUrl=(source:string)=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const params={id:'42',sourceid:'7',time:12,total:185,cookie:'MUSIC_U=fixture'};
const fixedCookie='MUSIC_U=fixture; mode=Windows 10; mobilename=Windows 10';

it('loads only the installed Enhanced module through the default worker route',async()=>{
 const log=vi.fn();
 // No MUSIC_U makes the installed SDK reject locally before either upload.
 await expect(createHanaInvoker(undefined,18000,log)('scrobble_v1',{...params,cookie:''})).rejects.toThrow('NETEASE_UNAVAILABLE');
 expect(log).toHaveBeenCalledWith(expect.stringContaining('"phase":"invalid_response"'));
});

it.each([0,1,2])('runs Enhanced NCBL offline and handles %i acknowledged uploads',async acknowledged=>{
 const entry=pathToFileURL(require.resolve('@neteasecloudmusicapienhanced/api/module/scrobble_v1.js')).href;
 const invoke=createHanaInvoker(moduleUrl(`
  import {createRequire} from 'node:module';
  import scrobble from ${JSON.stringify(entry)};
  const axios=createRequire(${JSON.stringify(entry)})('axios');
  export default async function(query){
   if(JSON.stringify(query)!==${JSON.stringify(JSON.stringify({...params,cookie:fixedCookie}))})throw Error('unexpected query or overrides');
   let calls=0;
   axios.defaults.adapter=async config=>{
    if(!config.url.includes('/api/clientlog/encrypt/upload')||config.method!=='post'||
       !config.headers.get('Cookie').split(';').map(part=>part.trim()).includes('mode=Windows 10')||
       !config.headers.get('Cookie').includes('MUSIC_U=fixture'))throw Error('unexpected upload');
    const filename=String(config.data).match(/filename="([^"]+)"/)?.[1];
    if(!filename)throw Error('missing encrypted file');
    return {status:200,headers:{},data:{code:200,data:{successfiles:++calls<=${acknowledged}?[filename]:[]}}};
   };
   const result=await scrobble(query);
   if(calls!==${acknowledged===0?1:2})throw Error('unexpected upload count');
   return result;
  }`));
 const {body}=await invoke('scrobble_v1',{...params,
  cookie:acknowledged===0?params.cookie:'mode=old-pc; MUSIC_U=fixture; mobilename=old-phone; mode=duplicate',
  timestamp:123,proxy:'ignored'});
 if(acknowledged===2){
  expect(body.code).toBe(200);
  expect(body.details.plv.payloadSize).toBeGreaterThan(0);
  expect(body.details.pld.payloadSize).toBeGreaterThan(0);
 }else expect(body).toMatchObject({code:-1,upstreamCode:200});
});

it('preserves actual business rejection but does not expose SDK transport exceptions or retry',async()=>{
 const log=vi.fn();
 const invoke=createHanaInvoker(moduleUrl(`export default async ({id})=>id==='42'
  ?{status:200,body:{code:403,msg:'rejected'}}
  :{status:502,body:{code:502,msg:'private exception'}};`),18000,log);
 expect(await invoke('scrobble_v1',params)).toEqual({body:{code:403,msg:'rejected'}});
 await expect(invoke('scrobble_v1',{...params,id:'43'})).rejects.toThrow('NETEASE_UNAVAILABLE');
 expect(log).toHaveBeenCalledOnce();
 expect(log.mock.calls[0][0]).not.toContain('private exception');
});
