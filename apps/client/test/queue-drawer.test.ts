import { createPinia } from 'pinia';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { h, nextTick, reactive } from 'vue';
import { all, node, renderer, text } from './helpers/vue-host';
import QueueDrawer from '../src/components/QueueDrawer.vue';
import { moveQueueTrack } from '../src/queue-order';
import { readFileSync } from 'node:fs';
import { parse } from '@vue/compiler-sfc';
const f=vi.hoisted(()=>({app:null as any,target:null as any}));
vi.mock('../src/store',()=>({useApp:()=>f.app}));
vi.mock('../src/bridge',()=>({favoriteSongs:vi.fn(async()=>[]),setFavoriteSong:vi.fn(async()=>[]),favoriteTrackReference:(t:any)=>t?.neteaseId?{source:'netease',id:t.neteaseId}:t?.qqId?{source:'qq',id:t.qqId}:null,__v_isRef:false,playingTrackCover:()=>''}));
vi.mock('../src/useDialogFocus',()=>({useDialogFocus:()=>{}}));
vi.mock('vue',async original=>{const vue=await original<typeof import('vue')>();const Pass={setup(_:unknown,{slots}:{slots:any}){return()=>vue.h('div',slots.default?.());}};return {...vue,Teleport:Pass,Transition:Pass};});
let mounted:ReturnType<typeof renderer.createApp>;
const settle=async()=>{await nextTick();await nextTick();};
beforeEach(()=>{
 vi.stubGlobal('document',{elementFromPoint:()=>f.target,addEventListener:vi.fn(),removeEventListener:vi.fn()});vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('cancelAnimationFrame',vi.fn());
 f.app=reactive({host:true,connected:true,pendingActions:0,user:{id:'host'},permission:{skip:true,enqueue:true,playbackMode:true},room:{id:'room',playbackMode:'queue',stateVersion:1,pending:null,members:[],playback:{sourceId:'b'},playlist:['a','b','c','d'].map(id=>({id,name:id,available:true,providerId:'host',durationMs:100000}))},act:vi.fn().mockResolvedValue(undefined)});
});
afterEach(()=>{mounted?.unmount();vi.unstubAllGlobals();});
async function mount(){const root=node('root');mounted=renderer.createApp(QueueDrawer);mounted.use(createPinia());mounted.mount(root);await settle();
 const dialog=all(root).find(n=>n.props.role==='dialog'),list=all(root).find(n=>n.props['aria-label']==='播放队列');
 Object.assign(dialog,{setPointerCapture:vi.fn(),hasPointerCapture:()=>false});Object.assign(list,{contains:()=>true,getBoundingClientRect:()=>({top:0,bottom:400}),scrollTop:0});
 return {root,dialog,list};}
const grip=(root:any,id:string)=>all(root).find(n=>n.props['aria-label']===`拖动调整 ${id} 的顺序`);
const pointer=(y:number)=>({pointerId:1,button:0,clientX:100,clientY:y,preventDefault:vi.fn(),currentTarget:{focus:vi.fn()}});
it('keeps a stable, themed queue scrollbar without disabling scrolling or drag sorting',()=>{
 const {descriptor}=parse(readFileSync(new URL('../src/components/QueueDrawer.vue',import.meta.url),'utf8'));
 const css=descriptor.styles.find(s=>s.scoped)!.content;
 expect(css).toContain('scrollbar-gutter:stable');expect(css).toContain('.queue-scroll::-webkit-scrollbar{width:8px;height:8px}');
 expect(css).toContain('border-radius:999px');expect(css).toContain('min-height:32px');
 expect(css).toContain('::-webkit-scrollbar-thumb:hover');expect(css).toContain('::-webkit-scrollbar-thumb:active');
 expect(css).toContain('forced-colors:active');expect(css).not.toMatch(/scrollbar-width\s*:\s*none|overflow(?:-y)?\s*:\s*hidden/);
});
it('moves queue IDs without losing the current track or any other item',()=>{
 expect(moveQueueTrack(['a','b','c','d'],'a','c',true)).toEqual(['b','c','a','d']);
 expect(moveQueueTrack(['a','b','c','d'],'d','a')).toEqual(['d','a','b','c']);
 expect(moveQueueTrack(['a','b'],'missing','b')).toEqual(['a','b']);
});
it('shows the complete compact queue, including the current track, and commits a drag only on release',async()=>{
 const {root,dialog}=await mount();expect(all(root).filter(n=>n.props['data-track-id'])).toHaveLength(4);expect(text(root)).toContain('正在播放');
 grip(root,'a').props.onPointerdown(pointer(20));
 f.target={closest:()=>({dataset:{trackId:'c'},getBoundingClientRect:()=>({top:100,height:40})})};
 dialog.props.onPointermove(pointer(140));await settle();expect(f.app.act).not.toHaveBeenCalled();
 await dialog.props.onPointerup(pointer(140));
 expect(f.app.act).toHaveBeenCalledWith({type:'reorder',payload:{trackIds:['b','c','a','d']}});
});
it('cancels on room-version changes, pointer cancellation or an ordinary click',async()=>{
 const {root,dialog}=await mount();grip(root,'a').props.onPointerdown(pointer(20));await dialog.props.onPointerup(pointer(20));expect(f.app.act).not.toHaveBeenCalled();
 grip(root,'a').props.onPointerdown(pointer(20));f.app.room.stateVersion++;await settle();await dialog.props.onPointerup(pointer(140));expect(f.app.act).not.toHaveBeenCalled();
 grip(root,'a').props.onPointerdown(pointer(20));dialog.props.onPointercancel();expect(f.app.act).not.toHaveBeenCalled();
});
it('disables ordering without playlist control, disconnected clients, pending transitions and unconfirmed actions',async()=>{
 const {root}=await mount();
 for(const change of [()=>{f.app.connected=false;},()=>{f.app.connected=true;f.app.room.pending={id:'pending'};},()=>{f.app.room.pending=null;f.app.pendingActions=1;}]){
  change();await settle();expect(grip(root,'a').props.disabled).toBe(true);grip(root,'a').props.onPointerdown(pointer(20));expect(f.app.act).not.toHaveBeenCalled();
 }
 f.app.pendingActions=0;f.app.host=false;await settle();expect(grip(root,'a')).toBeDefined();f.app.permission.enqueue=false;await settle();expect(grip(root,'a')).toBeUndefined();
});
it('auto-scrolls near an edge and stops the animation when the gesture is cancelled',async()=>{
 const {root,dialog,list}=await mount();grip(root,'a').props.onPointerdown(pointer(20));f.target=null;
 dialog.props.onPointermove(pointer(395));
 const frame=(requestAnimationFrame as ReturnType<typeof vi.fn>).mock.calls[0][0];frame();
 expect(list.scrollTop).toBeGreaterThan(0);
 dialog.props.onPointercancel();expect(cancelAnimationFrame).toHaveBeenCalled();expect(f.app.act).not.toHaveBeenCalled();
});
const row=(root:any,id:string)=>all(root).find(n=>n.props['data-track-id']===id);
const doubleClick=(interactive=false)=>({preventDefault:vi.fn(),target:{closest:()=>interactive?{}:null}});
it('plays a queue song on double-click through the existing room command, not single-click',async()=>{
 const {root}=await mount();expect(row(root,'a').props.onClick).toBeUndefined();
 row(root,'a').props.onDblclick(doubleClick());await settle();
 expect(f.app.act).toHaveBeenCalledExactlyOnceWith({type:'play',payload:{trackId:'a'}});
 expect(all(root).find(n=>n.props['aria-label']==='播放此曲')?.props.onClick).toBeTypeOf('function');
});
it('resumes a paused current song without restarting an already playing song',async()=>{
 const {root}=await mount();f.app.room.playback.playState='playing';
 row(root,'b').props.onDblclick(doubleClick());await settle();expect(f.app.act).not.toHaveBeenCalled();
 f.app.room.playback.playState='paused';await settle();
 row(root,'b').props.onDblclick(doubleClick());await settle();
 expect(f.app.act).toHaveBeenCalledExactlyOnceWith({type:'resume',payload:{}});
});
it('guards double-click playback against permission, connection, pending actions and unavailable songs',async()=>{
 const {root}=await mount();
 for(const patch of [()=>f.app.permission.skip=false,()=>{f.app.permission.skip=true;f.app.connected=false;},()=>{f.app.connected=true;f.app.room.pending={id:'pending'};},()=>{f.app.room.pending=null;f.app.pendingActions=1;},()=>{f.app.pendingActions=0;f.app.room.playlist[0].available=false;}]){
  patch();await settle();row(root,'a').props.onDblclick(doubleClick());await settle();expect(f.app.act).not.toHaveBeenCalled();
 }
});
it('does not play when double-clicking controls, dragging, or immediately after dropping a song',async()=>{
 const {root,dialog}=await mount();
 row(root,'a').props.onDblclick(doubleClick(true));await settle();expect(f.app.act).not.toHaveBeenCalled();
 grip(root,'a').props.onPointerdown(pointer(20));row(root,'a').props.onDblclick(doubleClick());await settle();expect(f.app.act).not.toHaveBeenCalled();
 dialog.props.onPointermove(pointer(140));await settle();await dialog.props.onPointerup(pointer(140));
 row(root,'a').props.onDblclick(doubleClick());await settle();expect(f.app.act).not.toHaveBeenCalled();
});
it('coalesces repeated activation while a playback command is being sent',async()=>{
 const {root}=await mount();let finish!:()=>void;
 f.app.act.mockImplementation(()=>new Promise<void>(resolve=>finish=resolve));
 row(root,'a').props.onDblclick(doubleClick());row(root,'a').props.onDblclick(doubleClick());await settle();
 expect(f.app.act).toHaveBeenCalledOnce();finish();await settle();
});

it('allows members with playlist control to remove other members songs and clear while a song is active',async()=>{
 f.app.host=false;f.app.user.id='member';const {root}=await mount();
 const clear=all(root).find(n=>n.props.class==='queue-clear');expect(clear.props.disabled).toBe(false);await clear.props.onClick();
 expect(f.app.act).toHaveBeenLastCalledWith({type:'clear',payload:{}});await settle();
 const remove=all(row(root,'a')).find(n=>n.props['aria-label']==='移除音轨');expect(remove.props.disabled).toBe(false);await remove.props.onClick();
 expect(f.app.act).toHaveBeenLastCalledWith({type:'remove',payload:{trackId:'a'}});
 expect(all(row(root,'b')).find(n=>n.props['aria-label']==='移除音轨').props.disabled).toBe(true);
});
it('disables clear during pending operations, disconnect and when only the current song remains',async()=>{
 const {root}=await mount();const clear=()=>all(root).find(n=>n.props.class==='queue-clear');
 for(const patch of [()=>f.app.connected=false,()=>{f.app.connected=true;f.app.room.pending={};},()=>{f.app.room.pending=null;f.app.pendingActions=1;},()=>{f.app.pendingActions=0;f.app.room.playlist=f.app.room.playlist.filter((t:any)=>t.id==='b');}]){
  patch();await settle();expect(clear().props.disabled).toBe(true);await clear().props.onClick();expect(f.app.act).not.toHaveBeenCalled();
 }
 f.app.permission.enqueue=false;await settle();expect(clear()).toBeUndefined();
});
it('closes song menus on outside clicks or another menu, and unregisters the listener',async()=>{
 const {dialog}=await mount(),inside={},outside={};
 const first={open:true,contains:(target:unknown)=>target===inside},second={open:true,contains:()=>false};
 dialog.querySelectorAll=()=>[first,second];
 const listener=(document.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(c=>c[0]==='click')![1];
 listener({target:inside});expect(first.open).toBe(true);expect(second.open).toBe(false);
 listener({target:outside});expect(first.open).toBe(false);
 mounted.unmount();expect(document.removeEventListener).toHaveBeenCalledWith('click',listener);
});

it('animates closed when the external queue toggle requests it and can reopen before leaving',async()=>{
 const state=reactive({open:true}),root=node('root');mounted=renderer.createApp({setup:()=>()=>h(QueueDrawer,{open:state.open})});mounted.mount(root);await settle();
 expect(all(root).some(n=>n.props.role==='dialog')).toBe(true);
 state.open=false;await settle();expect(all(root).some(n=>n.props.role==='dialog')).toBe(false);
 state.open=true;await settle();expect(all(root).some(n=>n.props.role==='dialog')).toBe(true);
});

it('offers four shared modes and sends only a server command, with connection and permission guards',async()=>{
 const {root}=await mount();const select=all(root).find(n=>n.props['aria-label']==='房间播放模式');
 expect(all(select).filter(n=>n.type==='option').map(n=>n.props.value)).toEqual(['queue','shuffle','single','loop']);
 await select.props.onChange({target:{value:'shuffle'}});expect(f.app.act).toHaveBeenLastCalledWith({type:'playbackMode',payload:{mode:'shuffle'}});
 expect(f.app.room.playbackMode).toBe('queue');f.app.act.mockClear();
 for(const change of [()=>f.app.permission.playbackMode=false,()=>{f.app.permission.playbackMode=true;f.app.connected=false;},()=>{f.app.connected=true;f.app.pendingActions=1;},()=>{f.app.pendingActions=0;f.app.room.pending={};}]){
  change();await settle();expect(select.props.disabled).toBe(true);await select.props.onChange({target:{value:'loop'}});expect(f.app.act).not.toHaveBeenCalled();
 }
});

it('mode controls remain allowed when playback is denied but mode modification is granted',async()=>{
 const {root}=await mount();f.app.permission.skip=false;f.app.permission.enqueue=false;f.app.permission.playbackMode=true;await settle();
 const control=all(root).find(n=>n.props['aria-label']==='房间播放模式'||String(n.props['aria-label']).startsWith('播放模式：'));
 expect(control.props.disabled).toBe(false);
});

it('shows the current users saved songs in a separate queue tab without replacing or playing the room queue',async()=>{
 const {root}=await mount();all(root).find(n=>n.type==='button'&&text(n)==='收藏单曲').props.onClick();await settle();await Promise.resolve();await settle();
 expect(text(root)).toContain('还没有收藏的单曲');expect(all(root).some(n=>n.props['data-track-id'])).toBe(false);expect(f.app.room.playlist).toHaveLength(4);expect(f.app.act).not.toHaveBeenCalled();
});
