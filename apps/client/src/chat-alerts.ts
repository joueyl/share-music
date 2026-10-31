import type { ChatMessage } from '@music-share/shared';
export interface ChatAlertContext { roomId:string; userId:string; roomName:string }
export interface ChatAlertPayload { title:string; body:string }
export interface ChatAlertResult { notificationRequested:boolean; attentionRequested:boolean }
export function createChatAlerts(ports:{
 desktop:boolean; context:()=>ChatAlertContext|null;
 notify:(payload:ChatAlertPayload)=>Promise<ChatAlertResult>;
 clearAttention:()=>Promise<unknown>;
 sound:{play:(current:()=>boolean)=>Promise<void>;stop:()=>void};
 error:(message:string)=>void;
}){
 let generation=0,requested=false;
 const seen=new Set<string>(),reported=new Set<string>();
 function remember(id:string){seen.add(id);if(seen.size>200)seen.delete(seen.values().next().value!);}
 function report(code:string){if(!reported.has(code)){reported.add(code);ports.error(code);}}
 return {
  seed(messages:ChatMessage[]){for(const message of messages)remember(message.id);},
  receive(message:ChatMessage){
   const context=ports.context();
   if(!ports.desktop||!context||message.roomId!==context.roomId||message.userId===context.userId||message.kind==='activity'||seen.has(message.id))return;
   remember(message.id);requested=true;
   const epoch=generation,current=()=>{const c=ports.context();return epoch===generation&&c?.roomId===context.roomId&&c.userId===context.userId;};
   const payload={title:`${context.roomName} · ${message.userName}`.slice(0,200),body:message.text.slice(0,1000)};
   void Promise.resolve().then(()=>current()?ports.notify(payload):undefined).then(result=>{
    if(!current()||!result)return;
    if(!result.notificationRequested)report('CHAT_NOTIFICATION_FAILED');
    if(!result.attentionRequested)report('CHAT_ATTENTION_FAILED');
   }).catch(()=>{if(current())report('CHAT_NOTIFICATION_FAILED');});
   void ports.sound.play(current).catch(()=>{if(current())report('CHAT_NOTIFICATION_SOUND_FAILED');});
  },
  reset(){generation++;seen.clear();reported.clear();ports.sound.stop();if(requested){requested=false;void ports.clearAttention().catch(()=>{});}},
 };
}
