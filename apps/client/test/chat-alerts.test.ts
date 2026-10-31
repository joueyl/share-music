import { expect, it, vi } from 'vitest';
import { createChatAlerts } from '../src/chat-alerts';
import type { ChatMessage } from '@music-share/shared';
const message=(id:string,changes:Partial<ChatMessage>={}):ChatMessage=>({id,requestId:id,roomId:'room',userId:'other',userName:'成员',text:'你好',sentAt:1,...changes});
const settle=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
function fixture(desktop=true){
 let context:any={roomId:'room',userId:'me',roomName:'测试房间'};
 const ports={desktop,context:()=>context,notify:vi.fn().mockResolvedValue({notificationRequested:true,attentionRequested:true}),clearAttention:vi.fn().mockResolvedValue(undefined),sound:{play:vi.fn().mockResolvedValue(undefined),stop:vi.fn()},error:vi.fn()};
 return {ports,alerts:createChatAlerts(ports),change:(value:any)=>context=value};
}
it('requests native notification, sound and attention once for an incoming ordinary message',async()=>{
 const {ports,alerts}=fixture();alerts.receive(message('new'));alerts.receive(message('new'));await settle();
 expect(ports.notify).toHaveBeenCalledExactlyOnceWith({title:'测试房间 · 成员',body:'你好'});expect(ports.sound.play).toHaveBeenCalledOnce();
 expect(ports.sound.play.mock.calls[0][0]()).toBe(true);
});
it('does not alert for initial/replayed history, own messages, activities, other rooms or browser-only clients',async()=>{
 const {ports,alerts}=fixture();alerts.seed([message('history')]);
 for(const m of [message('history'),message('own',{userId:'me'}),message('activity',{kind:'activity'}),message('foreign',{roomId:'elsewhere'})])alerts.receive(m);
 const browser=fixture(false);browser.alerts.receive(message('new'));await settle();
 expect(ports.notify).not.toHaveBeenCalled();expect(ports.sound.play).not.toHaveBeenCalled();expect(browser.ports.notify).not.toHaveBeenCalled();
});
it('invalidates pending work and sound when leaving, logging out or changing rooms',async()=>{
 const {ports,alerts,change}=fixture();alerts.receive(message('new'));const current=ports.sound.play.mock.calls[0][0];alerts.reset();change(null);await settle();
 expect(current()).toBe(false);expect(ports.notify).not.toHaveBeenCalled();expect(ports.sound.stop).toHaveBeenCalled();expect(ports.clearAttention).toHaveBeenCalledOnce();
});
it('reports each optional integration failure once without throwing or suppressing other alerts',async()=>{
 const {ports,alerts}=fixture();ports.notify.mockResolvedValue({notificationRequested:false,attentionRequested:false});ports.sound.play.mockRejectedValue(new Error('denied'));
 alerts.receive(message('one'));alerts.receive(message('two'));await settle();
 expect(ports.notify).toHaveBeenCalledTimes(2);expect(ports.error.mock.calls.map(c=>c[0]).sort()).toEqual(['CHAT_ATTENTION_FAILED','CHAT_NOTIFICATION_FAILED','CHAT_NOTIFICATION_SOUND_FAILED']);
});
