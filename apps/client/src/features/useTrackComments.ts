import { computed, onScopeDispose, ref, watch, type InjectionKey, type Ref } from 'vue';
import type { SongComment, SongCommentsPage } from '@music-share/shared';

type FetchPage = (roomId:string, trackId:string, offset:number, signal:AbortSignal) => Promise<SongCommentsPage>;
export const roomCommentsKey:InjectionKey<{state:ReturnType<typeof useTrackComments>;openRoom:Ref<{id:string}|null>}> =
  Symbol('room song comments');

export function useTrackComments(room:()=>string, track:()=>string|undefined, enabled:()=>boolean, fetchPage:FetchPage) {
  const hotComments=ref<SongComment[]>([]), comments=ref<SongComment[]>([]), total=ref<number|null>(null), offset=ref<number|null>(0);
  const loading=ref(false), loaded=ref(false), failed=ref(false);
  const ready=computed(()=>!!track()&&enabled());
  let pending:AbortController|undefined;

  function cancel() {
    pending?.abort();
    pending=undefined;
    loading.value=false;
  }
  async function load() {
    const id=track(), page=offset.value;
    if(!ready.value || !id || pending || page===null)return;
    const request=new AbortController();
    pending=request;loading.value=true;failed.value=false;
    try {
      const result=await fetchPage(room(),id,page,request.signal);
      if(pending!==request)return;
      if(page===0)hotComments.value=result.hotComments??[];
      const byId=new Map(comments.value.map(comment=>[comment.id,comment]));
      const previousCount=byId.size;
      for(const comment of result.comments)byId.set(comment.id,comment);
      comments.value=[...byId.values()];
      if(page===0||result.total!==null)total.value=result.total;
      loaded.value=true;
      // Do not chain requests if the upstream repeats an entire page.
      offset.value=byId.size>previousCount&&result.nextOffset!==null&&result.nextOffset>page?result.nextOffset:null;
    } catch {
      if(pending===request)failed.value=true;
    } finally {
      if(pending===request){pending=undefined;loading.value=false;}
    }
  }
  watch([room,track],()=>{
    cancel();hotComments.value=[];comments.value=[];total.value=null;offset.value=0;loaded.value=false;failed.value=false;
    void load();
  },{flush:'sync'});
  watch(ready,available=>{
    if(!available)cancel();
    else if(!loaded.value&&!failed.value)void load();
  },{immediate:true,flush:'sync'});
  onScopeDispose(cancel);
  function cancelPagination() { if(offset.value!==0)cancel(); }
  return {hotComments,comments,total,loading,loaded,failed,hasMore:computed(()=>loaded.value&&offset.value!==null),load,cancelPagination};
}
