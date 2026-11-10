<script setup lang="ts">
import { nextTick,onActivated,onDeactivated,onUnmounted,ref,type Component,type VNode } from 'vue';
defineOptions({name:'CachedMusicPage'});
defineProps<{view:Component|VNode}>();
const root=ref<HTMLElement|null>(null);
const positions=new Map<HTMLElement,{top:number;left:number}>();
let active=true,activation=0;
// Detached KeepAlive DOM may lose native scroll offsets; capture every local scrollport.
function rememberScroll(event:Event){
 if(!active||!root.value)return;const element=event.target as HTMLElement;
 for(const saved of positions.keys())if(!root.value.contains(saved))positions.delete(saved);
 if(element&&root.value.contains(element))positions.set(element,{top:element.scrollTop,left:element.scrollLeft});
}
onActivated(()=>{
 const gen=++activation;active=false;
 void nextTick(()=>{if(gen!==activation||!root.value)return;
  for(const [element,position] of positions){
   if(root.value.contains(element)){element.scrollTop=position.top;element.scrollLeft=position.left;}
   else positions.delete(element);
  }
  active=true;
 });
});
onDeactivated(()=>{active=false;activation++;});
onUnmounted(()=>positions.clear());
</script>
<template><div ref="root" class="route-page" @scroll.capture="rememberScroll"><component :is="view" /></div></template>
