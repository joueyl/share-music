<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { X, Plus, Play, ArrowUp, ArrowDown, Trash2, GripVertical, AudioLines } from 'lucide-vue-next';
import { moveQueueTrack } from '../queue-order';
import { useApp } from '../store';
import { openSearch } from '../ui';
import { useDialogFocus } from '../useDialogFocus';
import * as bridge from '../bridge';
import AlbumArt from './AlbumArt.vue';
const app=useApp(),emit=defineEmits<{close:[]}>(),dialog=ref<HTMLElement|null>(null),tab=ref<'queue'|'history'>('queue');
const visible=ref(true);
let ignoreBackdropUntil=0;
let searchAfterClose=false;
function close(){cancelDrag();visible.value=false;}
function backdropClose(){if(gesture||Date.now()<ignoreBackdropUntil)return;close();}
function afterLeave(){emit('close');if(searchAfterClose)openSearch();}
useDialogFocus(dialog,close);
const current=computed(()=>app.room?.playlist.find(t=>t.id===app.room?.playback.sourceId));
const scroll=ref<HTMLElement|null>(null),draft=ref<string[]>([]),dragging=ref(''),dropTarget=ref(''),sorting=ref(false),playing=ref(false);
const queue=computed(()=>{const tracks=app.room?.playlist??[];return draft.value.length?draft.value.map(id=>tracks.find(t=>t.id===id)).filter((t):t is typeof tracks[number]=>!!t):tracks;});
const blocked=computed(()=>!app.connected||!!app.room?.pending);
const canReorder=computed(()=>app.host&&!blocked.value&&!sorting.value&&!app.pendingActions);
const canPlay=computed(()=>app.permission.skip&&!blocked.value&&!sorting.value&&!playing.value&&!app.pendingActions&&!dragging.value&&visible.value);
let gesture:{id:string;pointer:number;y:number;version:number;roomId:string;handle:HTMLElement}|null=null;
let frame=0,lastX=0,lastY=0;
function cancelDrag(){
 const previous=gesture;gesture=null;
 if(frame)cancelAnimationFrame(frame);frame=0;
 if(previous?.handle.hasPointerCapture?.(previous.pointer))previous.handle.releasePointerCapture(previous.pointer);
 draft.value=[];dragging.value='';dropTarget.value='';
}
function validGesture(){return !!gesture&&canReorder.value&&app.room?.id===gesture.roomId&&app.room.stateVersion===gesture.version;}
function startDrag(event:PointerEvent,id:string){
 if(!canReorder.value||!app.room||event.button!==0)return;
 cancelDrag();event.preventDefault();const target=event.currentTarget as HTMLElement,handle=dialog.value??target;
 gesture={id,pointer:event.pointerId,y:event.clientY,version:app.room.stateVersion,roomId:app.room.id,handle};
 lastX=event.clientX;lastY=event.clientY;draft.value=app.room.playlist.map(t=>t.id);
 target.focus({preventScroll:true});handle.setPointerCapture?.(event.pointerId);
}
function updateTarget(){
 if(!gesture||!scroll.value)return;
 const row=document.elementFromPoint(lastX,lastY)?.closest<HTMLElement>('[data-track-id]');
 if(!row||!scroll.value.contains(row)||row.dataset.trackId===gesture.id)return;
 const id=row.dataset.trackId!;dropTarget.value=id;
 draft.value=moveQueueTrack(draft.value,gesture.id,id,lastY>row.getBoundingClientRect().top+row.getBoundingClientRect().height/2);
}
function autoScroll(){
 frame=0;if(!dragging.value||!validGesture()){cancelDrag();return;}
 const list=scroll.value;if(list){const bounds=list.getBoundingClientRect(),edge=40;
  const speed=lastY<bounds.top+edge?-Math.min(14,(bounds.top+edge-lastY)/3):lastY>bounds.bottom-edge?Math.min(14,(lastY-bounds.bottom+edge)/3):0;
  if(speed){list.scrollTop+=speed;updateTarget();}
 }
 frame=requestAnimationFrame(autoScroll);
}
function dragMove(event:PointerEvent){
 if(!gesture||event.pointerId!==gesture.pointer)return;
 if(!validGesture()){cancelDrag();return;}
 lastX=event.clientX;lastY=event.clientY;
 if(!dragging.value&&Math.abs(lastY-gesture.y)<6)return;
 event.preventDefault();dragging.value=gesture.id;ignoreBackdropUntil=Date.now()+500;updateTarget();if(!frame)frame=requestAnimationFrame(autoScroll);
}
async function finishDrag(event:PointerEvent){
 if(!gesture||event.pointerId!==gesture.pointer)return;
 const ids=[...draft.value],valid=validGesture()&&!!dragging.value;if(dragging.value)ignoreBackdropUntil=Date.now()+500;cancelDrag();
 if(valid)await submitOrder(ids);
}
async function submitOrder(ids:string[]){
 if(!canReorder.value||!app.room||ids.join()===app.room.playlist.map(t=>t.id).join())return;
 sorting.value=true;try{await app.act({type:'reorder',payload:{trackIds:ids}});}finally{sorting.value=false;}
}
watch(()=>[app.room?.id,app.room?.stateVersion,canReorder.value,tab.value],cancelDrag);
onUnmounted(cancelDrag);
const format=(ms:number)=>`${Math.floor(ms/60000).toString().padStart(2,'0')}:${Math.floor(ms/1000%60).toString().padStart(2,'0')}`;
function move(id:string,delta:number){if(!canReorder.value||!app.room)return;const ids=app.room.playlist.map(t=>t.id),index=ids.indexOf(id),target=index+delta;if(index<0||target<0||target>=ids.length)return;[ids[index],ids[target]]=[ids[target]!,ids[index]!];void submitOrder(ids);}
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
function add(){searchAfterClose=true;close();}
</script>
<template><Teleport to="body"><Transition name="drawer" appear @after-leave="afterLeave"><div v-if="visible" class="drawer-backdrop" @click.self="backdropClose"><aside ref="dialog" class="queue-drawer" @pointermove="dragMove" @pointerup="finishDrag" @pointercancel="cancelDrag" @lostpointercapture="cancelDrag" role="dialog" aria-modal="true" aria-label="共享播放列表">
 <header class="drawer-heading"><div><h2>共享播放列表</h2><p>{{ app.room?.playlist.length??0 }} 首歌曲 · {{ app.room?.members.filter(m=>m.online).length??0 }} 人共同添加</p></div><button class="round-close" aria-label="关闭播放列表" @click="close"><X :size="20" /></button></header>
 <div class="queue-tabs"><button :class="{active:tab==='queue'}" @click="tab='queue'">当前队列</button><button :class="{active:tab==='history'}" @click="tab='history'">已播放</button><small>· 房主控制播放</small><button v-if="app.host&&tab==='queue'" class="queue-clear" :disabled="blocked||!!app.room?.playback.sourceId" @click="app.act({type:'clear',payload:{}})">清空</button></div>
 <div v-if="tab==='history'" class="empty-state queue-history">当前 API 未提供播放历史，暂时无法查看。</div>
 <template v-else>
 <div class="queue-next-heading"><strong>播放顺序 <small>{{ queue.length }}</small></strong><span id="queue-sort-hint">{{ app.host?'拖动手柄排序 · Alt+↑↓ 微调':'房主可调整顺序' }}</span></div>
 <div ref="scroll" class="queue-scroll" tabindex="0" aria-label="播放队列" :aria-busy="sorting">
  <div v-for="(item,i) in queue" :key="item.id" class="queue-row" :class="{'is-playing':item.id===current?.id,'is-dragging':dragging===item.id,'is-drop-target':dropTarget===item.id}" :data-track-id="item.id" @dblclick="playFromRow($event,item.id)">
   <button v-if="app.host" type="button" class="queue-drag-handle" @dblclick.stop :disabled="!canReorder" :aria-label="`拖动调整 ${item.name} 的顺序`" aria-describedby="queue-sort-hint" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" @pointerdown="startDrag($event,item.id)" @keydown.alt.up.prevent="move(item.id,-1)" @keydown.alt.down.prevent="move(item.id,1)"><GripVertical :size="16" /></button>
   <span class="queue-index">{{ (i+1).toString().padStart(2,'0') }}</span><AlbumArt :src="bridge.playingTrackCover(item)" :draggable="false" /><span class="queue-track"><strong>{{ item.name }}</strong><small>{{ item.artists||'未知歌手' }} · {{ item.id===current?.id?'正在播放':app.room?.members.find(m=>m.id===item.providerId)?.name??'成员' }}{{ item.id===current?.id?'':'添加' }}</small></span><time>{{ format(item.durationMs) }}</time>
   <div class="track-actions" @dblclick.stop><AudioLines v-if="item.id===current?.id" class="queue-playing-icon" :size="16" /><button v-else class="icon-button" aria-label="播放此曲" :disabled="!canPlay||!item.available" @click="play(item.id)"><Play :size="15" /></button><details class="queue-more"><summary aria-label="歌曲操作">···</summary><div><button v-if="app.host" :disabled="!canReorder||i===0" aria-label="上移" @click="move(item.id,-1)"><ArrowUp :size="14" />上移</button><button v-if="app.host" :disabled="!canReorder||i===queue.length-1" aria-label="下移" @click="move(item.id,1)"><ArrowDown :size="14" />下移</button><button v-if="app.host||item.providerId===app.user?.id" aria-label="移除音轨" :disabled="blocked||item.id===current?.id||item.id===app.room?.pending?.playback.sourceId||!!dragging" @click="app.act({type:'remove',payload:{trackId:item.id}})"><Trash2 :size="14" />移除</button></div></details></div>
  </div>
  <div v-if="!queue.length" class="empty-state compact">把喜欢的歌，加入共同的列表</div>
 </div></template>
 <footer class="queue-footer"><button class="primary" :disabled="!app.permission.enqueue||!app.connected" @click="add"><Plus :size="18" />添加歌曲到共享列表</button></footer>
 </aside></div></Transition></Teleport></template>

<style scoped>
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
.queue-row.is-drop-target{border-color:#b5cbee}
.queue-footer{padding:10px 0 12px}
.queue-footer .primary{height:38px;min-height:38px;font-size:12px}
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
</style>
