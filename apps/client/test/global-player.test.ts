import { readFileSync } from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { h, nextTick, reactive } from 'vue';
import { renderer, node, all } from './helpers/vue-host';
import { lockModalBackground } from '../src/useDialogFocus';
import GlobalPlayer from '../src/components/GlobalPlayer.vue';
import { ui, resetUi } from '../src/ui';
const fixture=vi.hoisted(()=>({app:null as any,volume:vi.fn(),readFavorites:vi.fn(),setFavorite:vi.fn()}));
vi.mock('../src/store',()=>({useApp:()=>fixture.app}));
vi.mock('../src/bridge',()=>({favoriteSongs:fixture.readFavorites,setFavoriteSong:fixture.setFavorite,favoriteTrackReference:(t:any)=>t?.neteaseId?{source:'netease',id:t.neteaseId}:t?.qqId?{source:'qq',id:t.qqId}:null,__v_isRef:false,playingTrackCover:()=>'',setVolume:fixture.volume}));
const settle=async()=>{for(let i=0;i<6;i++){await Promise.resolve();await nextTick();}};
let mounted:ReturnType<typeof renderer.createApp>;
async function mount(){const root=node('root');mounted=renderer.createApp(GlobalPlayer);mounted.use(createPinia());mounted.component('router-link',{setup(_,context){return()=>h('a',{},context.slots.default?.());}});mounted.mount(root);await settle();return root;}
const label=(root:any,name:string)=>all(root).find(n=>n.props['aria-label']===name);
beforeEach(()=>{vi.stubGlobal('Document',class{});vi.stubGlobal('ShadowRoot',class{});resetUi();fixture.readFavorites.mockReset().mockResolvedValue([]);fixture.setFavorite.mockReset().mockResolvedValue([]);fixture.volume.mockReset().mockResolvedValue(undefined);fixture.app=reactive({room:{id:'room',playbackMode:'queue',playlist:[{id:'one',name:'歌曲',artists:'歌手',durationMs:100000}],playback:{sourceId:'one',sourceEpoch:1,playState:'paused'},pending:null},connected:true,permission:{skip:true,seek:true,enqueue:true,playbackMode:true},progress:5000,media:{status:'paused'},act:vi.fn().mockResolvedValue(undefined),error:vi.fn()});});
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

const clickFavorite=(button:any)=>button.props.onClick({stopPropagation:vi.fn(),preventDefault:vi.fn()});
it.each(['netease','qq'] as const)('favorites the playing %s track and confirms changes through the shared account store',async(source)=>{
 fixture.app.user={id:'user'};fixture.app.room.playlist[0][source==='qq'?'qqId':'neteaseId']=source==='qq'?'qqmid':'123';fixture.app.connected=false;fixture.app.permission.skip=false;fixture.app.permission.enqueue=false;
 const saved={source,id:source==='qq'?'qqmid':'123',name:'歌曲',artists:'歌手',album:'专辑',coverUrl:'',durationMs:100000,savedAt:1};fixture.setFavorite.mockResolvedValueOnce([saved]);
 const root=await mount(),button=label(root,'收藏 歌曲');expect(button.props.disabled).toBe(false);expect(fixture.readFavorites).toHaveBeenCalledOnce();await clickFavorite(button);await settle();
 expect(fixture.setFavorite).toHaveBeenCalledWith(source,saved.id,true);expect(label(root,'取消收藏 歌曲').props['aria-pressed']).toBe(true);expect(fixture.app.act).not.toHaveBeenCalled();
 await clickFavorite(label(root,'取消收藏 歌曲'));await settle();expect(fixture.setFavorite).toHaveBeenLastCalledWith(source,saved.id,false);expect(label(root,'收藏 歌曲').props['aria-pressed']).toBe(false);
});
it('does not show a fake favorite on failure and disables unknown-source tracks',async()=>{
 fixture.app.user={id:'user'};fixture.app.room.playlist[0].neteaseId='123';fixture.setFavorite.mockRejectedValueOnce(Error('OFFLINE'));
 const root=await mount();await clickFavorite(label(root,'收藏 歌曲'));await settle();expect(label(root,'收藏 歌曲').props['aria-pressed']).toBe(false);expect(fixture.app.error).toHaveBeenCalledWith(expect.objectContaining({message:'OFFLINE'}));
 delete fixture.app.room.playlist[0].neteaseId;await settle();expect(label(root,'此歌曲暂无可收藏的音源 ID').props.disabled).toBe(true);
});
it('does not apply an old favorite response to a newly playing track',async()=>{
 fixture.app.user={id:'user'};fixture.app.room.playlist[0].neteaseId='123';let finish!:(data:any)=>void;fixture.setFavorite.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));
 const root=await mount(),pending=clickFavorite(label(root,'收藏 歌曲'));await settle();fixture.app.room.playlist.push({id:'two',neteaseId:'456',name:'新歌曲',durationMs:10000});fixture.app.room.playback.sourceId='two';await settle();
 finish([{source:'netease',id:'123',name:'歌曲',artists:'',album:'',coverUrl:'',durationMs:100000,savedAt:1}]);await pending;await settle();expect(label(root,'收藏 新歌曲').props['aria-pressed']).toBe(false);expect(fixture.setFavorite).toHaveBeenCalledWith('netease','123',true);
});
it('keeps the player favorite button visible and touch-sized at all responsive breakpoints',()=>{
 const css=readFileSync(new URL('../src/brilliant.css',import.meta.url),'utf8');expect(css).not.toMatch(/\.favorite-control\s*\{[^}]*display\s*:\s*none/);
 const {descriptor}=parse(readFileSync(new URL('../src/components/GlobalPlayer.vue',import.meta.url),'utf8')),scoped=descriptor.styles[0].content;
 expect(scoped).toContain('.global-player .favorite-control{display:inline-flex');expect(scoped).toContain('min-width:44px;min-height:44px');expect(scoped).toContain('@media(max-width:600px)');expect(scoped).toContain('width:calc(100% - 206px)');
});
