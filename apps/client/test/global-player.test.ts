import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { h, nextTick, reactive } from 'vue';
import { renderer, node, all } from './helpers/vue-host';
import { lockModalBackground } from '../src/useDialogFocus';
import GlobalPlayer from '../src/components/GlobalPlayer.vue';
import { ui, resetUi } from '../src/ui';
const fixture=vi.hoisted(()=>({app:null as any,volume:vi.fn()}));
vi.mock('../src/store',()=>({useApp:()=>fixture.app}));
vi.mock('../src/bridge',()=>({__v_isRef:false,playingTrackCover:()=>'',setVolume:fixture.volume}));
const settle=async()=>{for(let i=0;i<6;i++){await Promise.resolve();await nextTick();}};
let mounted:ReturnType<typeof renderer.createApp>;
async function mount(){const root=node('root');mounted=renderer.createApp(GlobalPlayer);mounted.component('router-link',{setup(_,context){return()=>h('a',{},context.slots.default?.());}});mounted.mount(root);await settle();return root;}
const label=(root:any,name:string)=>all(root).find(n=>n.props['aria-label']===name);
beforeEach(()=>{vi.stubGlobal('Document',class{});vi.stubGlobal('ShadowRoot',class{});resetUi();fixture.volume.mockReset().mockResolvedValue(undefined);fixture.app=reactive({room:{id:'room',playbackMode:'queue',playlist:[{id:'one',name:'歌曲',artists:'歌手',durationMs:100000}],playback:{sourceId:'one',sourceEpoch:1,playState:'paused'},pending:null},connected:true,permission:{skip:true,seek:true,enqueue:true,playbackMode:true},progress:5000,media:{status:'paused'},act:vi.fn().mockResolvedValue(undefined),error:vi.fn()});});
afterEach(()=>{mounted?.unmount();vi.unstubAllGlobals();});
it('uses the existing room command channel for pause/resume and track changes',async()=>{const root=await mount();label(root,'继续').props.onClick();expect(fixture.app.act).toHaveBeenCalledWith({type:'resume',payload:{}});fixture.app.room.playback.playState='playing';await settle();label(root,'暂停').props.onClick();expect(fixture.app.act).toHaveBeenLastCalledWith({type:'pause',payload:{}});label(root,'下一首').props.onClick();expect(fixture.app.act).toHaveBeenLastCalledWith({type:'next',payload:{}});});
it('keeps seek independent of ticking progress and commits only a valid permitted position',async()=>{const root=await mount(),range=label(root,'歌曲进度');range.props.onInput({target:{value:'30000'}});fixture.app.progress=9000;await settle();expect(range.props.value).toBe(30000);await range.props.onChange({target:{value:'30000'}});expect(fixture.app.act).toHaveBeenCalledWith({type:'seek',payload:{positionMs:30000}});fixture.app.permission.seek=false;await settle();expect(range.props.disabled).toBe(true);await range.props.onChange({target:{value:'90000'}});expect(fixture.app.act).toHaveBeenCalledOnce();});
it('disables playback during disconnect or pending transition and opens the shared queue',async()=>{const root=await mount();fixture.app.connected=false;await settle();expect(label(root,'继续').props.disabled).toBe(true);fixture.app.connected=true;fixture.app.room.pending={playback:{positionMs:0}};await settle();expect(label(root,'下一首').props.disabled).toBe(true);label(root,'打开共享播放列表').props.onClick();expect(ui.queue).toBe(true);});
it('updates only local HTML Audio volume, without sending room commands',async()=>{const root=await mount(),volume=label(root,'本地音量');volume.props['onUpdate:modelValue'](.3);await settle();await volume.props.onInput();expect(fixture.volume).toHaveBeenCalledWith(.3);expect(fixture.app.act).not.toHaveBeenCalled();});

it('toggles the shared queue closed on a second click and omits the normal syncing caption',async()=>{
 const root=await mount(),toggle=label(root,'打开共享播放列表');
 toggle.props.onClick();await settle();expect(ui.queue).toBe(true);expect(toggle.props['aria-expanded']).toBe(true);
 toggle.props.onClick();await settle();expect(ui.queue).toBe(false);expect(toggle.props['aria-expanded']).toBe(false);
 expect(all(root).some(n=>n.props.class==='sync-badge')).toBe(false);
});

it('keeps only the queue toggle interactive while its drawer holds the shared background lock',async()=>{
 const shell={inert:false},style={getPropertyValue:()=>'',getPropertyPriority:()=>'',setProperty:vi.fn(),removeProperty:vi.fn()};
 vi.stubGlobal('document',{body:{style:{overflow:'',paddingRight:''}},documentElement:{clientWidth:1000,style},querySelector:()=>shell});vi.stubGlobal('getComputedStyle',()=>({paddingRight:'0px'}));
 const root=await mount();ui.queue=true;const unlock=lockModalBackground();await settle();
 expect(label(root,'打开共享播放列表').props.inert).toBe(false);expect(label(root,'本地音量').props.inert).toBe(true);
 expect(all(root).find(n=>n.props.class==='global-transport').props.inert).toBe(true);
 const second=lockModalBackground();await settle();expect(label(root,'打开共享播放列表').props.inert).toBe(true);
 second();unlock();await settle();expect(label(root,'本地音量').props.inert).toBe(false);expect(shell.inert).toBe(false);
});

it('cycles all four server-controlled modes without optimistic local changes',async()=>{
 const root=await mount();
 for(const [mode,label,next] of [['queue','点歌模式','shuffle'],['shuffle','随机模式','single'],['single','单曲循环','loop'],['loop','列表循环','queue']]){
  fixture.app.room.playbackMode=mode;await settle();labelButton(root,`播放模式：${label}`).props.onClick();await settle();
  expect(fixture.app.act).toHaveBeenLastCalledWith({type:'playbackMode',payload:{mode:next}});expect(fixture.app.room.playbackMode).toBe(mode);
 }
});
const labelButton=(root:any,name:string)=>all(root).find(n=>n.props['aria-label']===name);
it('disables mode control without permission, on pending actions, disconnect and old servers',async()=>{
 const root=await mount();
 for(const patch of [()=>fixture.app.permission.playbackMode=false,()=>{fixture.app.permission.playbackMode=true;fixture.app.connected=false;},()=>{fixture.app.connected=true;fixture.app.room.pending={playback:{positionMs:0}};},()=>{fixture.app.room.pending=null;fixture.app.pendingActions=1;},()=>{fixture.app.pendingActions=0;delete fixture.app.room.playbackMode;}]){
  patch();await settle();const button=all(root).find(n=>String(n.props['aria-label']).startsWith('播放模式：'));
  expect(button.props.disabled).toBe(true);button.props.onClick();await settle();expect(fixture.app.act).not.toHaveBeenCalled();
 }
});

it('mode controls remain allowed when playback is denied but mode modification is granted',async()=>{
 const root=await mount();fixture.app.permission.skip=false;fixture.app.permission.enqueue=false;fixture.app.permission.playbackMode=true;await settle();
 const control=all(root).find(n=>n.props['aria-label']==='房间播放模式'||String(n.props['aria-label']).startsWith('播放模式：'));
 expect(control.props.disabled).toBe(false);
});
