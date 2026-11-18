import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { reactive,nextTick } from 'vue';
import { renderer,node,all,text } from './helpers/vue-host';
import ApkLogin from '../src/apk/pages/LoginPage.vue';
import DesktopLogin from '../src/components/AuthPage.vue';
import ApkDiscover from '../src/apk/pages/DiscoverPage.vue';
import DesktopDiscover from '../src/views/Lobby.vue';
import ApkPlayer from '../src/apk/components/ApkPlayer.vue';
import DesktopPlayer from '../src/components/GlobalPlayer.vue';
import ApkMusic from '../src/apk/pages/MusicPage.vue';
import DesktopMusic from '../src/views/Playlists.vue';
const f=vi.hoisted(()=>({app:null as any,list:vi.fn(),join:vi.fn(),push:vi.fn(),volume:vi.fn(),add:vi.fn(),remember:vi.fn(),clear:vi.fn()}));
vi.mock('../src/store',()=>({useApp:()=>f.app}));
vi.mock('vue-router',()=>({useRouter:()=>({push:f.push,replace:f.push})}));
vi.mock('../src/saved-login',()=>({canRememberLogin:f.remember,clearSavedLogin:f.clear}));
vi.mock('../src/bridge',()=>({desktop:false,__v_isRef:false,listRooms:f.list,join:f.join,playingTrackCover:()=>'',favoriteTrackReference:()=>null,setVolume:f.volume,musicProfile:async()=>null,musicFavorites:async()=>[],resolveMusicLink:async()=>({kind:'playlist',id:'123'}),playlistDetail:async()=>({id:'123',name:'共享业务歌单',trackCount:2}),playlistSongs:async()=>[{id:'1',name:'第一首'},{id:'2',name:'第二首'}],addSearchedMusicBatch:f.add}));
vi.mock('../src/components/RoomSettingsDialog.vue',()=>({default:{render:()=>null}}));
vi.mock('../src/components/SongFavoriteButton.vue',()=>({default:{render:()=>null}}));
vi.mock('vue',async original=>{const vue=await original<typeof import('vue')>();return {...vue,TransitionGroup:{setup(_:unknown,{slots}:{slots:any}){return()=>vue.h('div',slots.default?.());}}};});
let mounted:ReturnType<typeof renderer.createApp>;
const settle=async()=>{for(let i=0;i<8;i++){await Promise.resolve();await nextTick();}};
beforeEach(()=>{
 vi.useFakeTimers();vi.stubGlobal('Document',class{});vi.stubGlobal('ShadowRoot',class{});vi.stubGlobal('document',{getElementById:()=>null});
 f.remember.mockReset().mockResolvedValue(false);f.clear.mockReset().mockResolvedValue(undefined);
 f.list.mockReset().mockResolvedValue([{id:'room',name:'真实接口房间',members:2,maxMembers:8}]);f.join.mockReset().mockResolvedValue(undefined);f.push.mockReset();f.volume.mockReset().mockResolvedValue(undefined);
 f.add.mockReset().mockImplementation(async(_room,requests)=>requests.map((r:any)=>({ok:true,songId:r.songId,track:{id:r.songId}})));
 f.app=reactive({user:null,room:null,busy:false,connected:true,permission:{skip:true,seek:true,enqueue:true,playbackMode:true},pendingActions:0,notice:'',progress:2000,initialize:vi.fn().mockResolvedValue(undefined),login:vi.fn().mockResolvedValue(undefined),error:vi.fn(),act:vi.fn().mockResolvedValue(undefined)});
});
afterEach(()=>{mounted?.unmount();vi.useRealTimers();vi.unstubAllGlobals();});
async function mount(component:any){const root=node('root');mounted=renderer.createApp(component);mounted.component('router-link',{render(){return null;}});mounted.mount(root);await settle();return root;}
it.each([['desktop',DesktopLogin],['APK',ApkLogin]])('%s restores remembered login and honors opt-out before submit',async(_name,component)=>{
 f.remember.mockResolvedValue(true);f.app.restoreLogin=vi.fn().mockResolvedValue({name:'saved-user'});
 const root=await mount(component);const fields=all(root).filter(n=>n.type==='input');
 expect(fields.find(n=>n.props.autocomplete==='username').value).toBe('saved-user');
 const remember=fields.find(n=>n.props.type==='checkbox');expect(remember.props.disabled).toBe(false);expect(remember.checked).toBe(true);
 fields.find(n=>n.props.autocomplete==='current-password').props['onUpdate:modelValue']('example-password');
 await all(root).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});expect(f.app.login).toHaveBeenLastCalledWith('saved-user','example-password',false,true);
 remember.props['onUpdate:modelValue'](false);await remember.props.onChange();expect(f.clear).toHaveBeenCalledOnce();
 await all(root).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});expect(f.app.login).toHaveBeenLastCalledWith('saved-user','example-password',false,false);
});
it.each([['desktop',DesktopLogin],['APK',ApkLogin]])('%s validates confirmation before invoking the same authentication contract',async(_name,component)=>{
 const root=await mount(component);const toggle=all(root).find(n=>n.type==='button'&&(text(n)==='注册'||text(n)==='立即注册'));toggle.props.onClick();await settle();
 const inputs=all(root).filter(n=>n.type==='input');inputs[0].props['onUpdate:modelValue']('listener');inputs[1].props['onUpdate:modelValue']('password-123');inputs[2].props['onUpdate:modelValue']('wrong-password');await settle();
 const submit=all(root).find(n=>n.type==='form').props.onSubmit;await submit({preventDefault(){}});expect(f.app.login).not.toHaveBeenCalled();
 inputs[2].props['onUpdate:modelValue']('password-123');await settle();await submit({preventDefault(){}});expect(f.app.login).toHaveBeenCalledWith('listener','password-123',true,false);
});
it.each([['desktop',DesktopDiscover],['APK',ApkDiscover]])('%s waits for join confirmation and refuses full/disconnected rooms',async(_name,component)=>{
 const root=await mount(component);const card=all(root).find(n=>n.type==='button'&&String(n.props['aria-label']).includes('真实接口房间'));
 f.app.connected=false;await settle();await card.props.onClick();expect(f.join).not.toHaveBeenCalled();f.app.connected=true;await card.props.onClick();expect(f.join).toHaveBeenCalledWith('room');expect(f.push).toHaveBeenCalledWith('/room/room');
});
it.each([['desktop',DesktopPlayer],['APK',ApkPlayer]])('%s shares playback permission/pending guards and seek clamping',async(_name,component)=>{
 f.app.room={id:'room',playbackMode:'queue',playlist:[{id:'song',name:'歌曲',durationMs:10000}],playback:{sourceId:'song',sourceEpoch:1,playState:'paused'},pending:null};
 const root=await mount(component),play=all(root).find(n=>n.props['aria-label']==='继续');play.props.onClick();expect(f.app.act).toHaveBeenLastCalledWith({type:'resume',payload:{}});
 f.app.act.mockClear();f.app.permission.skip=false;await settle();play.props.onClick();expect(f.app.act).not.toHaveBeenCalled();
 const expand=all(root).find(n=>n.props['aria-label']==='展开播放控制');expand.props.onClick();await settle();const range=all(root).find(n=>n.props['aria-label']==='歌曲进度');range.props.onInput({target:{value:'999999'}});await range.props.onChange({target:{value:'999999'}});expect(f.app.act).toHaveBeenLastCalledWith({type:'seek',payload:{positionMs:9999}});
 f.app.act.mockClear();f.app.pendingActions=1;await settle();range.props.onInput({target:{value:'5000'}});await range.props.onChange({target:{value:'5000'}});expect(f.app.act).not.toHaveBeenCalled();
});
it.each([['desktop',DesktopMusic],['APK',ApkMusic]])('%s shares collection loading, selection and permission-checked idempotent enqueue',async(_name,component)=>{
 f.app.user={id:'user'};f.app.room={id:'room',playlist:[],pending:null};const root=await mount(component);
 const input=all(root).find(n=>n.type==='input'&&n.props.maxlength==='4096');input.props['onUpdate:modelValue']('https://music.163.com/#/playlist?id=123');await settle();
 await all(root).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await settle();expect(text(root)).toContain('共享业务歌单');expect(text(root)).toContain('已选 2 首');
 const add=all(root).find(n=>n.type==='button'&&text(n).includes('加入房间 · 2 首'));f.app.permission.enqueue=false;await settle();await add.props.onClick();expect(f.add).not.toHaveBeenCalled();
 f.app.permission.enqueue=true;await settle();await add.props.onClick();await settle();expect(f.add).toHaveBeenCalledWith('room',[{songId:'1',requestId:expect.any(String),coverUrl:undefined},{songId:'2',requestId:expect.any(String),coverUrl:undefined}]);expect(f.app.act).not.toHaveBeenCalled();expect(text(root)).toContain('已选 0 首');
});
