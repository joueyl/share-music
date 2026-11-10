import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { createPinia,setActivePinia,disposePinia,type Pinia } from 'pinia';
import { nextTick,reactive } from 'vue';
import { useSongFavorites } from '../src/song-favorites';
import FavoriteSongsList from '../src/components/FavoriteSongsList.vue';
import { all,node,renderer,text } from './helpers/vue-host';
const f=vi.hoisted(()=>({app:null as any,read:vi.fn(),set:vi.fn(),add:vi.fn()}));
vi.mock('../src/store',()=>({useApp:()=>f.app}));
vi.mock('../src/bridge',()=>({favoriteSongs:f.read,setFavoriteSong:f.set,addSearchedMusicBatch:f.add}));
let pinia:Pinia,mounted:ReturnType<typeof renderer.createApp>|undefined;
const song={source:'netease' as const,id:'1',name:'收藏歌曲',artists:'歌手',album:'专辑',coverUrl:'',durationMs:180000,savedAt:1};
const settle=async()=>{for(let i=0;i<8;i++){await Promise.resolve();await nextTick();}};
beforeEach(()=>{
 pinia=createPinia();setActivePinia(pinia);f.app=reactive({user:{id:'a'},room:{id:'room',playlist:[],pending:null},connected:true,permission:{enqueue:true},pendingActions:0,busy:false,error:vi.fn()});
 f.read.mockReset().mockResolvedValue([song]);f.set.mockReset().mockResolvedValue([]);f.add.mockReset().mockResolvedValue([{songId:'1',ok:true,track:{id:'track'}}]);
});
afterEach(()=>{mounted?.unmount();mounted=undefined;disposePinia(pinia);});
it('shares one read and server-confirmed state across components, and isolates users and sources',async()=>{
 const a=useSongFavorites(),b=useSongFavorites();expect(a).toBe(b);await Promise.all([a.read(),b.read()]);expect(f.read).toHaveBeenCalledOnce();expect(a.has('netease','1')).toBe(true);expect(a.has('qq','1')).toBe(false);
 let finish!:(x:any)=>void;f.set.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));const pending=a.set('netease','1',false);await settle();expect(a.has('netease','1')).toBe(true);expect(a.pending).toBe('netease:1');
 finish([]);await pending;expect(b.songs).toEqual([]);f.app.user={id:'b'};expect(a.songs).toEqual([]);expect(a.ready).toBe(false);
});
it('ignores old-user read and mutation results without showing stale favorites',async()=>{
 let finish!:(x:any)=>void;f.read.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));const store=useSongFavorites(),old=store.read();f.app.user={id:'b'};f.read.mockResolvedValueOnce([]);await store.read();finish([song]);await old;expect(store.songs).toEqual([]);expect(store.ready).toBe(true);
 f.set.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));const write=store.set('netease','1',true);await settle();f.app.user={id:'c'};finish([song]);await write;expect(store.songs).toEqual([]);expect(store.pending).toBe('');expect(store.ready).toBe(false);
});
it('does not turn read/write failures into successful empty data and can retry',async()=>{
 const store=useSongFavorites();f.read.mockRejectedValueOnce(Error('OFFLINE'));await store.read();expect(store.ready).toBe(false);expect(store.error).toBe('OFFLINE');
 await store.read(true);expect(store.songs).toEqual([song]);f.set.mockRejectedValueOnce(Error('WRITE_FAILED'));await expect(store.set('netease','1',false)).rejects.toThrow('WRITE_FAILED');expect(store.songs).toEqual([song]);expect(store.pending).toBe('');
});
async function mount(){const root=node('root');mounted=renderer.createApp(FavoriteSongsList);mounted.use(pinia);mounted.mount(root);await settle();return root;}
it('renders real metadata and adds through the existing source-aware import without triggering playback',async()=>{
 const root=await mount();expect(text(root)).toContain('收藏歌曲');const add=all(root).find(n=>n.props['aria-label']==='加入队列 收藏歌曲');await add.props.onClick();await settle();expect(f.add).toHaveBeenCalledWith('room',[{songId:'1',requestId:expect.any(String),coverUrl:''}],'netease');expect(text(root)).toContain('已加入：收藏歌曲');
});
it('retains the same request ID after failed enqueue and prevents requests when full/disconnected/unauthorized',async()=>{
 const root=await mount(),button=()=>all(root).find(n=>n.props['aria-label']==='加入队列 收藏歌曲');f.add.mockRejectedValueOnce(Error('OFFLINE'));await button().props.onClick();await settle();const id=f.add.mock.calls[0][1][0].requestId;await button().props.onClick();await settle();expect(f.add.mock.calls[1][1][0].requestId).toBe(id);
 f.app.room.playlist=Array(200).fill({});await button().props.onClick();await settle();expect(f.add).toHaveBeenCalledTimes(2);expect(text(root)).toContain('房间最多 200 首');
 for(const patch of [()=>{f.app.connected=false;},()=>{f.app.connected=true;f.app.permission.enqueue=false;},()=>{f.app.permission.enqueue=true;f.app.room.pending={};},()=>{f.app.room.pending=null;f.app.pendingActions=1;},()=>{f.app.pendingActions=0;f.app.room=null;}]){patch();await settle();expect(button().props.disabled).toBe(true);await button().props.onClick();expect(f.add).toHaveBeenCalledTimes(2);}
});
it('shows loading and failed reads distinctly from an empty collection',async()=>{
 let finish!:(x:any)=>void;f.read.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));const root=await mount();expect(text(root)).toContain('正在读取收藏单曲');expect(text(root)).not.toContain('还没有收藏的单曲');finish([]);await settle();expect(text(root)).toContain('还没有收藏的单曲');
 f.read.mockRejectedValueOnce(Error('OFFLINE'));await all(root).find(n=>n.type==='button'&&text(n)==='刷新收藏').props.onClick();await settle();expect(text(root)).toContain('OFFLINE');expect(text(root)).not.toContain('还没有收藏的单曲');
});
it('ignores enqueue results after switching users or rooms',async()=>{
 let finish!:(x:any)=>void;const root=await mount();f.add.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));const pending=all(root).find(n=>n.props['aria-label']==='加入队列 收藏歌曲').props.onClick();await settle();f.app.user={id:'b'};await settle();finish([{songId:'1',ok:true,track:{id:'old'}}]);await pending;await settle();expect(text(root)).not.toContain('已加入：');
});
