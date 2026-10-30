import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';
import { all, node, renderer, text } from './helpers/vue-host';
import QueueDrawer from '../src/components/QueueDrawer.vue';
import { moveQueueTrack } from '../src/queue-order';
import { readFileSync } from 'node:fs';
import { parse } from '@vue/compiler-sfc';
const f=vi.hoisted(()=>({app:null as any,target:null as any}));
vi.mock('../src/store',()=>({useApp:()=>f.app}));
vi.mock('../src/bridge',()=>({__v_isRef:false,playingTrackCover:()=>''}));
vi.mock('../src/useDialogFocus',()=>({useDialogFocus:()=>{}}));
vi.mock('vue',async original=>{const vue=await original<typeof import('vue')>();const Pass={setup(_:unknown,{slots}:{slots:any}){return()=>vue.h('div',slots.default?.());}};return {...vue,Teleport:Pass,Transition:Pass};});
let mounted:ReturnType<typeof renderer.createApp>;
const settle=async()=>{await nextTick();await nextTick();};
beforeEach(()=>{
 vi.stubGlobal('document',{elementFromPoint:()=>f.target});vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('cancelAnimationFrame',vi.fn());
 f.app=reactive({host:true,connected:true,pendingActions:0,user:{id:'host'},permission:{skip:true,enqueue:true},room:{id:'room',stateVersion:1,pending:null,members:[],playback:{sourceId:'b'},playlist:['a','b','c','d'].map(id=>({id,name:id,available:true,providerId:'host',durationMs:100000}))},act:vi.fn().mockResolvedValue(undefined)});
});
afterEach(()=>{mounted?.unmount();vi.unstubAllGlobals();});
async function mount(){const root=node('root');mounted=renderer.createApp(QueueDrawer);mounted.mount(root);await settle();
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
it('disables ordering for non-hosts, disconnected clients, pending transitions and unconfirmed actions',async()=>{
 const {root}=await mount();
 for(const change of [()=>{f.app.connected=false;},()=>{f.app.connected=true;f.app.room.pending={id:'pending'};},()=>{f.app.room.pending=null;f.app.pendingActions=1;}]){
  change();await settle();expect(grip(root,'a').props.disabled).toBe(true);grip(root,'a').props.onPointerdown(pointer(20));expect(f.app.act).not.toHaveBeenCalled();
 }
 f.app.pendingActions=0;f.app.host=false;await settle();expect(grip(root,'a')).toBeUndefined();
});
it('auto-scrolls near an edge and stops the animation when the gesture is cancelled',async()=>{
 const {root,dialog,list}=await mount();grip(root,'a').props.onPointerdown(pointer(20));f.target=null;
 dialog.props.onPointermove(pointer(395));
 const frame=(requestAnimationFrame as ReturnType<typeof vi.fn>).mock.calls[0][0];frame();
 expect(list.scrollTop).toBeGreaterThan(0);
 dialog.props.onPointercancel();expect(cancelAnimationFrame).toHaveBeenCalled();expect(f.app.act).not.toHaveBeenCalled();
});
