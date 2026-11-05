import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useCachedActivity } from './useCachedActivity';

/** Hidden/minimized windows must not keep GPU frames or screen timers running. */
export function useStageActivity(resume=()=>{},pause=()=>{}){
 const cached=useCachedActivity();
 const visible=ref(document.visibilityState!=='hidden');
 const active=computed(()=>cached.value&&visible.value);
 const update=()=>{visible.value=document.visibilityState!=='hidden';};
 watch(active,value=>{if(value)resume();else pause();},{flush:'sync'});
 onMounted(()=>{document.addEventListener('visibilitychange',update);update();});
 onBeforeUnmount(()=>document.removeEventListener('visibilitychange',update));
 return active;
}
