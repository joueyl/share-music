import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';
import { all, node, renderer, text } from './helpers/vue-host';
import ResponsiveRoomChat from '../src/components/ResponsiveRoomChat.vue';
import { ui, resetUi } from '../src/ui';
const f=vi.hoisted(()=>({app:null as any,handler:null as any,resize:null as any,small:true,depth:null as any,stop:vi.fn(),remove:vi.fn()}));
vi.mock('../src/useDialogFocus',async()=>{const {ref}=await import('vue');f.depth=ref(0);return {modalDepth:f.depth};});
vi.mock('../src/store',()=>({useApp:()=>f.app}));
vi.mock('../src/bridge',()=>({sendChat:vi.fn(),subscribe:vi.fn(async(_:string,handler:any)=>{f.handler=handler;return f.stop;})}));
vi.mock('vue',async original=>{const vue=await original<typeof import('vue')>();return {...vue,Teleport:{setup(_:unknown,{slots}:{slots:any}){return()=>vue.h('div',slots.default?.());}},vShow:{beforeMount(){},updated(){}}};});
const settle=async()=>{for(let i=0;i<4;i++){await nextTick();await Promise.resolve();}};
let mounted:ReturnType<typeof renderer.createApp>;
beforeEach(()=>{
 resetUi();f.depth.value=0;f.small=true;f.stop.mockReset();f.remove.mockReset();
 vi.stubGlobal('Document',class{});vi.stubGlobal('ShadowRoot',class{});vi.stubGlobal('document',{activeElement:null,querySelector:()=>null});
 vi.stubGlobal('window',{addEventListener:vi.fn(),removeEventListener:vi.fn(),matchMedia:()=>({get matches(){return f.small;},addEventListener:(_:string,fn:any)=>f.resize=fn,removeEventListener:f.remove})});
 f.app=reactive({user:{id:'me'},room:{id:'room',members:[],settings:{}},connected:true,chatMessages:[],error:vi.fn()});
});
afterEach(()=>{mounted?.unmount();vi.unstubAllGlobals();});
async function mount(){const root=node('root');mounted=renderer.createApp(ResponsiveRoomChat);mounted.mount(root);await settle();return root;}
const trigger=(root:any)=>all(root).find(n=>Array.isArray(n.props.class)?n.props.class.includes('floating-chat-trigger'):n.props.class==='floating-chat-trigger');
const close=(root:any)=>all(root).find(n=>n.props['aria-label']==='收起聊天');
const chat=(id:string,userId='other',kind?:string)=>({type:'chat',data:{id,roomId:'room',userId,kind}});
it('starts collapsed on small windows and counts only new incoming chat, not history, own messages, activity or duplicate events',async()=>{
 const root=await mount();expect(trigger(root).props['aria-expanded']).toBe(false);
 f.handler({type:'chat-history',roomId:'room',messages:[{id:'history'}]});
 for(const m of [chat('history'),chat('own','me'),chat('activity','other','activity'),{...chat('foreign'),data:{...chat('foreign').data,roomId:'elsewhere'}},chat('new'),chat('new'),chat('next')])f.handler(m);
 await settle();expect(trigger(root).props['aria-label']).toBe('打开聊天，2 条新消息');expect(text(root)).toContain('2 条新消息');
});
it('keeps one chat instance and its draft across collapse, clears the badge on opening and returns focus on close',async()=>{
 const root=await mount();const input=all(root).find(n=>n.type==='textarea');input.props['onUpdate:modelValue']('未发送草稿');
 f.handler(chat('one'));await settle();await trigger(root).props.onClick();await settle();
 expect(trigger(root).props['aria-label']).toBe('打开聊天');expect(trigger(root).props['aria-expanded']).toBe(true);
 trigger(root).focus=vi.fn();await close(root).props.onClick();await settle();expect(trigger(root).focus).toHaveBeenCalled();
 expect(all(root).filter(n=>n.type==='textarea')).toHaveLength(1);expect(input.value).toBe('未发送草稿');
 f.handler(chat('two'));await settle();expect(trigger(root).props['aria-label']).toContain('1 条新消息');
});
it('uses inline chat on large screens, collapses on small screens and clears unread when switching rooms',async()=>{
 f.small=false;const root=await mount();expect(trigger(root)).toBeUndefined();
 f.small=true;f.resize();await settle();f.handler(chat('new'));await settle();expect(trigger(root).props['aria-label']).toContain('1 条');
 f.app.room={...f.app.room,id:'new-room'};await settle();expect(trigger(root).props['aria-label']).toBe('打开聊天');
 f.small=false;f.resize();await settle();expect(trigger(root)).toBeUndefined();
 mounted.unmount();expect(f.stop).toHaveBeenCalledOnce();expect(f.remove).toHaveBeenCalledOnce();
});
it('supports Escape collapse without treating IME composition as a close',async()=>{
 const root=await mount();await trigger(root).props.onClick();await settle();trigger(root).focus=vi.fn();
 const panel=all(root).find(n=>n.props.id===trigger(root).props['aria-controls']);
 const event={key:'Escape',isComposing:true,preventDefault:vi.fn(),stopPropagation:vi.fn()};panel.props.onKeydown(event);await settle();expect(trigger(root).props['aria-expanded']).toBe(true);
 event.isComposing=false;panel.props.onKeydown(event);await settle();expect(trigger(root).props['aria-expanded']).toBe(false);expect(event.stopPropagation).toHaveBeenCalled();
});

function draggable(root:any){
 const button=trigger(root);button.focus=vi.fn();button.closest=()=>({getBoundingClientRect:()=>({left:0,top:0,width:800,height:600})});
 button.getBoundingClientRect=()=>({left:position().left,top:position().top,width:100,height:48});
 function position(){return {left:parseFloat(button.props.style?.left??'684'),top:parseFloat(button.props.style?.top??'68')};}
 button.setPointerCapture=vi.fn();button.hasPointerCapture=()=>true;button.releasePointerCapture=vi.fn();
 return button;
}
const pointer=(x:number,y:number,extra={})=>({button:0,isPrimary:true,pointerId:1,clientX:x,clientY:y,preventDefault:vi.fn(),...extra});
it('moves the bubble with mouse or touch, clamps it inside the window and suppresses the post-drag click',async()=>{
 const root=await mount(),button=draggable(root);
 button.props.onPointerdown(pointer(700,80));button.props.onPointermove(pointer(300,280));await settle();
 expect(button.props.style).toMatchObject({left:'284px',top:'268px',right:'auto'});
 button.props.onPointerup(pointer(300,280));await button.props.onClick({detail:1,preventDefault:vi.fn()});await settle();
 expect(button.props['aria-expanded']).toBe(false);expect(button.releasePointerCapture).toHaveBeenCalledWith(1);
 button.props.onPointerdown(pointer(300,280,{pointerType:'touch'}));button.props.onPointermove(pointer(-999,999));await settle();
 expect(button.props.style).toMatchObject({left:'12px',top:'540px'});
 button.props.onPointercancel(pointer(-999,999));
 await button.props.onClick({detail:0});await settle();expect(button.props['aria-expanded']).toBe(true);
});
it('keeps a normal tap clickable, ignores other pointers and cancels a drag when the page or room changes',async()=>{
 const root=await mount(),button=draggable(root);
 button.props.onPointerdown(pointer(700,80,{button:2}));button.props.onPointermove(pointer(300,280));await settle();expect(button.props.style).toBeUndefined();
 button.props.onPointerdown(pointer(700,80));button.props.onPointermove(pointer(701,81));button.props.onPointerup(pointer(701,81));
 await button.props.onClick({detail:1});await settle();expect(button.props['aria-expanded']).toBe(true);
 await close(root).props.onClick();await settle();
 button.props.onPointerdown(pointer(700,80));button.props.onPointermove(pointer(300,280,{pointerId:2}));await settle();expect(button.props.style).toBeUndefined();
 f.app.room={...f.app.room,id:'next-room'};await settle();button.props.onPointermove(pointer(300,280));await settle();expect(button.props.style).toBeUndefined();
});

it('reclamps a moved bubble after resize and stops processing a lost pointer capture',async()=>{
 const root=await mount(),button=draggable(root);
 button.props.onPointerdown(pointer(700,80));button.props.onPointermove(pointer(400,400));await settle();
 button.props.onLostpointercapture(pointer(400,400));button.props.onPointermove(pointer(0,0));await settle();
 expect(button.props.style).toMatchObject({left:'384px',top:'388px'});
 button.closest=()=>({getBoundingClientRect:()=>({left:0,top:0,width:390,height:300})});
 (window.addEventListener as any).mock.calls.find(([event]:any[])=>event==='resize')[1]();await settle();
 expect(button.props.style).toMatchObject({left:'278px',top:'240px'});
 mounted.unmount();expect(window.removeEventListener).toHaveBeenCalledWith('resize',expect.any(Function));
});

it('cancels captured dragging when a modal opens and refuses new gestures until it closes',async()=>{
 const root=await mount(),button=draggable(root);
 button.props.onPointerdown(pointer(700,80));f.depth.value=1;
 button.props.onPointermove(pointer(300,280));await settle();expect(button.props.style).toBeUndefined();
 expect(button.releasePointerCapture).toHaveBeenCalledWith(1);
 button.props.onPointerdown(pointer(700,80));button.props.onPointermove(pointer(300,280));await settle();expect(button.props.style).toBeUndefined();
 f.depth.value=0;button.props.onPointerdown(pointer(700,80));button.props.onPointermove(pointer(300,280));await settle();expect(button.props.style?.left).toBe('284px');
});

it('opens the existing floating chat for a matching native notification click only',async()=>{
 const root=await mount();ui.chatRoomId='other';ui.chatRequest++;await settle();expect(trigger(root).props['aria-expanded']).toBe(false);
 ui.chatRoomId='room';ui.chatRequest++;await settle();expect(trigger(root).props['aria-expanded']).toBe(true);expect(all(root).filter(n=>n.type==='textarea')).toHaveLength(1);
});
