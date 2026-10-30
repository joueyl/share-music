import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { h, nextTick, reactive } from 'vue';
import { renderer, node, all } from './helpers/vue-host';
import GlobalPlayer from '../src/components/GlobalPlayer.vue';
import { ui, resetUi } from '../src/ui';
const fixture=vi.hoisted(()=>({app:null as any,volume:vi.fn()}));
vi.mock('../src/store',()=>({useApp:()=>fixture.app}));
vi.mock('../src/bridge',()=>({__v_isRef:false,playingTrackCover:()=>'',setVolume:fixture.volume}));
const settle=async()=>{for(let i=0;i<6;i++){await Promise.resolve();await nextTick();}};
let mounted:ReturnType<typeof renderer.createApp>;
async function mount(){const root=node('root');mounted=renderer.createApp(GlobalPlayer);mounted.component('router-link',{setup(_,context){return()=>h('a',{},context.slots.default?.());}});mounted.mount(root);await settle();return root;}
const label=(root:any,name:string)=>all(root).find(n=>n.props['aria-label']===name);
beforeEach(()=>{vi.stubGlobal('Document',class{});vi.stubGlobal('ShadowRoot',class{});resetUi();fixture.volume.mockReset().mockResolvedValue(undefined);fixture.app=reactive({room:{id:'room',playlist:[{id:'one',name:'歌曲',artists:'歌手',durationMs:100000}],playback:{sourceId:'one',sourceEpoch:1,playState:'paused'},pending:null},connected:true,permission:{skip:true,seek:true,enqueue:true},progress:5000,media:{status:'paused'},act:vi.fn().mockResolvedValue(undefined),error:vi.fn()});});
afterEach(()=>{mounted?.unmount();vi.unstubAllGlobals();});
it('uses the existing room command channel for pause/resume and track changes',async()=>{const root=await mount();label(root,'继续').props.onClick();expect(fixture.app.act).toHaveBeenCalledWith({type:'resume',payload:{}});fixture.app.room.playback.playState='playing';await settle();label(root,'暂停').props.onClick();expect(fixture.app.act).toHaveBeenLastCalledWith({type:'pause',payload:{}});label(root,'下一首').props.onClick();expect(fixture.app.act).toHaveBeenLastCalledWith({type:'next',payload:{}});});
it('keeps seek independent of ticking progress and commits only a valid permitted position',async()=>{const root=await mount(),range=label(root,'歌曲进度');range.props.onInput({target:{value:'30000'}});fixture.app.progress=9000;await settle();expect(range.props.value).toBe(30000);await range.props.onChange({target:{value:'30000'}});expect(fixture.app.act).toHaveBeenCalledWith({type:'seek',payload:{positionMs:30000}});fixture.app.permission.seek=false;await settle();expect(range.props.disabled).toBe(true);await range.props.onChange({target:{value:'90000'}});expect(fixture.app.act).toHaveBeenCalledOnce();});
it('disables playback during disconnect or pending transition and opens the shared queue',async()=>{const root=await mount();fixture.app.connected=false;await settle();expect(label(root,'继续').props.disabled).toBe(true);fixture.app.connected=true;fixture.app.room.pending={playback:{positionMs:0}};await settle();expect(label(root,'下一首').props.disabled).toBe(true);label(root,'打开共享播放列表').props.onClick();expect(ui.queue).toBe(true);});
it('updates only local HTML Audio volume, without sending room commands',async()=>{const root=await mount(),volume=label(root,'本地音量');volume.props['onUpdate:modelValue'](.3);await settle();await volume.props.onInput();expect(fixture.volume).toHaveBeenCalledWith(.3);expect(fixture.app.act).not.toHaveBeenCalled();});
