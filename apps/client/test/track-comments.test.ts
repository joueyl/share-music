import { effectScope, ref } from 'vue';
import { expect, it, vi } from 'vitest';
import type { SongCommentsPage } from '@music-share/shared';
import { useTrackComments } from '../src/features/useTrackComments';

const comment=(id:string)=>({id,content:id,nickname:null,avatarUrl:null,time:null,likedCount:null});
const page=(id:string,nextOffset:number|null=null,hot?:string):SongCommentsPage=>({
  hotComments:hot?[comment(hot)]:[],comments:[comment(id)],total:1,nextOffset,
});

it('waits until the panel is available and rejects stale results after switching songs',async()=>{
 const scope=effectScope(),track=ref('a'),visible=ref(false);
 const pending=new Map<string,{resolve:(value:SongCommentsPage)=>void;signal:AbortSignal}>();
 const fetchPage=vi.fn((_room:string,id:string,_offset:number,signal:AbortSignal)=>new Promise<SongCommentsPage>(resolve=>pending.set(id,{resolve,signal})));
 const state=scope.run(()=>useTrackComments(()=>'room',()=>track.value,()=>visible.value,fetchPage))!;
 try{
  expect(fetchPage).not.toHaveBeenCalled();
  visible.value=true;expect(pending.has('a')).toBe(true);
  track.value='b';expect(pending.get('a')?.signal.aborted).toBe(true);
  pending.get('a')?.resolve(page('stale',null,'old-hot'));pending.get('b')?.resolve(page('current',null,'current-hot'));
  await vi.waitFor(()=>expect(state.comments.value.map(x=>x.id)).toEqual(['current']));
  expect(state.hotComments.value.map(x=>x.id)).toEqual(['current-hot']);
  track.value='c';visible.value=false;
  expect(pending.get('c')?.signal.aborted).toBe(true);
  pending.get('c')?.resolve(page('hidden'));await Promise.resolve();
  expect(state.comments.value).toEqual([]);
  expect(state.hotComments.value).toEqual([]);
 }finally{scope.stop();}
});

it('preserves loaded comments on a failed page and retries that offset without duplicates',async()=>{
 const scope=effectScope();
 const fetchPage=vi.fn(async (_room:string,_track:string,offset:number,_signal:AbortSignal)=>page(String(offset)));
 fetchPage.mockResolvedValueOnce(page('shared',20,'hot')).mockRejectedValueOnce(new Error('not available')).mockResolvedValueOnce(page('shared',40,'ignored-hot'));
 const state=scope.run(()=>useTrackComments(()=>'room',()=>'track',()=>true,fetchPage))!;
 try{
  await vi.waitFor(()=>expect(state.loaded.value).toBe(true));
  await state.load();expect(state.failed.value).toBe(true);expect(state.comments.value).toHaveLength(1);
  await state.load();expect(state.failed.value).toBe(false);expect(state.comments.value).toHaveLength(1);expect(state.hasMore.value).toBe(false);
  expect(state.hotComments.value.map(x=>x.id)).toEqual(['hot']);
  expect(fetchPage.mock.calls.map(call=>call[2])).toEqual([0,20,20]);
 }finally{scope.stop();}
});
it('keeps the open button total while cancelling pagination on undock',async()=>{
 const scope=effectScope();
 let signal:AbortSignal|undefined,finish:(value:SongCommentsPage)=>void=()=>{};
 const fetchPage=vi.fn((_room:string,_track:string,offset:number,request:AbortSignal)=>{
   if(offset===0)return Promise.resolve({...page('first',20),total:1200});
   signal=request;return new Promise<SongCommentsPage>(resolve=>{finish=resolve;});
 });
 const state=scope.run(()=>useTrackComments(()=>'room',()=>'track',()=>true,fetchPage))!;
 try{
  await vi.waitFor(()=>expect(state.total.value).toBe(1200));
  const next=state.load();state.cancelPagination();expect(signal?.aborted).toBe(true);
  finish({...page('stale'),total:3});await next;
  expect(state.comments.value.map(x=>x.id)).toEqual(['first']);
  expect(state.total.value).toBe(1200);expect(state.hasMore.value).toBe(true);
  const retry=state.load();finish({...page('second'),total:null});await retry;
  expect(state.total.value).toBe(1200);
 }finally{scope.stop();}
});
