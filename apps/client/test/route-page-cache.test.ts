import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { computed,defineComponent,h,KeepAlive,nextTick,onMounted,onUnmounted,reactive,ref } from 'vue';
import { createPinia } from 'pinia';
import { readFileSync } from 'node:fs';
import { all,node,renderer,text } from './helpers/vue-host';
import Playlists from '../src/views/Playlists.vue';
import CachedMusicPage from '../src/components/CachedMusicPage.vue';
import { createPlaybackCacheHost } from '../src/playback-cache-host';
import { useCachedActivity } from '../src/useCachedActivity';
const f=vi.hoisted(()=>({app:null as any,profile:vi.fn(),users:vi.fn(),detail:vi.fn(),songs:vi.fn(),collections:vi.fn(),favoriteSongs:vi.fn()}));
vi.mock('../src/store',()=>({useApp:()=>f.app}));
vi.mock('../src/server-config',()=>({getServerUrl:()=> 'http://localhost:3000'}));
vi.mock('../src/bridge',()=>({musicProfile:f.profile,userPlaylists:f.users,playlistDetail:f.detail,playlistSongs:f.songs,musicFavorites:f.collections,favoriteSongs:f.favoriteSongs}));
let mounted:ReturnType<typeof renderer.createApp>|undefined;
const settle=async()=>{for(let i=0;i<10;i++){await Promise.resolve();await nextTick();}};
beforeEach(()=>{
 vi.stubGlobal('Document',class{});vi.stubGlobal('ShadowRoot',class{});
 f.app=reactive({user:{id:'user'},room:{id:'one',playlist:[],pending:null},connected:true,permission:{enqueue:true,skip:true},pendingActions:0,busy:false});
 f.profile.mockReset().mockResolvedValue({source:'netease',id:'123',nickname:'缓存主页',avatarUrl:'',signature:'签名'});
 f.users.mockReset().mockResolvedValue({playlists:[{id:'1',name:'缓存歌单',trackCount:3}],more:false});
 f.detail.mockReset().mockResolvedValue({id:'1',name:'缓存详情',trackCount:3});f.songs.mockReset().mockResolvedValue(Array.from({length:3},(_,i)=>({id:String(i+1),name:'歌曲'+(i+1),artists:'歌手',album:'专辑'})));
 f.collections.mockReset().mockResolvedValue([]);f.favoriteSongs.mockReset().mockResolvedValue([{source:'netease',id:'1',name:'收藏歌曲',artists:'歌手',album:'专辑',coverUrl:'',durationMs:1000,savedAt:0}]);
});
afterEach(()=>{mounted?.unmount();mounted=undefined;vi.unstubAllGlobals();});
async function mount(){
 const path=ref('/playlists'),roomMount=vi.fn(),roomUnmount=vi.fn(),resume=vi.fn(),pause=vi.fn(),lobbyMount=vi.fn(),lobbyUnmount=vi.fn();
 const Room=defineComponent({setup(){onMounted(roomMount);onUnmounted(roomUnmount);useCachedActivity(resume,pause);return()=>h('section','room');}});
 const Lobby=defineComponent({setup(){onMounted(lobbyMount);onUnmounted(lobbyUnmount);return()=>h('section','lobby');}});
 const Root=defineComponent({setup(){
  const playbackKey=computed(()=>JSON.stringify([f.app.user?.id,f.app.room?.id??(path.value.startsWith('/room/')?path.value.split('/')[2]:null)]));
  const playbackHost=computed(()=>createPlaybackCacheHost(playbackKey.value));
  return()=>!f.app.user?h('div','auth'):h(KeepAlive,{key:f.app.user.id,include:['CachedMusicPage',playbackHost.value.name!],max:2},{default:()=>path.value==='/playlists'?h(CachedMusicPage,{key:'my-music',view:Playlists}):path.value.startsWith('/room/')?h(playbackHost.value,{key:path.value,view:Room}):h('div',{key:path.value,class:'route-page'},[h(Lobby)])});
 }});
 const root=node('root');mounted=renderer.createApp(Root);mounted.use(createPinia());mounted.mount(root);await settle();
 return {root,path,roomMount,roomUnmount,resume,pause,lobbyMount,lobbyUnmount};
}
const click=async(root:any,label:string)=>{all(root).find(n=>n.type==='button'&&text(n)===label).props.onClick();await settle();};
it('retains the actual music page, details, selection, link draft and scrollports without duplicate requests',async()=>{
 const {root,path}=await mount(),page=all(root).find(n=>String(n.props.class).includes('tone-library'));
 await all(root).find(n=>n.props['aria-label']==='打开歌单 缓存歌单').props.onClick();await settle();
 const list=all(root).find(n=>n.props['aria-label']==='歌单歌曲列表');all(list).find(n=>n.type==='input').props.onChange();await settle();expect(text(root)).toContain('已选 2 首');
 await click(root,'更换链接');const input=all(root).find(n=>n.props.id==='music-reference');input.props['onUpdate:modelValue']('未提交的链接');await settle();
 const host=all(root).find(n=>n.props.class==='route-page');Object.assign(host,{contains:(el:any)=>all(host).includes(el),scrollTop:24,scrollLeft:0});Object.assign(list,{scrollTop:160,scrollLeft:0});
 host.props.onScrollCapture({target:list});host.props.onScrollCapture({target:host});
 path.value='/';await settle();expect(all(root).includes(page)).toBe(false);list.scrollTop=0;host.scrollTop=0;
 path.value='/playlists';await settle();expect(all(root).includes(page)).toBe(true);expect(all(root).includes(list)).toBe(true);expect(text(root)).toContain('已选 2 首');expect(all(root).find(n=>n.props.id==='music-reference').value).toBe('未提交的链接');expect(list.scrollTop).toBe(160);expect(host.scrollTop).toBe(24);
 expect(f.profile).toHaveBeenCalledOnce();expect(f.users).toHaveBeenCalledOnce();expect(f.detail).toHaveBeenCalledOnce();expect(f.songs).toHaveBeenCalledOnce();
});
it('retains the favorites category and subtab while leaving discovery uncached',async()=>{
 const {root,path,lobbyMount,lobbyUnmount}=await mount();await click(root,'已收藏');await click(root,'已收藏的单曲');expect(text(root)).toContain('收藏歌曲');
 path.value='/';await settle();path.value='/playlists';await settle();expect(all(root).find(n=>n.props.role==='tab'&&text(n)==='已收藏的单曲').props['aria-selected']).toBe(true);expect(text(root)).toContain('收藏歌曲');
 path.value='/';await settle();path.value='/playlists';await settle();expect(lobbyMount).toHaveBeenCalledTimes(2);expect(lobbyUnmount).toHaveBeenCalledTimes(2);expect(f.favoriteSongs).toHaveBeenCalledOnce();expect(f.collections).toHaveBeenCalledOnce();
});
it('keeps one room and one music page, pauses the hidden room, and evicts only stale room scopes',async()=>{
 const {root,path,roomMount,roomUnmount,resume,pause}=await mount(),page=all(root).find(n=>String(n.props.class).includes('tone-library'));
 path.value='/room/one';await settle();expect(roomMount).toHaveBeenCalledTimes(1);
 path.value='/playlists';await settle();expect(pause).toHaveBeenCalledTimes(1);expect(roomUnmount).not.toHaveBeenCalled();expect(all(root).includes(page)).toBe(true);
 path.value='/room/one';await settle();expect(roomMount).toHaveBeenCalledTimes(1);expect(resume).toHaveBeenCalledTimes(2);
 path.value='/playlists';await settle();f.app.room={id:'two',playlist:[],pending:null};await settle();expect(roomUnmount).toHaveBeenCalledTimes(1);expect(all(root).includes(page)).toBe(true);
 path.value='/room/two';await settle();expect(roomMount).toHaveBeenCalledTimes(2);path.value='/playlists';await settle();f.app.room=null;await settle();expect(roomUnmount).toHaveBeenCalledTimes(2);expect(all(root).includes(page)).toBe(true);expect(f.profile).toHaveBeenCalledOnce();
});
it('drops cached music data on account replacement and logout and ignores an old pending detail result',async()=>{
 const {root,path}=await mount(),oldPage=all(root).find(n=>String(n.props.class).includes('tone-library'));let finish!:(data:any)=>void;f.detail.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));
 const pending=all(root).find(n=>n.props['aria-label']==='打开歌单 缓存歌单').props.onClick();await settle();path.value='/';await settle();f.app.user={id:'other'};await settle();finish({id:'1',name:'旧账号迟到的详情',trackCount:0});await pending;await settle();path.value='/playlists';await settle();
 expect(all(root).includes(oldPage)).toBe(false);expect(text(root)).not.toContain('旧账号迟到的详情');expect(text(root)).not.toContain('返回歌单列表');expect(f.profile).toHaveBeenCalledTimes(2);
 f.app.user=null;await settle();expect(text(root)).toBe('auth');f.app.user={id:'other'};await settle();expect(f.profile).toHaveBeenCalledTimes(3);
});
it('wires the production route cache to the user, not the room, and preserves original route-page geometry',()=>{
 const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8'),host=readFileSync(new URL('../src/components/CachedMusicPage.vue',import.meta.url),'utf8');
 expect(app).toContain('<KeepAlive :key="app.user.id" :include="cachedPageNames" :max="2">');expect(app).toContain("route.path==='/playlists'");expect(app).toContain('createPlaybackCacheHost(playbackCacheKey.value)');expect(host).toContain('class="route-page"');expect(host).not.toContain('new Audio');
});
