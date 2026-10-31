/** A short Web Audio effect, independent of the sole music HTMLAudioElement. */
export function createChatSound(url:string){
 let context:AudioContext|undefined,buffer:Promise<AudioBuffer>|undefined,source:AudioBufferSourceNode|undefined;
 function ctx(){if(!context){if(typeof AudioContext==='undefined')throw new Error('CHAT_NOTIFICATION_SOUND_FAILED');context=new AudioContext();}return context;}
 async function prepare(){
  const c=ctx();if(c.state==='suspended')await c.resume();
  if(!buffer)buffer=fetch(url).then(r=>{if(!r.ok)throw new Error('SOUND_LOAD_FAILED');return r.arrayBuffer();}).then(bytes=>c.decodeAudioData(bytes)).catch(e=>{buffer=undefined;throw e;});
  return buffer;
 }
 function stop(){if(source){try{source.stop();}catch{/* Already ended. */}source.disconnect();source=undefined;}}
 return {
  async play(current:()=>boolean){
   if(!current())return;
   let timer:ReturnType<typeof setTimeout>|undefined;
   let data:AudioBuffer;
   try{data=await Promise.race([prepare(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('SOUND_TIMEOUT')),5000);})]);}
   finally{if(timer)clearTimeout(timer);}
   const c=ctx();if(!current())return;
   if(c.state!=='running')throw new Error('CHAT_NOTIFICATION_SOUND_FAILED');
   stop();const next=c.createBufferSource();next.buffer=data;next.connect(c.destination);source=next;
   next.onended=()=>{next.disconnect();if(source===next)source=undefined;};next.start();
  },
  stop,
  unlock(){void prepare().catch(()=>{});},
  dispose(){stop();if(context)void context.close().catch(()=>{});context=undefined;buffer=undefined;},
 };
}
