import { onScopeDispose, ref, watch, type Ref } from 'vue';
import { suggestMusic } from './bridge';
export function useMusicSuggestions(keywords:Ref<string>,enabled:Ref<boolean>,load=suggestMusic) {
 const items=ref<string[]>([]),loading=ref(false),active=ref(-1),error=ref(''),loaded=ref(false);
 let generation=0,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
 function dismiss(){generation++;clearTimeout(timer);controller?.abort();items.value=[];loading.value=false;active.value=-1;error.value='';loaded.value=false;}
 watch([keywords,enabled],([text,allowed])=>{
  dismiss();const term=text.trim();if(!allowed||!term)return;
  const current=generation;
  timer=setTimeout(async()=>{
   controller=new AbortController();loading.value=true;
   try{const result=await load(term,controller.signal);if(current===generation){items.value=result;active.value=-1;loaded.value=true;}}
   catch(e){if(current===generation){const code=e instanceof Error?e.message:'';error.value=code==='NETEASE_METHOD_NOT_ALLOWED'?'服务端尚未启用联想接口，请重启服务端':code==='UNAUTHORIZED'||code==='SESSION_EXPIRED'?'登录已失效，请重新登录':code==='RATE_LIMITED'?'联想请求过于频繁，请稍后重试':'联想暂不可用，可按回车搜索';}}
   finally{if(current===generation)loading.value=false;}
  },300);
 },{flush:'sync'});
 onScopeDispose(dismiss);
 return {items,loading,active,error,loaded,dismiss};
}
