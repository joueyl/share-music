import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';
import { all, node, renderer, text } from './helpers/vue-host';
import ResponsiveRoomChat from '../src/components/ResponsiveRoomChat.vue';
const f=vi.hoisted(()=>({app:null as any,handler:null as any,resize:null as any,small:true,stop:vi.fn(),remove:vi.fn()}));
vi.mock('../src/store',()=>({useApp:()=>f.app}));
vi.mock('../src/bridge',()=>({sendChat:vi.fn(),subscribe:vi.fn(async(_:string,handler:any)=>{f.handler=handler;return f.stop;})}));
vi.mock('vue',async original=>{const vue=await original<typeof import('vue')>();return {...vue,Teleport:{setup(_:unknown,{slots}:{slots:any}){return()=>vue.h('div',slots.default?.());}},vShow:{beforeMount(){},updated(){}}};});
const settle=async()=>{for(let i=0;i<4;i++){await nextTick();await Promise.resolve();}};
let mounted:ReturnType<typeof renderer.createApp>;
beforeEach(()=>{
 f.small=true;f.stop.mockReset();f.remove.mockReset();
 vi.stubGlobal('Document',class{});vi.stubGlobal('ShadowRoot',class{});vi.stubGlobal('document',{activeElement:null});
 vi.stubGlobal('window',{matchMedia:()=>({get matches(){return f.small;},addEventListener:(_:string,fn:any)=>f.resize=fn,removeEventListener:f.remove})});
 f.app=reactive({user:{id:'me'},room:{id:'room',members:[],settings:{}},connected:true,chatMessages:[],error:vi.fn()});
});
afterEach(()=>{mounted?.unmount();vi.unstubAllGlobals();});
async function mount(){const root=node('root');mounted=renderer.createApp(ResponsiveRoomChat);mounted.mount(root);await settle();return root;}
const trigger=(root:any)=>all(root).find(n=>n.props.class==='floating-chat-trigger');
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
