import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';
import { all, node, renderer, text } from './helpers/vue-host';
import SimilarRecommendations from '../src/components/SimilarRecommendations.vue';
const f=vi.hoisted(()=>({app:null as any,similar:vi.fn(),metadata:vi.fn(),add:vi.fn()}));
vi.mock('../src/store',()=>({useApp:()=>f.app}));
vi.mock('../src/bridge',()=>({similarMusic:f.similar,trackMetadata:f.metadata,addSearchedMusic:f.add}));
const song=(id:string)=>({id,name:`推荐${id}`,artists:'歌手',album:'专辑',coverUrl:'',durationMs:100000});
let mounted:ReturnType<typeof renderer.createApp>;
const settle=async()=>{for(let i=0;i<8;i++){await Promise.resolve();await nextTick();}};
async function mount(){const root=node('root');mounted=renderer.createApp(SimilarRecommendations);mounted.mount(root);await settle();return root;}
const addButton=(root:any)=>all(root).find(n=>n.props['aria-label']==='加入播放列表 推荐2');
beforeEach(()=>{
 f.app=reactive({room:{id:'room',playlist:[{id:'track',neteaseId:'1',name:'当前歌曲'},{id:'queued',neteaseId:'3',name:'已有歌曲'}],playback:{sourceId:'track'}},connected:true,permission:{enqueue:true},notice:'',error:vi.fn()});
 f.similar.mockReset().mockResolvedValue([song('2'),song('3')]);f.metadata.mockReset().mockResolvedValue({neteaseId:'1'});f.add.mockReset().mockResolvedValue({id:'added'});
});
afterEach(()=>mounted?.unmount());
it('uses current song recommendations instead of queue items, and does not reload on ordinary snapshots',async()=>{
 const root=await mount();expect(text(root)).toContain('相似推荐');expect(text(root)).toContain('推荐2');expect(text(root)).not.toContain('推荐3');
 expect(f.similar).toHaveBeenCalledWith('1',expect.any(AbortSignal));
 f.app.room=JSON.parse(JSON.stringify(f.app.room));await settle();expect(f.similar).toHaveBeenCalledOnce();
 await addButton(root).props.onClick();await settle();
 expect(f.add).toHaveBeenCalledWith('room','2',expect.any(String),'');expect(f.app.notice).toContain('加入播放列表');
 expect(all(root).find(n=>n.props['aria-label']==='已添加 推荐2').props.disabled).toBe(true);
});
it('cancels old requests and does not display stale recommendations after switching tracks',async()=>{
 let finish!:(value:any)=>void;f.similar.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const root=await mount(),oldSignal=f.similar.mock.calls[0][1];
 f.similar.mockResolvedValueOnce([song('4')]);f.app.room.playback.sourceId='queued';await settle();
 expect(oldSignal.aborted).toBe(true);finish([song('2')]);await settle();
 expect(text(root)).toContain('推荐4');expect(text(root)).not.toContain('推荐2');
});
it('handles no playback, missing identity, API failure and retry without fake results',async()=>{
 f.app.room.playback.sourceId=null;const root=await mount();expect(f.similar).not.toHaveBeenCalled();expect(text(root)).toContain('播放一首歌');
 f.app.room.playlist[0].neteaseId=undefined;f.metadata.mockResolvedValueOnce({});f.app.room.playback.sourceId='track';await settle();expect(text(root)).toContain('暂无可用');
 f.similar.mockRejectedValueOnce(Error('NETEASE_UNAVAILABLE'));await all(root).find(n=>n.props['aria-label']==='刷新相似推荐').props.onClick();await settle();expect(text(root)).toContain('请重试');
 await all(root).find(n=>n.props['aria-label']==='刷新相似推荐').props.onClick();await settle();expect(text(root)).toContain('推荐2');
});
it('respects enqueue permission and reuses an add request ID after an unconfirmed failure',async()=>{
 const root=await mount();f.app.permission.enqueue=false;await settle();expect(addButton(root).props.disabled).toBe(true);
 await addButton(root).props.onClick();expect(f.add).not.toHaveBeenCalled();
 f.app.permission.enqueue=true;f.add.mockRejectedValueOnce(Error('timeout'));await addButton(root).props.onClick();await settle();await addButton(root).props.onClick();
 expect(f.add.mock.calls[0][2]).toBe(f.add.mock.calls[1][2]);expect(f.app.error).toHaveBeenCalledOnce();
});
