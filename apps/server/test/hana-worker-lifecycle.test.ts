import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';

const workers=vi.hoisted(()=>[] as any[]);
vi.mock('node:worker_threads',()=>({Worker:class extends EventEmitter {
 stdout={resume:vi.fn()};stderr={resume:vi.fn()};
 completeTermination!:()=>void;
 terminate=vi.fn(()=>new Promise<number>(resolve=>{this.completeTermination=()=>resolve(1);}));
 constructor(){super();workers.push(this);}
}}));
import { createHanaInvoker, HANA_MAX_WORKERS } from '../src/hana-music';

it('keeps terminating workers counted and does not settle callers before isolates exit',async()=>{
 const invoke=createHanaInvoker('file:///offline-fixture.mjs',18000,()=>{});
 const calls=Array.from({length:HANA_MAX_WORKERS},()=>invoke('lyric_new',{}));
 const result={body:{code:200},cookie:[]};
 let settled=false;const completed=Promise.all(calls).then(value=>{settled=true;return value;});
 for(const worker of workers){
  worker.emit('message',{kind:'music-share:hana-result',ok:true,result});
  // Exit/error events during termination must not release the slot twice.
  worker.emit('error',Error('offline fixture'));
  worker.emit('exit',1);
  expect(worker.terminate).toHaveBeenCalledTimes(1);
 }
 try {
  await Promise.resolve();expect(settled).toBe(false);
  await expect(invoke('song_url',{})).rejects.toThrow('NETEASE_UNAVAILABLE');
  expect(workers).toHaveLength(HANA_MAX_WORKERS);
 } finally {
  for(const worker of workers)worker.completeTermination();
  await completed;
 }
 expect(settled).toBe(true);
 const next=Array.from({length:HANA_MAX_WORKERS},()=>invoke('song_url',{}));
 expect(workers).toHaveLength(HANA_MAX_WORKERS*2);
 for(const worker of workers.slice(HANA_MAX_WORKERS)){
  worker.emit('message',{kind:'music-share:hana-result',ok:true,result});
  worker.completeTermination();
 }
 expect(await Promise.all(next)).toEqual(Array(HANA_MAX_WORKERS).fill(result));
 expect(workers.every(worker=>worker.eventNames().length===0)).toBe(true);
});
