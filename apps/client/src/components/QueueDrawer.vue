<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { X, Plus, Play, ArrowUp, ArrowDown, Trash2, GripVertical, AudioLines, Ellipsis } from 'lucide-vue-next';
import { PLAYBACK_MODE_LABELS } from '@music-share/shared';
import { usePlaybackMode } from '../usePlaybackMode';
import Sortable from 'sortablejs';
import { useApp } from '../store';
import { openSearch } from '../ui';
import { useDialogFocus } from '../useDialogFocus';
import * as bridge from '../bridge';
import AlbumArt from './AlbumArt.vue';
import FavoriteSongsList from './FavoriteSongsList.vue';
import SongFavoriteButton from './SongFavoriteButton.vue';
const playbackMode=usePlaybackMode();
const props=defineProps<{open?:boolean;swipeDismiss?:boolean}>();
const app=useApp(),emit=defineEmits<{close:[]}>(),dialog=ref<HTMLElement|null>(null),tab=ref<'queue'|'history'|'favorites'>('queue');
const visible=ref(true);
const sheetOffset=ref(0),sheetDragging=ref(false);
let sheetPointer:{id:number;x:number;y:number;time:number;target:HTMLElement;axis?:'down'|'ignored'}|null=null;
let ignoreBackdropUntil=0;
let searchAfterClose=false;
function close(){releaseSheetPointer();cancelDrag();visible.value=false;}
function startSheetSwipe(event:PointerEvent){
 const target=event.target as Element|null, panel=event.currentTarget as HTMLElement;
 if(!props.swipeDismiss||!visible.value||sheetPointer||gesture||!event.isPrimary||event.button!==0||
    panel.parentElement?.classList.contains('drawer-enter-active')||
    !target?.closest('.queue-sheet-grip,.drawer-heading')||
    target.closest('button,a,input,select,textarea,summary'))return;
 panel.setPointerCapture(event.pointerId);
 sheetPointer={id:event.pointerId,x:event.clientX,y:event.clientY,time:event.timeStamp,target:panel};
 sheetDragging.value=true;
 event.preventDefault();
}
function sheetDistance(event:PointerEvent){
 const pointer=sheetPointer;
 if(!pointer||pointer.id!==event.pointerId)return 0;
 const dy=event.clientY-pointer.y, dx=Math.abs(event.clientX-pointer.x);
 if(!pointer.axis&&Math.max(Math.abs(dy),dx)>=6)pointer.axis=dy>dx?'down':'ignored';
 return pointer.axis==='down'?Math.max(0,dy):0;
}
function moveSheetSwipe(event:PointerEvent){
 if(sheetPointer?.id===event.pointerId)sheetOffset.value=sheetDistance(event);
}
function releaseSheetPointer(){
 const pointer=sheetPointer;
 sheetPointer=null;sheetDragging.value=false;
 if(pointer?.target.hasPointerCapture(pointer.id))pointer.target.releasePointerCapture(pointer.id);
}
function endSheetSwipe(event:PointerEvent){
 const pointer=sheetPointer;
 if(!pointer||pointer.id!==event.pointerId)return;
 const distance=sheetDistance(event);
 const limit=Math.min(112,Math.max(64,pointer.target.offsetHeight*.2));
 const quick=distance>=36&&distance/Math.max(1,event.timeStamp-pointer.time)>=.65;
 if(distance>=limit||quick){sheetOffset.value=distance;close();return;}
 cancelSheetSwipe(event);
}
function cancelSheetSwipe(event:PointerEvent){
 if(sheetPointer?.id!==event.pointerId)return;
 releaseSheetPointer();sheetOffset.value=0;
}
function backdropClose(){if(gesture||Date.now()<ignoreBackdropUntil)return;close();}
function outsideClose(event:MouseEvent){
 const target=event.target as Element|null;
 if(!visible.value||!target||dialog.value?.contains(target))return;
 // The player toggle owns its click; closing here would make it reopen the drawer.
 if(target.closest?.('.queue-trigger'))return;
 backdropClose();
}
function afterLeave(){emit('close');if(searchAfterClose)openSearch();}
useDialogFocus(dialog,close,'.queue-trigger:not([inert])');
watch(()=>props.open,value=>{if(value===false)close();else if(value){sheetOffset.value=0;visible.value=true;}});
function closeMenus(event:MouseEvent){
 const target=event.target as Element|null;
 for(const menu of dialog.value?.querySelectorAll<HTMLDetailsElement>('.queue-more[open]')??[]){
  if(!target||!menu.contains(target))menu.open=false;
 }
}
onMounted(()=>{document.addEventListener('click',closeMenus);document.addEventListener('click',outsideClose,true);});
onUnmounted(()=>{releaseSheetPointer();document.removeEventListener('click',closeMenus);document.removeEventListener('click',outsideClose,true);});
const current=computed(()=>app.room?.playlist.find(t=>t.id===app.room?.playback.sourceId));
const scroll=ref<HTMLElement|null>(null),dragging=ref(''),sorting=ref(false),playing=ref(false);
const queue=computed(()=>app.room?.playlist??[]);
const blocked=computed(()=>!app.connected||!!app.room?.pending);
const canReorder=computed(()=>app.permission.enqueue&&!blocked.value&&!sorting.value&&!app.pendingActions&&visible.value&&tab.value==='queue');
const canPlay=computed(()=>app.permission.skip&&!blocked.value&&!sorting.value&&!playing.value&&!app.pendingActions&&!dragging.value&&visible.value);
let sortable:Sortable|null=null;
let gesture:{ids:string[];version:number;roomId:string;item:HTMLElement}|null=null;
const sortableEpoch=ref(0);
function cancelDrag(rebuild=true){
 const instance=sortable,previous=gesture;sortable=null;gesture=null;
 if(previous){
  ignoreBackdropUntil=Date.now()+500;
  // Sortable.destroy() removes listeners/timers but its event-less drop leaves fallback DOM.
  // Remove only this gesture's transient nodes before restoring the Vue-owned children.
  if(Sortable.dragged===previous.item){Sortable.ghost?.remove();Sortable.clone?.remove();}
  previous.item.classList.remove('is-dragging','sortable-chosen','sortable-drag');
  previous.item.style.willChange='';previous.item.style.transform='';
  instance?.sort(previous.ids);
 }
 dragging.value='';instance?.destroy();if(rebuild)sortableEpoch.value++;
}
function validGesture(){return !!gesture&&canReorder.value&&app.room?.id===gesture.roomId&&app.room.stateVersion===gesture.version;}
function setupSortable(){
 cancelDrag(false);
 if(!scroll.value||!canReorder.value)return;
 const instance:Sortable=sortable=new Sortable(scroll.value,{
  draggable:'.queue-row',handle:'.queue-drag-handle',dataIdAttr:'data-track-id',
  // WKWebView uses the same mouse/touch fallback as the other platforms, not native HTML5 DnD.
  forceFallback:true,fallbackTolerance:6,fallbackOnBody:false,
  animation:0,ghostClass:'is-dragging',fallbackClass:'queue-drag-preview',
  scroll:scroll.value,forceAutoScrollFallback:true,bubbleScroll:false,scrollSensitivity:40,scrollSpeed:14,
  onChoose(event){
   if(sortable!==instance||!canReorder.value||!app.room)return;
   gesture={ids:app.room.playlist.map(t=>t.id),version:app.room.stateVersion,roomId:app.room.id,item:event.item};
   event.item.querySelector<HTMLButtonElement>('.queue-drag-handle')?.focus({preventScroll:true});
  },
  onUnchoose(){if(sortable===instance&&!dragging.value)gesture=null;},
  onStart(event){if(sortable===instance&&validGesture()){dragging.value=event.item.dataset.trackId??'';ignoreBackdropUntil=Date.now()+500;}},
  onMove(){return sortable===instance&&validGesture();},
  onEnd(){
   if(sortable!==instance||!gesture)return;
   const ids=instance.toArray(),previous=gesture,valid=validGesture()&&!!dragging.value;
   // Sortable mutates DOM only during dragging. Restore Vue's order before any reactive render;
   // the authoritative playlist changes only after the existing server command is confirmed.
   instance.sort(previous.ids);gesture=null;dragging.value='';ignoreBackdropUntil=Date.now()+500;
   if(valid&&ids.length===previous.ids.length&&new Set(ids).size===ids.length&&ids.every(id=>previous.ids.includes(id)))void submitOrder(ids);
  },
 });
}
// A playback-progress snapshot replaces the room object without changing its
// stateVersion. On Android, keep the drag alive across these routine updates;
// only cancel before a real queue revision or loss of the ability to reorder.
const dragInputs=[()=>app.room?.id,()=>app.room?.stateVersion,canReorder,tab] as const;
if(props.swipeDismiss)watch(dragInputs,()=>cancelDrag());
else watch(()=>[app.room?.id,app.room?.stateVersion,canReorder.value,tab.value],()=>cancelDrag());
watch([scroll,sortableEpoch],setupSortable,{flush:'post'});
function cancelPointer(){if(gesture)cancelDrag();}
onMounted(()=>document.addEventListener('pointercancel',cancelPointer,true));
onUnmounted(()=>{document.removeEventListener('pointercancel',cancelPointer,true);cancelDrag();});
async function submitOrder(ids:string[]){
 if(!canReorder.value||!app.room||ids.join()===app.room.playlist.map(t=>t.id).join())return;
 sorting.value=true;try{await app.act({type:'reorder',payload:{trackIds:ids}});}finally{sorting.value=false;}
}
const format=(ms:number)=>`${Math.floor(ms/60000).toString().padStart(2,'0')}:${Math.floor(ms/1000%60).toString().padStart(2,'0')}`;
function move(id:string,delta:number){if(gesture||!canReorder.value||!app.room)return;const ids=app.room.playlist.map(t=>t.id),index=ids.indexOf(id),target=index+delta;if(index<0||target<0||target>=ids.length)return;[ids[index],ids[target]]=[ids[target]!,ids[index]!];void submitOrder(ids);}
async function play(id:string){
 if(!canPlay.value||gesture||Date.now()<ignoreBackdropUntil||!app.room)return;
 const item=app.room.playlist.find(track=>track.id===id);if(!item?.available)return;
 const active=app.room.playback.sourceId===id;
 if(active&&app.room.playback.playState!=='paused')return;
 playing.value=true;
 try{await app.act(active?{type:'resume',payload:{}}:{type:'play',payload:{trackId:id}});}
 finally{playing.value=false;}
}
function playFromRow(event:MouseEvent,id:string){
 const target=event.target as Element|null;
 if(target?.closest?.('button,details,summary,a,input,select,textarea,[role="button"]'))return;
 event.preventDefault();void play(id);
}
async function clear(){if(!canReorder.value||!queue.value.some(t=>t.id!==current.value?.id))return;sorting.value=true;try{await app.act({type:'clear',payload:{}});}finally{sorting.value=false;}}
async function remove(id:string){if(!canReorder.value||id===current.value?.id)return;sorting.value=true;try{await app.act({type:'remove',payload:{trackId:id}});}finally{sorting.value=false;}}
function add(){searchAfterClose=true;close();}
</script>
<template><Teleport to="#app"><Transition name="drawer" appear @after-leave="afterLeave"><div v-if="visible" class="drawer-backdrop" @click.self="backdropClose"><aside ref="dialog" class="queue-drawer" :class="{'is-sheet-dragging':sheetDragging,'has-sheet-offset':sheetOffset>0}" :data-swipe-dismiss="swipeDismiss||undefined" :style="sheetOffset>0?{'--queue-sheet-offset':sheetOffset+'px'}:undefined" role="dialog" aria-modal="true" aria-label="共享播放列表" @pointerdown="startSheetSwipe" @pointermove="moveSheetSwipe" @pointerup="endSheetSwipe" @pointercancel="cancelSheetSwipe" @lostpointercapture="cancelSheetSwipe">
 <div v-if="swipeDismiss" class="queue-sheet-grip" aria-hidden="true"></div>
 <header class="drawer-heading"><div><h2>共享播放列表</h2><p>{{ app.room?.playlist.length??0 }} 首歌曲 · {{ app.room?.members.filter(m=>m.online).length??0 }} 人共同添加</p></div><button class="round-close" aria-label="关闭播放列表" @click="close"><X :size="20" /></button></header>
 <label v-if="!swipeDismiss" class="queue-mode"><span>播放模式</span><select class="tone-select" aria-label="房间播放模式" :value="playbackMode.mode.value??''" :disabled="playbackMode.disabled.value" @change="playbackMode.change(($event.target as HTMLSelectElement).value)"><option v-if="!playbackMode.mode.value" value="">请更新服务端</option><option v-for="(label,mode) in PLAYBACK_MODE_LABELS" :key="mode" :value="mode">{{ label }}</option></select></label>
 <div class="queue-tabs" role="tablist" aria-label="播放列表分类"><button role="tab" :aria-selected="tab==='queue'" :class="{active:tab==='queue'}" @click="tab='queue'">当前队列</button><button role="tab" :aria-selected="tab==='history'" :class="{active:tab==='history'}" @click="tab='history'">已播放</button><button role="tab" :aria-selected="tab==='favorites'" :class="{active:tab==='favorites'}" @click="tab='favorites'">收藏单曲</button><button v-if="app.permission.enqueue&&tab==='queue'" class="queue-clear" :disabled="!canReorder||!queue.some(t=>t.id!==current?.id)" title="保留当前歌曲，清空其他歌曲" @click="clear">清空</button></div>
 <div v-if="tab==='history'" class="empty-state queue-history">当前 API 未提供播放历史，暂时无法查看。</div>
 <FavoriteSongsList v-else-if="tab==='favorites'" />
 <template v-else>
 <div v-if="!swipeDismiss" class="queue-next-heading"><strong>播放顺序 <small>{{ queue.length }}</small></strong><span id="queue-sort-hint">{{ app.permission.enqueue?'拖动手柄排序 · Alt+↑↓ 微调':'需要播放列表控制权限' }}</span></div>
 <div ref="scroll" class="queue-scroll" tabindex="0" aria-label="播放队列" :aria-busy="sorting">
  <div v-for="(item,i) in queue" :key="item.id" class="queue-row" :class="{'is-playing':item.id===current?.id}" :data-track-id="item.id" :aria-current="swipeDismiss&&item.id===current?.id?'true':undefined" @dblclick="playFromRow($event,item.id)">
   <button v-if="app.permission.enqueue" type="button" class="queue-drag-handle" @dblclick.stop :disabled="!canReorder" :aria-label="`拖动调整 ${item.name} 的顺序`" :aria-describedby="swipeDismiss?undefined:'queue-sort-hint'" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" @keydown.alt.up.prevent="move(item.id,-1)" @keydown.alt.down.prevent="move(item.id,1)"><GripVertical :size="16" /></button>
   <span class="queue-index">{{ (i+1).toString().padStart(2,'0') }}</span><AlbumArt :src="bridge.playingTrackCover(item)" :draggable="false" /><span class="queue-track"><strong>{{ item.name }}</strong><small>{{ item.artists||'未知歌手' }}<template v-if="item.id!==current?.id"> · {{ app.room?.members.find(m=>m.id===item.providerId)?.name??'成员' }}添加</template><template v-else-if="!swipeDismiss"> · 正在播放</template></small></span><time>{{ format(item.durationMs) }}</time>
   <div class="track-actions" @dblclick.stop><SongFavoriteButton :source="bridge.favoriteTrackReference(item)?.source" :song-id="bridge.favoriteTrackReference(item)?.id" :name="item.name" /><AudioLines v-if="!swipeDismiss&&item.id===current?.id" class="queue-playing-icon" :size="16" /><button v-else-if="item.id!==current?.id" class="icon-button" aria-label="播放此曲" :disabled="!canPlay||!item.available" @click="play(item.id)"><Play :size="15" /></button><details v-if="app.permission.enqueue" class="queue-more"><summary aria-label="歌曲操作"><Ellipsis v-if="swipeDismiss" :size="16" aria-hidden="true" /><template v-else>···</template></summary><div><button v-if="app.permission.enqueue" :disabled="!canReorder||i===0" aria-label="上移" @click="move(item.id,-1)"><ArrowUp :size="14" />上移</button><button v-if="app.permission.enqueue" :disabled="!canReorder||i===queue.length-1" aria-label="下移" @click="move(item.id,1)"><ArrowDown :size="14" />下移</button><button v-if="app.permission.enqueue" aria-label="移除音轨" :disabled="!canReorder||item.id===current?.id||!!dragging" @click="remove(item.id)"><Trash2 :size="14" />移除</button></div></details></div>
  </div>
  <div v-if="!queue.length" class="empty-state compact">把喜欢的歌，加入共同的列表</div>
 </div></template>
 <footer class="queue-footer"><button class="primary" :disabled="!app.permission.enqueue||!app.connected" @click="add"><Plus :size="18" />添加歌曲到共享列表</button></footer>
 </aside></div></Transition></Teleport></template>

<style scoped>
/* Inherit window geometry outside the inert shell; clip only the window edge. */
.drawer-backdrop{clip-path:inset(0 round var(--window-corner-radius,20px) var(--window-corner-radius,20px) 0 0)}
.queue-drawer{border-top-right-radius:var(--window-corner-radius,20px)}
.queue-mode{display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:12px;margin:10px 0 0;font-size:12px}
.queue-mode .tone-select{width:152px;white-space:nowrap}
.queue-mode option{white-space:nowrap}
.queue-drawer{width:min(560px,100vw);min-height:0;padding:18px 20px 0;gap:0}
.queue-drawer>*:not(.queue-scroll){flex-shrink:0}
.drawer-heading h2{font-size:20px;line-height:28px;margin-bottom:3px}
.drawer-heading p{font-size:10px;line-height:16px}
.queue-tabs{height:40px;gap:22px;margin-top:10px}
.queue-tabs>button{height:40px;font-size:12px;padding:8px 0}
.queue-next-heading{height:24px;margin:10px 0 6px;flex-shrink:0;gap:12px}
.queue-next-heading>span{min-width:0;text-align:right;line-height:1.5}
.queue-scroll{flex:1;min-height:0;padding-bottom:8px;scrollbar-gutter:stable;overscroll-behavior:contain;overflow-anchor:none}
.queue-scroll{--queue-scroll-thumb:#b8c7d9;scrollbar-width:thin;scrollbar-color:var(--queue-scroll-thumb) transparent}
.queue-scroll:hover,.queue-scroll:focus-within{--queue-scroll-thumb:#91a9c7}
@supports selector(::-webkit-scrollbar){
 .queue-scroll{scrollbar-width:auto;scrollbar-color:auto}
 .queue-scroll::-webkit-scrollbar{width:8px;height:8px}
 .queue-scroll::-webkit-scrollbar-track{background:transparent;margin-block:6px}
 .queue-scroll::-webkit-scrollbar-thumb{background:var(--queue-scroll-thumb);border:2px solid transparent;border-radius:999px;background-clip:padding-box;min-height:32px}
 .queue-scroll::-webkit-scrollbar-thumb:hover{background-color:#7899c3}
 .queue-scroll::-webkit-scrollbar-thumb:active{background-color:#5dbb00}
 .queue-scroll::-webkit-scrollbar-button{display:none;width:0;height:0}
 .queue-scroll::-webkit-scrollbar-corner{background:transparent}
}
@media(forced-colors:active){
 .queue-scroll{scrollbar-color:auto;--queue-scroll-thumb:ButtonText}
 .queue-scroll::-webkit-scrollbar-thumb:hover,.queue-scroll::-webkit-scrollbar-thumb:active{background-color:Highlight}
}
.queue-row{min-height:54px;padding:6px 4px;gap:8px;border:1px solid transparent}
.queue-row .album-art{width:36px;height:36px}
.queue-track small{margin-top:4px}
.queue-row.is-playing{background:#eef8e5}
.queue-row.is-playing .queue-track strong,.queue-playing-icon{color:var(--accent)}
.queue-playing-icon{margin:0 8px}
.queue-drag-handle{display:grid;place-items:center;width:26px;min-width:26px;height:36px;padding:0;background:transparent;color:#9cacbf;touch-action:none;cursor:grab;user-select:none}
.queue-drag-handle:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;border-radius:6px}
.queue-drag-handle:disabled{cursor:default;opacity:.4}
.queue-row.is-dragging{opacity:.55;background:#e6effd;border-color:#a8c1e8}
.queue-row.is-dragging .queue-drag-handle{cursor:grabbing}
.queue-row.queue-drag-preview{opacity:.95;background:var(--surface,#fff);box-shadow:0 8px 24px #42629630;pointer-events:none}
.queue-footer{padding:10px 0 12px}
.queue-footer .primary{height:38px;min-height:38px;font-size:12px}
@media(max-height:500px){
 .queue-drawer{overflow-y:auto}
 .queue-scroll{flex-shrink:0;min-height:80px}
}
@media(max-width:600px){
 .queue-drawer{width:100%;top:0;padding:16px 12px 0}
 .drawer-heading h2{font-size:18px}
 .queue-tabs{gap:18px;margin-top:6px}
 .queue-tabs small{display:none}
 .queue-next-heading{margin-top:6px}
 .queue-next-heading>span{font-size:9px}
 .queue-row{gap:6px;min-height:56px}
 .queue-row time{font-size:9px}
 .queue-drag-handle{width:28px;min-width:28px;height:44px}
 .queue-footer .primary{min-height:44px}
}

@media(max-width:720px),(max-width:900px) and (pointer:coarse){
 .drawer-backdrop{bottom:var(--workspace-player);background:#28344833;clip-path:none;display:flex;align-items:flex-end}
 .queue-drawer{position:relative;inset:auto;width:100%;height:min(654px,calc(100dvh - var(--workspace-player) - 12px));max-height:100%;padding:16px 12px 0;border-radius:28px 28px 0 0;background:#f6f8fc;border:1px solid white;display:flex;flex-direction:column;overflow:visible}
 .queue-drawer::before{content:"";width:40px;height:4px;background:#c8d4e3;border-radius:4px;align-self:center;margin:-6px 0 10px;flex-shrink:0}
 .drawer-heading h2{font-size:20px;line-height:1.5}
 .drawer-heading p{font-size:12px;line-height:1.6}
 .round-close{width:44px;height:44px;min-width:44px;min-height:44px}
 .queue-tabs{gap:14px;min-height:44px;height:auto;flex-wrap:wrap}
 .queue-tabs>button{font-size:13px;min-height:44px;height:auto}
 .queue-tabs>button.active{color:var(--accent);border-bottom-color:var(--accent)}
 .queue-tabs>button.active::after{background:var(--accent)}
 .queue-next-heading{height:auto;min-height:36px;margin:8px 0}
 .queue-next-heading>span{font-size:11px}
 .queue-row{min-height:72px;padding:8px 2px;gap:6px;border-radius:16px}
 .queue-row.is-playing{background:#e7effc}
 .queue-index,.queue-row time{display:none}
 .queue-row .album-art{width:40px;height:40px;flex:0 0 40px;border-radius:12px}
 .queue-track{min-width:0;flex:1}
 .queue-track strong{font-size:14px;line-height:1.5}
 .queue-track small{font-size:11px;line-height:1.5}
 .queue-drag-handle{width:44px;min-width:44px;height:44px}
 .queue-row .track-actions{display:flex;flex:0 0 auto;grid-column:auto;gap:0}
 .queue-row .icon-button,.queue-more>summary{width:44px;min-width:44px;min-height:44px;height:44px;display:grid;place-items:center}
 .queue-playing-icon{margin:0 4px}
 .queue-footer{padding:10px 0 12px}
 .queue-footer .primary{min-height:48px;height:auto;border-radius:16px;font-size:14px}
 .queue-scroll{min-height:0;flex:1;flex-shrink:1;overflow:auto}
 .queue-drawer>:deep(.favorite-songs){flex:1;min-height:0;overflow:auto}
}

</style>
