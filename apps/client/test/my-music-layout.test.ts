import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';
import { all, node, renderer, text } from './helpers/vue-host';
import Playlists from '../src/views/Playlists.vue';
import { parseMusicReference } from '@music-share/shared';
import { parse } from '@vue/compiler-sfc';
import { readFileSync } from 'node:fs';
const f=vi.hoisted(()=>({app:null as any,detail:vi.fn(),resolve:vi.fn(),users:vi.fn(),songs:vi.fn(),favorites:vi.fn(),favorite:vi.fn(),album:vi.fn(),add:vi.fn(),play:vi.fn()}));
vi.mock('../src/store',()=>({useApp:()=>f.app}));
vi.mock('../src/server-config',()=>({getServerUrl:()=> 'http://localhost:3000'}));
vi.mock('../src/bridge',()=>({playlistDetail:f.detail,resolveMusicLink:f.resolve,userPlaylists:f.users,playlistSongs:f.songs,musicFavorites:f.favorites,setMusicFavorite:f.favorite,albumDetail:f.album,addSearchedMusic:f.add,playMusic:f.play}));
let mounted:ReturnType<typeof renderer.createApp>;
const settle=async()=>{for(let i=0;i<8;i++){await Promise.resolve();await nextTick();}};
const saved=Array.from({length:30},(_,i)=>({id:String(i+1),name:`最近歌单${i+1}`}));
beforeEach(()=>{
 vi.stubGlobal('Document',class{});vi.stubGlobal('ShadowRoot',class{});
 f.app=reactive({user:{id:'user'},room:{id:'room',playlist:[]},connected:true,permission:{enqueue:true,skip:true}});
 vi.stubGlobal('localStorage',{getItem:vi.fn(()=>JSON.stringify(saved)),setItem:vi.fn()});
 f.resolve.mockReset().mockImplementation(async(input:string)=>parseMusicReference(input));
 f.favorites.mockReset().mockResolvedValue([]);f.favorite.mockReset().mockResolvedValue([]);f.add.mockReset().mockResolvedValue({id:'added'});
 f.play.mockReset().mockResolvedValue({});
 f.album.mockReset().mockResolvedValue({collection:{kind:'album',id:'38306',name:'测试专辑',trackCount:1,creatorId:'',coverUrl:''},songs:[{id:'8',name:'专辑歌曲',artists:'歌手',album:'专辑'}]});
 f.detail.mockReset().mockResolvedValue({id:'1',name:'测试歌单',creatorId:'123',trackCount:100});
 f.users.mockReset().mockResolvedValue({playlists:[],more:false});
 f.songs.mockReset().mockResolvedValue(Array.from({length:50},(_,i)=>({id:String(i+1),name:`歌曲${i+1}`,artists:'歌手',album:'专辑'})));
});
afterEach(()=>{mounted?.unmount();vi.unstubAllGlobals();});
async function mount(){const root=node('root');mounted=renderer.createApp(Playlists);mounted.mount(root);await settle();return root;}
async function importPlaylist(root:any,value='https://music.163.com/m/playlist?id=1&creatorId=999'){
 const input=all(root).find(n=>n.props['aria-label']==='网易云个人主页、歌单或专辑链接');input.props['onUpdate:modelValue'](value);await settle();
 await all(root).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await settle();
}
it('direct playlist links ignore creatorId and never load unrelated profile playlists or local history',async()=>{
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
 const change=all(root).find(n=>n.type==='button'&&text(n)==='更换链接');await change.props.onClick();await settle();
 expect(all(root).some(n=>n.props['aria-label']==='网易云个人主页、歌单或专辑链接')).toBe(true);
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
 const root=await mount();f.resolve.mockResolvedValueOnce({kind:'playlist',id:'777'});
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
 expect(css).toContain('min-height:68px');expect(css).toContain('max-width:760px');
});

it('shows exactly the requested two music tabs',async()=>{
 const root=await mount();expect(all(root).filter(n=>n.props.role==='tab').map(n=>text(n).trim())).toEqual(['网易云歌单','已收藏']);
});
it('loads all accessible profile playlist pages, then opens only the selected playlist',async()=>{
 const root=await mount();f.users.mockResolvedValueOnce({playlists:[{id:'1',name:'主页歌单一',trackCount:2},{id:'2',name:'主页歌单二',trackCount:1}],more:true}).mockResolvedValueOnce({playlists:[{id:'3',name:'主页歌单三',trackCount:1}],more:false});
 await importPlaylist(root,'https://music.163.com/#/user?id=274950922');
 expect(f.users.mock.calls).toEqual([['274950922',0],['274950922',2]]);expect(f.detail).not.toHaveBeenCalled();
 expect(all(root).filter(n=>n.props.class==='music-collection-card')).toHaveLength(3);
 f.detail.mockResolvedValueOnce({id:'2',name:'主页歌单二',trackCount:1});
 await all(root).find(n=>n.props['aria-label']==='打开歌单 主页歌单二').props.onClick();await settle();expect(f.detail).toHaveBeenCalledWith('2');expect(f.songs).toHaveBeenCalledWith('2',0);
});
it('album paths with userid open album details, never a profile or a playlist',async()=>{
 const root=await mount();await importPlaylist(root,'https://music.163.com/#/album/38306/?userid=274950922');
 expect(f.album).toHaveBeenCalledWith('38306');expect(f.detail).not.toHaveBeenCalled();expect(f.users).not.toHaveBeenCalled();
 expect(text(root)).toContain('专辑 ID：38306');expect(text(root)).toContain('专辑歌曲');
 await all(root).find(n=>n.type==='button'&&text(n).includes('加入房间 ·')).props.onClick();await settle();expect(f.add).toHaveBeenCalledWith('room','8',expect.any(String),undefined);expect(f.play).not.toHaveBeenCalled();
});
it('favorites are confirmed by the server, shown in the favorites tab, and may be reopened',async()=>{
 const saved={kind:'playlist',id:'1',name:'收藏歌单',trackCount:1,creatorId:'123',coverUrl:''};
 const root=await mount();await importPlaylist(root,'1');let finish!:(value:any)=>void;f.favorite.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));
 const button=all(root).find(n=>n.props.class==='secondary favorite-action');const work=button.props.onClick();await settle();expect(f.favorite).toHaveBeenCalledWith('playlist','1',true);expect(button.props['aria-pressed']).toBe(false);
 finish([saved]);await work;await settle();expect(button.props['aria-pressed']).toBe(true);
 all(root).find(n=>n.props.role==='tab'&&text(n).trim()==='已收藏').props.onClick();await settle();expect(text(root)).toContain('收藏歌单');
 await all(root).find(n=>n.props['aria-label']==='打开歌单 收藏歌单').props.onClick();await settle();expect(f.detail).toHaveBeenLastCalledWith('1');
});
it('does not replace a newer link with an old pending profile result',async()=>{
 const root=await mount();let finish!:(value:any)=>void;f.users.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));
 const first=importPlaylist(root,'https://music.163.com/user?id=123');await settle();await importPlaylist(root,'https://music.163.com/album/38306/');
 finish({playlists:[{id:'9',name:'过期的主页歌单'}],more:false});await first;await settle();expect(text(root)).not.toContain('过期的主页歌单');expect(text(root)).toContain('专辑 ID：38306');
});
it('reports favorite read failures without presenting a fake empty successful collection',async()=>{
 f.favorites.mockRejectedValue(Error('OFFLINE'));const root=await mount();all(root).find(n=>n.props.role==='tab'&&text(n).trim()==='已收藏').props.onClick();await settle();
 expect(text(root)).toContain('收藏读取失败：OFFLINE');expect(text(root)).toContain('收藏暂时无法读取');expect(text(root)).not.toContain('还没有收藏');
});
it('keeps narrow and short library scrolling inside the fixed navigation and player',()=>{
 const css=readFileSync(new URL('../src/adaptive-layout.css',import.meta.url),'utf8');
 expect(css).toContain('@media(max-width:900px),(max-height:639px)');
 expect(css).toContain('.shell:not(.auth-shell)>.main:has(.tone-library){height:100dvh;min-height:0;display:flex;flex-direction:column}');
 expect(css).toContain('.main:has(.tone-library)>.route-page{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable}');
});
it.each(['playlist','album'] as const)('enters %s details before the request completes, with loading and retry in details',async(kind)=>{
 const item={kind,id:kind==='album'?'38306':'1',name:'待打开的收藏',trackCount:1,creatorId:'',coverUrl:''};
 f.favorites.mockResolvedValueOnce([item]);const root=await mount();all(root).find(n=>n.props.role==='tab'&&text(n).trim()==='已收藏').props.onClick();await settle();
 let reject!:(e:Error)=>void;const api=kind==='album'?f.album:f.detail;api.mockImplementationOnce(()=>new Promise((_,fail)=>reject=fail));
 const pending=all(root).find(n=>n.props['aria-label']===`打开${kind==='album'?'专辑':'歌单'} 待打开的收藏`).props.onClick();await settle();
 expect(all(root).some(n=>n.props.class==='collection-grid')).toBe(false);
 expect(text(root)).toContain('返回已收藏');expect(text(root)).toContain(`正在加载${kind==='album'?'专辑':'歌单'}详情`);
 expect(all(root).some(n=>n.props.class==='library-selection-toolbar')).toBe(false);
 reject(Error('DETAIL_OFFLINE'));await pending;await settle();expect(text(root)).toContain('DETAIL_OFFLINE');expect(text(root)).toContain('重新加载详情');expect(text(root)).not.toContain('暂无可读取的歌曲');
 await all(root).find(n=>n.type==='button'&&text(n)==='重新加载详情').props.onClick();await settle();expect(text(root)).not.toContain('重新加载详情');expect(text(root)).toContain('加入房间 ·');
});
it('returning during detail loading ignores its late response and preserves the collection list',async()=>{
 const item={kind:'album',id:'38306',name:'收藏专辑',trackCount:1,creatorId:'',coverUrl:''};f.favorites.mockResolvedValueOnce([item]);const root=await mount();all(root).find(n=>n.props.role==='tab'&&text(n).trim()==='已收藏').props.onClick();await settle();
 let finish!:(x:any)=>void;f.album.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));const pending=all(root).find(n=>n.props['aria-label']==='打开专辑 收藏专辑').props.onClick();await settle();
 all(root).find(n=>n.type==='button'&&text(n).includes('返回已收藏')).props.onClick();await settle();finish({collection:item,songs:[]});await pending;await settle();
 expect(all(root).some(n=>n.props.class==='collection-grid')).toBe(true);expect(text(root)).not.toContain('专辑 ID：38306');
});
it('anchors every collection cover to the start with a fixed square size',()=>{
 const {descriptor}=parse(readFileSync(new URL('../src/views/Playlists.vue',import.meta.url),'utf8'));const css=descriptor.styles[0].content;
 expect(css).toContain('justify-content:flex-start;text-align:left');expect(css).toContain('.collection-open .album-art{width:92px;height:92px;flex:0 0 92px;object-fit:cover}');expect(css).toContain('.collection-open>span{flex:1;min-width:0}');
});

it('presents aligned song metadata and real durations while keeping accessible selection',async()=>{
 f.songs.mockResolvedValueOnce([{id:'1',name:'长歌名',artists:'歌手',album:'专辑',durationMs:185000},{id:'2',name:'无时长',artists:'',album:'',durationMs:0}]);
 const root=await mount();await importPlaylist(root);expect(all(root).some(n=>n.props.class==='detail-list-columns')).toBe(false);expect(text(root)).toContain('歌手 · 专辑');expect(text(root)).toContain('3:05');expect(text(root)).toContain('未知歌手');
 const rows=all(root).filter(n=>n.props.class==='music-search-row');expect(rows[0].props['data-selected']).toBe(true);
 const checkbox=all(rows[0]).find(n=>n.type==='input');expect(checkbox.props['aria-label']).toBe('选择 长歌名');checkbox.props.onChange();await settle();expect(rows[0].props['data-selected']).toBe(false);
 const {descriptor}=parse(readFileSync(new URL('../src/views/Playlists.vue',import.meta.url),'utf8'));const css=descriptor.styles[0].content;expect(css).toContain('.tone-library .track-list{display:grid;grid-template-columns:minmax(0,1fr)');expect(css).not.toContain('min(340px,100%)');expect(css).toContain('white-space:nowrap;overflow:hidden;text-overflow:ellipsis');expect(css).toContain('background:var(--surface);border:1px solid var(--border);border-radius:16px');expect(css).not.toContain('.detail-list-columns');expect(css).toContain('focus-within');
});

it('removes the legacy dark border and backing from detail artwork without changing card borders',()=>{
 const {descriptor}=parse(readFileSync(new URL('../src/views/Playlists.vue',import.meta.url),'utf8'));const css=descriptor.styles[0].content;
 expect(css).toContain('.tone-library .detail-track-main .music-search-cover{width:44px;height:44px;flex:0 0 44px;border:0;border-radius:10px;background:transparent;box-shadow:none;object-fit:cover}');
 expect(css).toContain('background:var(--surface);border:1px solid var(--border);border-radius:16px');
});

it('shows only the centered empty placeholder after an empty favorites response, with a working browse action',async()=>{
 const root=await mount();all(root).find(n=>n.props.role==='tab'&&text(n).trim()==='已收藏').props.onClick();await settle();
 expect(text(root)).toContain('还没有收藏');
 expect(all(root).filter(n=>n.props['data-state']==='empty')).toHaveLength(1);
 for(const cls of ['collection-grid','music-collection-card','collection-summary','library-selection-toolbar'])expect(all(root).some(n=>n.props.class===cls)).toBe(false);
 expect(all(root).some(n=>n.type==='form'||n.type==='details')).toBe(false);
 expect(text(root)).not.toContain('可先浏览和收藏');expect(text(root)).not.toContain('读取失败');
 all(root).find(n=>n.type==='button'&&text(n)==='浏览网易云歌单').props.onClick();await settle();
 expect(all(root).some(n=>n.type==='form')).toBe(true);
});

it('does not show the empty-favorites success placeholder while a request is pending',async()=>{
 let finish!:(value:any)=>void;f.favorites.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));
 const root=await mount();all(root).find(n=>n.props.role==='tab'&&text(n)==='已收藏').props.onClick();await settle();
 expect(text(root)).toContain('正在读取收藏');expect(text(root)).not.toContain('还没有收藏');
 expect(all(root).some(n=>n.props['data-state']==='loading')).toBe(true);
 finish([]);await settle();expect(text(root)).toContain('还没有收藏');
});

it('clears the failed-read notice after a successful explicit favorites retry',async()=>{
 f.favorites.mockRejectedValue(Error('OFFLINE'));const root=await mount();all(root).find(n=>n.props.role==='tab'&&text(n)==='已收藏').props.onClick();await settle();
 expect(all(root).some(n=>n.props['data-state']==='error')).toBe(true);
 f.favorites.mockResolvedValueOnce([]);await all(root).find(n=>n.type==='button'&&text(n)==='重试读取收藏').props.onClick();await settle();
 expect(text(root)).not.toContain('OFFLINE');expect(text(root)).toContain('还没有收藏');
});

it('restores the previous collection scroll position when returning from details',async()=>{
 const item={kind:'playlist',id:'1',name:'收藏歌单',trackCount:1};f.favorites.mockResolvedValueOnce([item]);
 const root=await mount();all(root).find(n=>n.props.role==='tab'&&text(n)==='已收藏').props.onClick();await settle();
 const list=all(root).find(n=>n.props.class==='collection-grid');list.scrollTop=320;
 await all(root).find(n=>n.props['aria-label']==='打开歌单 收藏歌单').props.onClick();await settle();
 all(root).find(n=>n.type==='button'&&text(n)==='返回已收藏').props.onClick();await settle();
 expect(all(root).find(n=>n.props.class==='collection-grid').scrollTop).toBe(320);
});

it('keeps native collection navigation separate from the favorite action',async()=>{
 f.favorites.mockResolvedValueOnce([{kind:'album',id:'38306',name:'专辑卡片',trackCount:1}]);
 const root=await mount();all(root).find(n=>n.props.role==='tab'&&text(n)==='已收藏').props.onClick();await settle();
 const card=all(root).find(n=>n.props.class==='music-collection-card'),buttons=all(card).filter(n=>n.type==='button');
 expect(buttons).toHaveLength(2);for(const button of buttons)expect(all(button).filter(n=>n.type==='button')).toHaveLength(1);
 expect(buttons[0].props['data-collection-key']).toBe('album:38306');
 await buttons[1].props.onClick();await settle();expect(f.album).not.toHaveBeenCalled();expect(f.favorite).toHaveBeenCalledWith('album','38306',false);
});

it.each([
 ['no-room','可先浏览和收藏'],['offline','连接已断开'],['permission','当前没有播放列表控制权限'],['pending','房间正在处理操作'],['action','房间正在处理操作']
])('explains the disabled batch action for %s and prevents requests',async(reason,copy)=>{
 const root=await mount();await importPlaylist(root,'https://music.163.com/album/38306');
 if(reason==='no-room')f.app.room=null;if(reason==='offline')f.app.connected=false;if(reason==='permission')f.app.permission.enqueue=false;if(reason==='pending')f.app.room.pending={};if(reason==='action')f.app.pendingActions=1;await settle();
 expect(text(root)).toContain(copy);const add=all(root).find(n=>n.type==='button'&&text(n).includes('加入房间 ·'));expect(add.props.disabled).toBe(true);
 await add.props.onClick();expect(f.add).not.toHaveBeenCalled();
});

it('clears and restores all loaded selection without losing songs, then batches without playing',async()=>{
 const root=await mount();await importPlaylist(root,'https://music.163.com/album/38306');
 all(root).find(n=>n.type==='button'&&text(n)==='取消选择').props.onClick();await settle();expect(text(root)).toContain('已选 0 首');
 const select=all(root).find(n=>n.props.class==='library-selection');all(select).find(n=>n.type==='input').props.onChange();await settle();expect(text(root)).toContain('已选 1 首');
 await all(root).find(n=>n.type==='button'&&text(n).includes('加入房间 ·')).props.onClick();await settle();expect(f.add).toHaveBeenCalledOnce();expect(f.play).not.toHaveBeenCalled();expect(text(root)).toContain('已选 0 首');
});

it('keeps explicit immediate playback separate from batch enqueue and still adds later selected songs',async()=>{
 f.album.mockResolvedValueOnce({collection:{kind:'album',id:'38306',name:'专辑',trackCount:2},songs:[{id:'1',name:'歌曲1'},{id:'2',name:'歌曲2'}]});
 f.play.mockImplementationOnce(async()=>{f.app.room.pending={};});
 const root=await mount();await importPlaylist(root,'https://music.163.com/album/38306');
 await all(root).find(n=>n.type==='button'&&text(n)==='立即播放').props.onClick();await settle();expect(f.add).toHaveBeenCalledTimes(2);expect(f.play).toHaveBeenCalledOnce();
});

it('preserves selection on failures, reuses the idempotency key on retry and enforces room capacity',async()=>{
 const root=await mount();await importPlaylist(root,'https://music.163.com/album/38306');f.app.room.playlist=Array(200).fill({});
 let button=all(root).find(n=>n.type==='button'&&text(n).includes('加入房间 ·'));await button.props.onClick();await settle();expect(f.add).not.toHaveBeenCalled();expect(text(root)).toContain('房间最多 200 首');
 f.app.room.playlist=[];f.add.mockRejectedValueOnce(Error('TEMPORARY_FAILURE'));await button.props.onClick();await settle();expect(text(root)).toContain('已选 1 首');
 const key=f.add.mock.calls[0][2];button=all(root).find(n=>n.type==='button'&&text(n).includes('加入房间 ·'));await button.props.onClick();await settle();expect(f.add.mock.calls[1][2]).toBe(key);expect(text(root)).toContain('已选 0 首');
});

it('inherits the theme accent instead of forcing a separate blue palette',()=>{
 const {descriptor}=parse(readFileSync(new URL('../src/views/Playlists.vue',import.meta.url),'utf8')),css=descriptor.styles[0].content;
 expect(css).not.toMatch(/--accent\s*:/);expect(css).not.toMatch(/#(?:4f80db|4272c9|edf3fa|edf3fc|b8cdec|91aacd)\b/i);
 expect(css).toContain('background:var(--accent)');expect(css).toContain('color-mix(in srgb,var(--accent) 10%,white)');expect(css).toContain('border-color:color-mix(in srgb,var(--accent)');
});

it('bounds the card reveal delay and changes the tab indicator without delaying requests',async()=>{
 f.favorites.mockResolvedValueOnce(Array.from({length:12},(_,i)=>({kind:'playlist',id:String(i+1),name:`歌单${i}`})));
 const root=await mount();all(root).find(n=>n.props.role==='tab'&&text(n)==='已收藏').props.onClick();await settle();
 const cards=all(root).filter(n=>n.props.class==='music-collection-card');expect(cards.map(n=>n.props.style['--library-index'])).toEqual([0,1,2,3,4,5,6,7,7,7,7,7]);
 const tabs=all(root).find(n=>n.props.role==='tablist');expect(tabs.props.class).toContain('favorites-active');
 const pending=all(root).find(n=>n.props['aria-label']==='打开歌单 歌单0').props.onClick();expect(f.detail).toHaveBeenCalledWith('1');await pending;await settle();
 const list=all(root).find(n=>n.props['aria-label']==='歌单歌曲列表');all(list).find(n=>n.type==='input').props.onChange();await settle();
 expect(all(root).find(n=>n.props['aria-label']==='歌单歌曲列表')).toBe(list);expect(f.detail).toHaveBeenCalledOnce();
});

it('keeps motion finite and cancels it for reduced-motion without losing the selected-tab position',()=>{
 const {descriptor}=parse(readFileSync(new URL('../src/views/Playlists.vue',import.meta.url),'utf8')),css=descriptor.styles[0].content;
 for(const name of ['library-content-in','library-heart-pop','library-count-in'])expect(css).toContain(`@keyframes ${name}`);
 expect(css).toContain('var(--motion-normal) var(--motion-ease)');expect(css).toContain('var(--library-index,0)*18ms');expect(css).not.toContain('infinite');
 const reduce=css.slice(css.lastIndexOf('@media(prefers-reduced-motion:reduce)'));
 expect(reduce).toContain('animation:none!important;transition:none!important');expect(reduce).not.toContain('.collection-tabs.favorites-active::before');expect(reduce).toContain('transform:none');
 expect(css).toContain('.collection-tabs.favorites-active::before{transform:translateX(calc(100% + 4px))}');
});
