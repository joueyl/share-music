import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';
import { all, node, renderer, text } from './helpers/vue-host';
import Playlists from '../src/views/Playlists.vue';
import { parsePlaylistLink } from '@music-share/shared';
import { parse } from '@vue/compiler-sfc';
import { readFileSync } from 'node:fs';
const f=vi.hoisted(()=>({app:null as any,detail:vi.fn(),resolve:vi.fn(),users:vi.fn(),songs:vi.fn()}));
vi.mock('../src/store',()=>({useApp:()=>f.app}));
vi.mock('../src/server-config',()=>({getServerUrl:()=> 'http://localhost:3000'}));
vi.mock('../src/bridge',()=>({playlistDetail:f.detail,resolvePlaylistLink:f.resolve,userPlaylists:f.users,playlistSongs:f.songs}));
let mounted:ReturnType<typeof renderer.createApp>;
const settle=async()=>{for(let i=0;i<8;i++){await Promise.resolve();await nextTick();}};
const saved=Array.from({length:30},(_,i)=>({id:String(i+1),name:`最近歌单${i+1}`}));
beforeEach(()=>{
 vi.stubGlobal('Document',class{});vi.stubGlobal('ShadowRoot',class{});
 f.app=reactive({user:{id:'user'},room:{id:'room',playlist:[]},connected:true,permission:{enqueue:true,skip:true}});
 vi.stubGlobal('localStorage',{getItem:vi.fn(()=>JSON.stringify(saved)),setItem:vi.fn()});
 f.resolve.mockReset().mockImplementation(async(input:string)=>parsePlaylistLink(input));
 f.detail.mockReset().mockResolvedValue({id:'1',name:'测试歌单',creatorId:'123',trackCount:100});
 f.users.mockReset().mockResolvedValue({playlists:[],more:false});
 f.songs.mockReset().mockResolvedValue(Array.from({length:50},(_,i)=>({id:String(i+1),name:`歌曲${i+1}`,artists:'歌手',album:'专辑'})));
});
afterEach(()=>{mounted?.unmount();vi.unstubAllGlobals();});
async function mount(){const root=node('root');mounted=renderer.createApp(Playlists);mounted.mount(root);await settle();return root;}
async function importPlaylist(root:any,value='https://music.163.com/m/playlist?id=1&creatorId=999'){
 const input=all(root).find(n=>n.props['aria-label']==='网易云歌单链接');input.props['onUpdate:modelValue'](value);await settle();
 await all(root).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await settle();
}
it('imports only the requested playlist and ignores old recent-history and creatorId',async()=>{
 const root=await mount();await importPlaylist(root);
 expect(f.detail).toHaveBeenCalledWith('1');expect(f.songs).toHaveBeenCalledWith('1',0);expect(f.users).not.toHaveBeenCalled();
 expect(localStorage.getItem).not.toHaveBeenCalled();expect(localStorage.setItem).not.toHaveBeenCalled();
 expect(all(root).some(n=>n.type==='select'||n.props.class==='playlist-card')).toBe(false);
 expect(text(root)).toContain('歌单 ID：1');expect(text(root)).not.toContain('用户歌单');
});
it('keeps load-more inside this playlist, with the import bar and instructions collapsed',async()=>{
 const root=await mount();await importPlaylist(root);
 expect(all(root).some(n=>n.props.class==='music-search-form collection-import')).toBe(false);
 const list=all(root).find(n=>n.props['aria-label']==='歌单歌曲列表');
 expect(all(list).filter(n=>n.type==='label')).toHaveLength(50);
 const more=all(list).find(n=>n.type==='button'&&text(n).includes('加载更多歌曲'));
 f.songs.mockResolvedValueOnce([{id:'51',name:'歌曲51',artists:'歌手',album:'专辑'}]);await more.props.onClick();await settle();
 expect(f.songs).toHaveBeenLastCalledWith('1',50);expect(f.users).not.toHaveBeenCalled();
 const help=all(root).find(n=>n.type==='details'&&n.props.class==='library-help');expect(help.props.open).not.toBe(true);
 const change=all(root).find(n=>n.type==='button'&&text(n)==='更换歌单');await change.props.onClick();await settle();
 expect(all(root).some(n=>n.props['aria-label']==='网易云歌单链接')).toBe(true);
 f.detail.mockResolvedValueOnce({id:'2',name:'另一个歌单',trackCount:1});f.songs.mockResolvedValueOnce([{id:'99',name:'新歌',artists:'歌手'}]);
 await importPlaylist(root,'2');expect(f.songs).toHaveBeenLastCalledWith('2',0);
 const newList=all(root).find(n=>n.props['aria-label']==='歌单歌曲列表');expect(all(newList).filter(n=>n.type==='label')).toHaveLength(1);
 expect(text(root)).toContain('歌单 ID：2');expect(text(newList)).not.toContain('歌曲1');
});
it('reports a failed import without falling back to the users other playlists',async()=>{
 const root=await mount();f.detail.mockRejectedValueOnce(Error('NOT_FOUND'));await importPlaylist(root);
 expect(text(root)).toContain('NOT_FOUND');expect(f.users).not.toHaveBeenCalled();expect(f.songs).not.toHaveBeenCalled();
});
it('expands a mobile short share before requesting only its resolved playlist',async()=>{
 const root=await mount();f.resolve.mockResolvedValueOnce({id:'777'});
 f.detail.mockResolvedValueOnce({id:'777',name:'手机分享',trackCount:1});f.songs.mockResolvedValueOnce([{id:'9',name:'手机歌曲'}]);
 await importPlaylist(root,'分享歌单 https://163cn.tv/Abc (@网易云音乐)');
 expect(f.resolve).toHaveBeenCalledWith('分享歌单 https://163cn.tv/Abc (@网易云音乐)');
 expect(f.detail).toHaveBeenCalledWith('777');expect(f.songs).toHaveBeenCalledWith('777',0);expect(f.users).not.toHaveBeenCalled();
 expect(text(root)).toContain('歌单 ID：777');
});
it('reserves remaining height for lists and compacts only the my-music controls',()=>{
 const {descriptor,errors}=parse(readFileSync(new URL('../src/views/Playlists.vue',import.meta.url),'utf8'));
 expect(errors).toEqual([]);const css=descriptor.styles[0].content;expect(descriptor.styles[0].scoped).toBe(true);
 expect(css).toContain('.tone-library .track-list{flex:1;min-height:0;overflow:auto;');
 expect(css).toContain('.library-topbar{display:flex;');expect(css).toContain('.library-selection-toolbar{display:flex;');
 expect(css).toContain('min-height:56px');expect(css).toContain('max-width:760px');
});
