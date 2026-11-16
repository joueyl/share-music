import { expect, it, vi } from 'vitest';
import { openChatFromNotification } from '../src/chat-notification-navigation';
function fixture(){let context:{userId:string;roomId:string}|null={userId:'me',roomId:'room'};const ports={context:()=>context,navigate:vi.fn(async()=>{}),settle:vi.fn(async()=>{}),closeOverlays:vi.fn(),open:vi.fn()};return {ports,change:(v:typeof context)=>context=v};}
it('opens only the current room after routing and rendering, without joining or duplicating a chat',async()=>{
 const {ports}=fixture();await openChatFromNotification(ports);expect(ports.closeOverlays).toHaveBeenCalledOnce();expect(ports.navigate).toHaveBeenCalledExactlyOnceWith('room');expect(ports.settle).toHaveBeenCalledOnce();expect(ports.open).toHaveBeenCalledExactlyOnceWith('room');
});
it.each([null,{userId:'other',roomId:'room'},{userId:'me',roomId:'other'}])('ignores account/room changes during notification navigation: %s',async(next)=>{
 const {ports,change}=fixture();ports.navigate.mockImplementation(async()=>{change(next);});await openChatFromNotification(ports);expect(ports.open).not.toHaveBeenCalled();
});
it('does nothing while logged out or when there is no current room',async()=>{const {ports,change}=fixture();change(null);await openChatFromNotification(ports);expect(ports.navigate).not.toHaveBeenCalled();expect(ports.open).not.toHaveBeenCalled();});
