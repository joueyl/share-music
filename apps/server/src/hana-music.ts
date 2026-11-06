import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { DomainError } from './engine';

export type MusicResult = { body: Record<string, any>; cookie?: string[] };
export type MusicInvoker = (name: string, params: Record<string, unknown>) => Promise<MusicResult>;

// Dynamic import stays inside native Worker JavaScript, so the CommonJS server
// never rewrites it to require() against hana's ESM-only public SDK.
export const hanaWorkerSource = `
const {parentPort,workerData}=require('node:worker_threads');
const reply=message=>parentPort.postMessage({kind:'music-share:hana-result',...message});
(async()=>{
 let phase='import',upstreamStep;
 try {
  const {invokeModule}=await import(workerData.module);
  const {cookie='',timestamp,noCookie,...query}=workerData.params;
  phase='request';
  const config={
   cookie,timeoutMs:15000,retry:{retries:0,retryNonIdempotent:false},
   onRequestEvent:event=>{
    // Only fixed endpoint labels leave the worker, never URLs, headers or messages.
    try {
     const path=new URL(event.url).pathname;
     upstreamStep=/^\\/(?:api|weapi|eapi)\\/register\\/anonimous$/.test(path)?'anonymous_registration':
      /^\\/(?:api|weapi|eapi)\\/song\\/enhance\\/player\\/url\\/v1$/.test(path)?'song_url_v1':
      /^\\/(?:api|weapi|eapi)\\/batch$/.test(path)?'batch':undefined;
    }catch{upstreamStep=undefined;}
   }
  };
  const result=await invokeModule(workerData.name,query,config);
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
 return (name,params)=>new Promise((resolve,reject)=>{
  let worker:Worker;
  try {worker=new Worker(hanaWorkerSource,{
   eval:true,workerData:{module:moduleUrl??pathToFileURL(require.resolve('hana-music-api')).href,name,params},
   stdout:true,stderr:true,
  });} catch {
   log('网易云 SDK 调用失败 '+JSON.stringify({method:/^[a-z][a-z0-9_]{0,49}$/.test(name)?name:'unknown',phase:'worker_setup'}));
   reject(new DomainError('NETEASE_UNAVAILABLE'));return;
  }
  worker.stdout?.resume();worker.stderr?.resume();
  let settled=false;
  const finish=(result?:MusicResult,diagnostic?:{phase?:unknown;status?:unknown;bodyCode?:unknown;shapePath?:unknown;upstreamStep?:unknown})=>{
   if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();
   if(result)resolve(result);else {
    // Only fixed stages, numeric codes and schema field paths leave the worker.
    // Never log raw errors, response bodies, request params, cookies or URLs.
    const phase=['import','request','invalid_response','response_shape','timeout','worker_error','worker_exit'].includes(String(diagnostic?.phase))?diagnostic!.phase:'unknown';
    const numeric=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&Math.abs(value)<=100000?value:undefined;
    const shapePath=typeof diagnostic?.shapePath==='string'&&/^[$a-zA-Z_][\w$.\[\]-]{0,160}$/.test(diagnostic.shapePath)?diagnostic.shapePath:undefined;
    log('网易云 SDK 调用失败 '+JSON.stringify({method:/^[a-z][a-z0-9_]{0,49}$/.test(name)?name:'unknown',phase,
     status:numeric(diagnostic?.status),bodyCode:numeric(diagnostic?.bodyCode),shapePath,
     upstreamStep:['anonymous_registration','song_url_v1','batch'].includes(String(diagnostic?.upstreamStep))?diagnostic!.upstreamStep:undefined}));
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
