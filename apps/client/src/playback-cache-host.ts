import { defineComponent,h,type Component,type PropType,type VNode } from 'vue';
import CachedPlaybackPage from './components/CachedPlaybackPage.vue';
let nextScopeId=0;
/** A distinct name per room scope lets KeepAlive prune only stale playback,
 * without clearing the independently cached music page or adding DOM wrappers. */
export function createPlaybackCacheHost(scope:string){
 return defineComponent({
  name:'CachedPlaybackScope'+(++nextScopeId)+'_'+scope.replace(/[^a-zA-Z0-9_-]/g,'_'),
  props:{view:{type:[Object,Function] as PropType<Component|VNode>,required:true}},
  setup(props){return ()=>h(CachedPlaybackPage,{view:props.view});},
 });
}
