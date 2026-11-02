import { computed, inject, onActivated, onBeforeUnmount, onDeactivated, ref, watch, type InjectionKey, type Ref } from 'vue';
export const CACHED_PAGE_ACTIVE:InjectionKey<Readonly<Ref<boolean>>>=Symbol('cached-page-active');
/** KeepAlive retains resources, but hidden pages must not keep rendering. */
export function useCachedActivity(resume=()=>{},pause=()=>{}){
 const parent=inject(CACHED_PAGE_ACTIVE,undefined),local=ref(true);
 const active=computed(()=>local.value&&(parent?.value??true));
 watch(active,value=>{if(value)resume();else pause();},{flush:'sync'});
 onActivated(()=>{const wasActive=active.value;local.value=true;if(wasActive&&active.value)resume();});
 onDeactivated(()=>{local.value=false;});
 onBeforeUnmount(()=>{local.value=false;});
 return active;
}
