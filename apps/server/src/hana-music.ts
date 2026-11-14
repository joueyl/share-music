import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { DomainError } from './engine';

export type MusicResult = { body: Record<string, any>; cookie?: string[] };
export type MusicInvoker = (name: string, params: Record<string, unknown>) => Promise<MusicResult>;
export const HANA_MAX_WORKERS = 4;

// Dynamic import stays inside native Worker JavaScript, so the CommonJS server
// never rewrites it to require() against hana's ESM-only public SDK.
export const hanaWorkerSource = `
const {parentPort,workerData}=require('node:worker_threads');
const reply=message=>parentPort.postMessage({kind:'music-share:hana-result',...message});
(async()=>{
 let phase='import',upstreamStep;
 try {
  const {invokeModule,createRequest}=await import(workerData.module);
  const {cookie='',timestamp,noCookie,realIP,...query}=workerData.params;
  phase='request';
  const config={
   cookie,realIP:'122.228.189.154',timeoutMs:15000,retry:{retries:0,retryNonIdempotent:false},
   onRequestEvent:event=>{
    // Only fixed endpoint labels leave the worker, never URLs, headers or messages.
    try {
     const path=new URL(event.url).pathname;
     upstreamStep=/^\\/(?:api|weapi|eapi)\\/register\\/anonimous$/.test(path)?'anonymous_registration':
      /^\\/(?:api|weapi|eapi)\\/song\\/enhance\\/player\\/url$/.test(path)?'song_url':
      /^\\/(?:api|weapi|eapi)\\/batch$/.test(path)?'batch':undefined;
    }catch{upstreamStep=undefined;}
   }
  };
  let result;
  if(workerData.name==='batch'){
   // Hana 3.2.0 batch input accepts objects, but the upstream batch wire format
   // requires JSON strings. Use its public request API for only our two read routes.
   const routes=['/api/v3/song/detail','/api/song/enhance/player/url'];
   if(Object.keys(query).length!==routes.length||routes.some(route=>!query[route]||typeof query[route]!=='object'||Array.isArray(query[route])))throw Error('Invalid internal batch input');
   const data=Object.fromEntries(routes.map(route=>[route,JSON.stringify(query[route])]));
   result=await createRequest('/api/batch',data,config);
  }else if(workerData.name==='scrobble'){
   // The SDK scrobble module forcibly overrides os/osver with macOS values.
   // Keep its two fixed events, using the public request API for a Windows identity.
   if(!/^\\d{1,20}$/.test(String(query.id??''))||!/^\\d{1,20}$/.test(String(query.sourceid??''))||
      !Number.isInteger(query.time)||query.time<1||query.time>86400)throw Error('Invalid internal scrobble input');
   const identity=typeof cookie==='string'?Object.fromEntries(cookie.split(';').flatMap(part=>{
    const i=part.indexOf('=');return i>0?[[part.slice(0,i).trim(),part.slice(i+1).trim()]]:[];
   })):{...cookie};
   const windows={...config,crypto:'eapi',domain:'https://clientlog.music.163.com',
    ua:'NeteaseMusic/3.1.17.204416 (Windows NT 10.0; Win64; x64)',
    cookie:{...identity,os:'pc',osver:'Microsoft-Windows-10-Professional-build-19045-64bit',
     mobilename:'Windows 10',appver:'3.1.17.204416',channel:'netease'}};
   const common={id:query.id,type:'song',mainsite:'1',mainsiteWeb:'1',content:'id='+String(query.sourceid)};
   for(const event of [
    {action:'startplay',json:common},
    {action:'play',json:{...common,download:0,end:'playend',sourceId:query.sourceid,time:query.time,wifi:0,source:'list'}}
   ]){
    result=await createRequest('/api/feedback/weblog',{logs:JSON.stringify([event])},windows);
    if(!Number.isInteger(result?.status)||result.status<200||result.status>=300||
       !result.body||typeof result.body!=='object'||!Number.isInteger(result.body.code)||!Array.isArray(result.cookie))throw Error('Invalid scrobble response');
    if(result.body.code!==200)throw {status:result.status,body:{code:result.body.code}};
   }
  }else result=await invokeModule(workerData.name,query,config);
  phase='invalid_response';
  if(!Number.isInteger(result?.status)||result.status<200||result.status>=300||
     !result.body||typeof result.body!=='object'||Array.isArray(result.body)||!Array.isArray(result.cookie))throw Error('Invalid SDK response');
  reply({ok:true,result:{body:result.body,cookie:result.cookie}});
 } catch(error) {
  // Preserve login business codes, never raw upstream errors or credentials.
  if(workerData.name==='daily_signin'&&error?.body?.code===-2)
   reply({ok:true,result:{body:{code:-2}}});
  else if(['login','login_cellphone'].includes(workerData.name)&&Number.isInteger(error?.body?.code)&&error.body.code!==200&&!error.body.upstreamShape)
   reply({ok:true,result:{body:{code:error.body.code}}});
  else if(workerData.name==='scrobble'&&Number.isInteger(error?.body?.code)&&error.body.code!==200&&
          ![499,502,504].includes(error.status)&&!error.body.upstreamShape)
   reply({ok:true,result:{body:error.body,cookie:[]}});
  else reply({ok:false,diagnostic:{phase:error?.body?.upstreamShape?'response_shape':phase,
   upstreamStep,status:error?.status,bodyCode:error?.body?.code,shapePath:error?.body?.upstreamShape?.path}});
 }
})();
`;

export function createHanaInvoker(moduleUrl?: string, timeoutMs = 18000, log:(message:string)=>void=message=>console.warn(message)): MusicInvoker {
 let active=0;
 return (name,params)=>new Promise((resolve,reject)=>{
  // Lyrics, recommendations, imports and account jobs share the default invoker.
  // Reject overload before constructing a worker; do not retain stale requests in a queue.
  if(active>=HANA_MAX_WORKERS){reject(new DomainError('NETEASE_UNAVAILABLE'));return;}
  let worker:Worker;
  try {worker=new Worker(hanaWorkerSource,{
   eval:true,workerData:{module:moduleUrl??pathToFileURL(require.resolve('hana-music-api')).href,name,params},
   stdout:true,stderr:true,
  });} catch {
   log('网易云 SDK 调用失败 '+JSON.stringify({method:/^[a-z][a-z0-9_]{0,49}$/.test(name)?name:'unknown',phase:'worker_setup'}));
   reject(new DomainError('NETEASE_UNAVAILABLE'));return;
  }
  active++;
  worker.stdout?.resume();worker.stderr?.resume();
  let settled=false;
  const finish=async(result?:MusicResult,diagnostic?:{phase?:unknown;status?:unknown;bodyCode?:unknown;shapePath?:unknown;upstreamStep?:unknown})=>{
   if(settled)return;settled=true;clearTimeout(timer);
   // terminate() is asynchronous. Keep the slot until the old isolate actually
   // exits, otherwise fast results can create overlapping SDK heaps indefinitely.
   await worker.terminate();
   worker.removeAllListeners();active--;
   if(result)resolve(result);else {
    // Only fixed stages, numeric codes and schema field paths leave the worker.
    // Never log raw errors, response bodies, request params, cookies or URLs.
    const phase=['import','request','invalid_response','response_shape','timeout','worker_error','worker_exit'].includes(String(diagnostic?.phase))?diagnostic!.phase:'unknown';
    const numeric=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&Math.abs(value)<=100000?value:undefined;
    const shapePath=typeof diagnostic?.shapePath==='string'&&/^[$a-zA-Z_][\w$.\[\]-]{0,160}$/.test(diagnostic.shapePath)?diagnostic.shapePath:undefined;
    log('网易云 SDK 调用失败 '+JSON.stringify({method:/^[a-z][a-z0-9_]{0,49}$/.test(name)?name:'unknown',phase,
     status:numeric(diagnostic?.status),bodyCode:numeric(diagnostic?.bodyCode),shapePath,
     upstreamStep:['anonymous_registration','song_url','batch'].includes(String(diagnostic?.upstreamStep))?diagnostic!.upstreamStep:undefined}));
    reject(new DomainError('NETEASE_UNAVAILABLE'));
   }
  };
  const timer=setTimeout(()=>finish(undefined,{phase:'timeout'}),timeoutMs);
  // Node --watch and loaders can also report dependencies through parentPort.
  // Only our own result envelope may settle and terminate this worker.
  worker.on('message',message=>{
   if(message?.kind!=='music-share:hana-result'||typeof message.ok!=='boolean')return;
   finish(message.ok?message.result:undefined,message.diagnostic);
  });
  worker.once('error',()=>finish(undefined,{phase:'worker_error'}));
  worker.once('exit',()=>finish(undefined,{phase:'worker_exit'}));
 });
}

export const invokeHana=createHanaInvoker();
