import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { DatabaseStore } from './database';
import { DomainError } from './engine';

// The pinned package starts an unrestricted HTTP listener on import. Its public
// non-listening mode (NODE_ENV=test) affects only logging, Explorer/update checks
// and that listener in 3.3.5; it does not substitute network/auth implementations.
// Isolate that setting and all upstream output in a worker, then expose the real
// Koa callback only on an ephemeral loopback port, never on the public Nest port.
const workerSource = `
const {parentPort,workerData}=require('node:worker_threads');
const {mkdirSync}=require('node:fs');
const {createServer}=require('node:http');
try {
 mkdirSync(workerData.directory,{recursive:true,mode:0o700});
 const upstream=require(workerData.entry);
 if(upstream.server!==null)throw Error('Unexpected upstream listener');
 const server=createServer(upstream.default.callback());
 server.on('error',()=>{parentPort.postMessage({error:true});});
 server.listen(0,'127.0.0.1',()=>parentPort.postMessage({port:server.address().port}));
} catch {parentPort.postMessage({error:true});}
`;

export class EmbeddedQqRuntime {
 private worker?:Worker;
 private pending?:Promise<string>;
 private closed=false;
 constructor(private db:DatabaseStore,private directory=resolve(process.env.QQ_MUSIC_STATE_DIR?.trim()||'.qq-music')){}
 url():Promise<string>{
  if(this.closed)return Promise.reject(new DomainError('QQ_MUSIC_UNAVAILABLE'));
  if(!this.pending){
   this.pending=this.start().catch(e=>{this.pending=undefined;throw e;});
  }
  return this.pending;
 }
 private async start():Promise<string>{
  let secret=await this.db.getSetting('qq.embedded.secret');
  if(!secret){secret=randomBytes(32).toString('base64url');await this.db.setSetting('qq.embedded.secret',secret);}
  if(this.closed)throw new DomainError('QQ_MUSIC_UNAVAILABLE');
  const env:Record<string,string>={};
  for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','HOME','USERPROFILE','HTTP_PROXY','HTTPS_PROXY','NO_PROXY'])if(process.env[key])env[key]=process.env[key]!;
  Object.assign(env,{NODE_ENV:'test',LOG_LEVEL:'silent',AUTO_OPEN_EXPLORER:'false',QQ_DISABLE_UPDATE_CHECK:'true',
   QQ_SESSION_SECRET:secret,QQ_AUTH_STATE_PATH:resolve(this.directory,'device.json'),QQ_AUTH_SESSION_PATH:resolve(this.directory,'sessions.enc')});
  const worker=this.worker=new Worker(workerSource,{eval:true,workerData:{entry:require.resolve('@yakult-green-tea/qq-music-api'),directory:this.directory},env,stdout:true,stderr:true});
  worker.stdout?.resume();worker.stderr?.resume();
  return new Promise((resolveUrl,reject)=>{
   let ready=false;
   const fail=()=>{clearTimeout(timer);if(this.worker===worker){this.worker=undefined;this.pending=undefined;}void worker.terminate();if(!ready)reject(new DomainError('QQ_MUSIC_UNAVAILABLE'));};
   const timer=setTimeout(fail,15000);
   worker.on('error',fail);worker.on('exit',()=>{clearTimeout(timer);if(this.worker===worker){this.worker=undefined;this.pending=undefined;}if(!ready)reject(new DomainError('QQ_MUSIC_UNAVAILABLE'));});
   worker.once('message',value=>{
    if(!Number.isInteger(value?.port)||value.port<1||value.port>65535){fail();return;}
    clearTimeout(timer);ready=true;worker.unref();resolveUrl('http://127.0.0.1:'+value.port);
   });
  });
 }
 async close(){this.closed=true;const worker=this.worker;this.worker=undefined;this.pending=undefined;if(worker)await worker.terminate();}
}
