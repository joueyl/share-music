// The stored QQ session resolver refreshes eligible credentials near expiry on request.
// Probe even when nobody is listening; never issue parallel or immediate retry requests.
export class QqSessionKeepalive {
 private timer?:ReturnType<typeof setTimeout>;
 private pending?:Promise<void>;
 private controller?:AbortController;
 private stopped=true;
 constructor(private run:(signal:AbortSignal)=>Promise<void>,private log:(message:string)=>void=message=>console.warn(message),private intervalMs=30*60*1000){}
 start(){
  if(!this.stopped)return;
  this.stopped=false;this.tick();
 }
 private tick(){
  if(this.stopped)return;
  const controller=this.controller=new AbortController();
  this.pending=Promise.resolve().then(()=>{if(!this.stopped)return this.run(AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]));})
   .catch(()=>{if(!this.stopped)this.log('QQ session renewal check failed; retry at the next scheduled interval.');})
   .finally(()=>{
    this.pending=undefined;this.controller=undefined;
    if(!this.stopped){this.timer=setTimeout(()=>this.tick(),this.intervalMs);this.timer.unref?.();}
   });
 }
 async stop(){this.stopped=true;clearTimeout(this.timer);this.controller?.abort();await this.pending;}
}
