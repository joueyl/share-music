import { createPinia } from 'pinia';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { h, nextTick, reactive } from 'vue';
import { all, node, renderer, text } from './helpers/vue-host';
import QueueDrawer from '../src/components/QueueDrawer.vue';
import Sortable from 'sortablejs';
import { readFileSync } from 'node:fs';
import { parse } from '@vue/compiler-sfc';
const f=vi.hoisted(()=>({app:null as any,target:null as any,sortables:[] as any[]}));
vi.mock('sortablejs',()=>({default:class {
 options:any;ids=['a','b','c','d'];sort=vi.fn((ids:string[])=>{this.ids=[...ids];});destroy=vi.fn();
 constructor(_el:any,options:any){this.options=options;f.sortables.push(this);}
 toArray(){return [...this.ids];}
}}));
const sortable=()=>f.sortables.at(-1);
function choose(id='a'){const instance=sortable();instance.item={dataset:{trackId:id},querySelector:()=>null,classList:{remove:vi.fn()},style:{willChange:'transform',transform:'translateY(20px)'}};instance.options.onChoose({item:instance.item});return instance;}
function start(id='a'){const instance=choose(id);instance.options.onStart({item:{dataset:{trackId:id}}});return instance;}
function drop(instance=sortable(),ids=['b','c','a','d']){instance.ids=ids;instance.options.onEnd();}
vi.mock('../src/store',()=>({useApp:()=>f.app}));
vi.mock('../src/bridge',()=>({favoriteSongs:vi.fn(async()=>[]),setFavoriteSong:vi.fn(async()=>[]),favoriteTrackReference:(t:any)=>t?.neteaseId?{source:'netease',id:t.neteaseId}:t?.qqId?{source:'qq',id:t.qqId}:null,__v_isRef:false,playingTrackCover:()=>''}));
vi.mock('../src/useDialogFocus',()=>({useDialogFocus:()=>{}}));
vi.mock('vue',async original=>{const vue=await original<typeof import('vue')>();const Pass={setup(_:unknown,{slots}:{slots:any}){return()=>vue.h('div',slots.default?.());}};return {...vue,Teleport:Pass,Transition:Pass};});
let mounted:ReturnType<typeof renderer.createApp>;
const settle=async()=>{await nextTick();await nextTick();};
beforeEach(()=>{
 f.sortables=[];Object.assign(Sortable,{dragged:null,ghost:null,clone:null});
 vi.stubGlobal('document',{elementFromPoint:()=>f.target,addEventListener:vi.fn(),removeEventListener:vi.fn()});vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('cancelAnimationFrame',vi.fn());
 f.app=reactive({host:true,connected:true,pendingActions:0,user:{id:'host'},permission:{skip:true,enqueue:true,playbackMode:true},room:{id:'room',playbackMode:'queue',stateVersion:1,pending:null,members:[],playback:{sourceId:'b'},playlist:['a','b','c','d'].map(id=>({id,name:id,available:true,providerId:'host',durationMs:100000}))},act:vi.fn().mockResolvedValue(undefined)});
});
afterEach(()=>{mounted?.unmount();vi.unstubAllGlobals();});
async function mount(props?:{swipeDismiss:boolean}){const root=node('root');mounted=renderer.createApp(QueueDrawer,props);mounted.use(createPinia());mounted.mount(root);await settle();
 const dialog=all(root).find(n=>n.props.role==='dialog'),list=all(root).find(n=>n.props['aria-label']==='播放队列');
 Object.assign(dialog,{offsetHeight:654,setPointerCapture:vi.fn(),hasPointerCapture:()=>true,releasePointerCapture:vi.fn()});Object.assign(list,{contains:()=>true,getBoundingClientRect:()=>({top:0,bottom:400}),scrollTop:0});
 return {root,dialog,list};}
function sheetPointer(dialog:any,clientY:number,timeStamp:number,area:'handle'|'list'|'button'='handle',clientX=60){
 return {pointerId:7,pointerType:'touch',isPrimary:true,button:0,clientY,clientX,timeStamp,currentTarget:dialog,
  target:{closest:(query:string)=>query==='.queue-sheet-grip,.drawer-heading'?area!=='list'&&{}:area==='button'&&{}},
  preventDefault:vi.fn()};
}
it('follows an APK handle drag and dismisses it without a playback or reorder command',async()=>{
 const {root,dialog}=await mount({swipeDismiss:true});
 const start=sheetPointer(dialog,160,0);
 dialog.props.onPointerdown(start);expect(start.preventDefault).toHaveBeenCalledOnce();
 dialog.props.onPointermove(sheetPointer(dialog,296,240));await settle();
 expect(dialog.props.style).toMatchObject({'--queue-sheet-offset':'136px'});
 dialog.props.onPointerup(sheetPointer(dialog,296,280));await settle();
 expect(dialog.releasePointerCapture).toHaveBeenCalledWith(7);
 expect(all(root).find(n=>n.props.role==='dialog')).toBeUndefined();
 expect(f.app.act).not.toHaveBeenCalled();
});
it('returns after an insufficient or cancelled touch and leaves the list and close button untouched',async()=>{
 const {root,dialog}=await mount({swipeDismiss:true});
 for(const area of ['list','button'] as const){
  const e=sheetPointer(dialog,160,0,area);dialog.props.onPointerdown(e);
  expect(e.preventDefault).not.toHaveBeenCalled();
 }
 expect(dialog.setPointerCapture).not.toHaveBeenCalled();
 dialog.props.onPointerdown(sheetPointer(dialog,160,0));
 dialog.props.onPointermove(sheetPointer(dialog,191,240));await settle();
 expect(dialog.props.style).toMatchObject({'--queue-sheet-offset':'31px'});
 dialog.props.onPointerup(sheetPointer(dialog,191,300));await settle();
 expect(dialog.props.style).toBeUndefined();
 dialog.props.onPointerdown(sheetPointer(dialog,160,350));
 dialog.props.onPointermove(sheetPointer(dialog,340,600));await settle();
 dialog.props.onLostpointercapture(sheetPointer(dialog,340,640));await settle();
 expect(dialog.props.style).toBeUndefined();
 expect(all(root).find(n=>n.props.role==='dialog')).toBe(dialog);
 expect(f.app.act).not.toHaveBeenCalled();
});
it('recognizes a quick downward flick only when swipe dismissal is enabled',async()=>{
 const {dialog}=await mount();const e=sheetPointer(dialog,160,0);
 dialog.props.onPointerdown(e);expect(e.preventDefault).not.toHaveBeenCalled();mounted.unmount();
 const swipe=await mount({swipeDismiss:true});
 swipe.dialog.props.onPointerdown(sheetPointer(swipe.dialog,160,0));
 swipe.dialog.props.onPointerup(sheetPointer(swipe.dialog,208,60));await settle();
 expect(all(swipe.root).find(n=>n.props.role==='dialog')).toBeUndefined();
});
const grip=(root:any,id:string)=>all(root).find(n=>n.props['aria-label']===`拖动调整 ${id} 的顺序`);
it('keeps a stable, themed queue scrollbar without disabling scrolling or drag sorting',()=>{
 const {descriptor}=parse(readFileSync(new URL('../src/components/QueueDrawer.vue',import.meta.url),'utf8'));
 const css=descriptor.styles.find(s=>s.scoped)!.content;
 expect(css).toContain('scrollbar-gutter:stable');expect(css).toContain('.queue-scroll::-webkit-scrollbar{width:8px;height:8px}');
 expect(css).toContain('border-radius:999px');expect(css).toContain('min-height:32px');
 expect(css).toContain('::-webkit-scrollbar-thumb:hover');expect(css).toContain('::-webkit-scrollbar-thumb:active');
 expect(css).toContain('forced-colors:active');expect(css).not.toMatch(/scrollbar-width\s*:\s*none|overflow(?:-y)?\s*:\s*hidden/);
});
it('uses SortableJS fallback handles and internal edge auto-scroll without motion',async()=>{
 const {root,list}=await mount();
 expect(sortable().options).toMatchObject({forceFallback:true,fallbackTolerance:6,handle:'.queue-drag-handle',draggable:'.queue-row',dataIdAttr:'data-track-id',forceAutoScrollFallback:true,bubbleScroll:false,scrollSensitivity:40,scrollSpeed:14,animation:0});
 expect(all(root).filter(n=>n.props['data-track-id'])).toHaveLength(4);expect(text(root)).toContain('正在播放');
 const instance=start();expect(f.app.act).not.toHaveBeenCalled();drop(instance);
 expect(instance.sort).toHaveBeenCalledWith(['a','b','c','d']);
 expect(f.app.act).toHaveBeenCalledWith({type:'reorder',payload:{trackIds:['b','c','a','d']}});
 expect(f.app.room.playlist.map((t:any)=>t.id)).toEqual(['a','b','c','d']);
});
it('keeps the APK drag alive across progress snapshots and submits a single reordered list',async()=>{
 const {root}=await mount({swipeDismiss:true});
 expect(text(root)).not.toMatch(/播放顺序|拖动手柄排序/);
 expect(all(root).some(n=>n.props['aria-label']==='房间播放模式')).toBe(false);
 expect(text(root)).not.toContain('正在播放');
 const rows=all(root).filter(n=>n.props['data-track-id']);
 expect(rows.filter(n=>n.props['aria-current']==='true').map(n=>n.props['data-track-id'])).toEqual(['b']);
 expect(rows.find(n=>n.props['data-track-id']==='b')!.props.class).toContain('is-playing');
 expect(grip(root,'a').props['aria-describedby']).toBeUndefined();
 const instance=start();
 for(const positionMs of [1000,2000]){
  f.app.room={...f.app.room,playback:{...f.app.room.playback,positionMs},playlist:f.app.room.playlist.map((track:any)=>({...track}))};
  await settle();
  expect(instance.destroy).not.toHaveBeenCalled();
  expect(instance.options.onMove()).toBe(true);
 }
 drop(instance);
 expect(f.app.act).toHaveBeenCalledExactlyOnceWith({type:'reorder',payload:{trackIds:['b','c','a','d']}});
});
it('still cancels the APK drag when the room revision changes',async()=>{
 await mount({swipeDismiss:true});
 const instance=start();
 f.app.room={...f.app.room,stateVersion:2};
 await settle();
 expect(instance.destroy).toHaveBeenCalledOnce();
 drop(instance);
 expect(f.app.act).not.toHaveBeenCalled();
});
it('cancels stale versions, pointer cancellation and ordinary clicks without committing',async()=>{
 await mount();let instance=choose();instance.options.onUnchoose();drop(instance);expect(f.app.act).not.toHaveBeenCalled();
 instance=start();f.app.room.stateVersion++;await settle();drop(instance);expect(instance.destroy).toHaveBeenCalled();expect(f.app.act).not.toHaveBeenCalled();
 instance=start();const cancel=(document.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(c=>c[0]==='pointercancel')![1];cancel();drop(instance);
 expect(instance.destroy).toHaveBeenCalled();expect(instance.sort).toHaveBeenCalledWith(['a','b','c','d']);expect(f.app.act).not.toHaveBeenCalled();
});
it('disables ordering without playlist control, disconnected clients, pending transitions and unconfirmed actions',async()=>{
 const {root}=await mount();
 for(const change of [()=>{f.app.connected=false;},()=>{f.app.connected=true;f.app.room.pending={id:'pending'};},()=>{f.app.room.pending=null;f.app.pendingActions=1;}]){
  const instance=sortable();change();await settle();expect(grip(root,'a').props.disabled).toBe(true);expect(instance.destroy).toHaveBeenCalled();expect(f.app.act).not.toHaveBeenCalled();
 }
 f.app.pendingActions=0;f.app.host=false;await settle();expect(grip(root,'a')).toBeDefined();f.app.permission.enqueue=false;await settle();expect(grip(root,'a')).toBeUndefined();
});
it('removes fallback preview and classes explicitly when cancellation destroys the library',async()=>{
 await mount();const instance=start(),ghost={remove:vi.fn()},clone={remove:vi.fn()};Object.assign(Sortable,{dragged:instance.item,ghost,clone});
 const cancel=(document.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(c=>c[0]==='pointercancel')![1];cancel();
 expect(ghost.remove).toHaveBeenCalledOnce();expect(clone.remove).toHaveBeenCalledOnce();expect(instance.item.classList.remove).toHaveBeenCalledWith('is-dragging','sortable-chosen','sortable-drag');
 expect(instance.item.style).toMatchObject({willChange:'',transform:''});expect(instance.destroy).toHaveBeenCalledOnce();expect(f.app.act).not.toHaveBeenCalled();
});
it('rejects malformed or unchanged orders and preserves keyboard adjustment',async()=>{
 const {root}=await mount();drop(start(),['a','b','c','d']);drop(start(),['a','a','c','d']);drop(start(),['a','b','c']);drop(start(),['a','b','c','unknown']);expect(f.app.act).not.toHaveBeenCalled();
 for(const handler of grip(root,'a').props.onKeydown)handler({key:'ArrowDown',altKey:true,preventDefault:vi.fn()});await settle();
 expect(f.app.act).toHaveBeenCalledWith({type:'reorder',payload:{trackIds:['b','a','c','d']}});
});
it('restores the order after an unconfirmed command and allows the next drag',async()=>{
 await mount();f.app.act.mockImplementationOnce(async()=>{});const instance=start();drop(instance);await settle();
 expect(instance.sort).toHaveBeenCalledWith(['a','b','c','d']);expect(f.app.room.playlist.map((t:any)=>t.id)).toEqual(['a','b','c','d']);
 drop(start('d'),['d','a','b','c']);expect(f.app.act).toHaveBeenLastCalledWith({type:'reorder',payload:{trackIds:['d','a','b','c']}});
});
it('rejects a stale drop even before the version watcher runs, and cancels active drags on disconnect',async()=>{
 await mount();let instance=start();f.app.room.stateVersion++;drop(instance);expect(f.app.act).not.toHaveBeenCalled();await settle();
 instance=start();f.app.connected=false;await settle();drop(instance);expect(instance.destroy).toHaveBeenCalled();expect(f.app.act).not.toHaveBeenCalled();
});
it('destroys sorting and rejects late drops on tab changes, closing and unmounting',async()=>{
 const {root}=await mount();let instance=start();all(root).find(n=>n.type==='button'&&text(n)==='已播放').props.onClick();await settle();drop(instance);expect(instance.destroy).toHaveBeenCalled();
 all(root).find(n=>n.type==='button'&&text(n)==='当前队列').props.onClick();await settle();instance=start();
 all(root).find(n=>n.props['aria-label']==='关闭播放列表').props.onClick();await settle();drop(instance);expect(instance.destroy).toHaveBeenCalled();expect(f.app.act).not.toHaveBeenCalled();
 mounted.unmount();expect(document.removeEventListener).toHaveBeenCalledWith('pointercancel',expect.any(Function),true);
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
 choose();row(root,'a').props.onDblclick(doubleClick());await settle();expect(f.app.act).not.toHaveBeenCalled();
 sortable().options.onStart({item:{dataset:{trackId:"a"}}});drop();await settle();
 f.app.act.mockClear();row(root,'a').props.onDblclick(doubleClick());await settle();expect(f.app.act).not.toHaveBeenCalled();
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

it('closes on outside clicks including the player area and removes the capture listener',async()=>{
 const {root,dialog}=await mount();dialog.contains=()=>false;
 const listener=(document.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(c=>c[0]==='click'&&c[2]===true)![1];
 listener({target:{closest:()=>null},stopPropagation:vi.fn()});await settle();
 expect(all(root).some(n=>n.props.role==='dialog')).toBe(false);
 mounted.unmount();expect(document.removeEventListener).toHaveBeenCalledWith('click',listener,true);
});
it('keeps inside clicks and the player toggle owned by their existing handlers',async()=>{
 const {root,dialog}=await mount(),inside={};dialog.contains=(target:unknown)=>target===inside;
 const listener=(document.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(c=>c[0]==='click'&&c[2]===true)![1];
 listener({target:inside});listener({target:{closest:()=>({})}});await settle();
 expect(all(root).some(n=>n.props.role==='dialog')).toBe(true);
});
it('ignores outside clicks during sorting gestures and the post-drop protection period',async()=>{
 const {root,dialog}=await mount();dialog.contains=()=>false;
 const listener=(document.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(c=>c[0]==='click'&&c[2]===true)![1];
 const outside={target:{closest:()=>null}};
 choose();listener(outside);await settle();
 expect(all(root).some(n=>n.props.role==='dialog')).toBe(true);
 sortable().options.onStart({item:{dataset:{trackId:"a"}}});drop();listener(outside);await settle();
 expect(all(root).some(n=>n.props.role==='dialog')).toBe(true);
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

it('uses the shared window top-right corner without changing list scrolling or drawer transitions',()=>{
 const source=readFileSync(new URL('../src/components/QueueDrawer.vue',import.meta.url),'utf8');
 expect(source).toContain('<Teleport to="#app">');expect(source).not.toContain('<Teleport to="body">');
 const css=parse(source).descriptor.styles.find(s=>s.scoped)!.content;
 expect(css).toContain('.queue-drawer{border-top-right-radius:var(--window-corner-radius,20px)}');
 expect(css).toContain('.drawer-backdrop{clip-path:inset(0 round var(--window-corner-radius,20px) var(--window-corner-radius,20px) 0 0)}');
 expect(source).toContain('@after-leave="afterLeave"');expect(css).toContain('scrollbar-gutter:stable');
});
