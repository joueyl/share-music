<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch, type ComponentPublicInstance } from 'vue';
import { MessageCircle, X } from 'lucide-vue-next';
import { useApp } from '../store';
import { subscribe } from '../bridge';
import RoomChat from './RoomChat.vue';
import { useCachedActivity } from '../useCachedActivity';
import { modalDepth } from '../useDialogFocus';
import { ui } from '../ui';

const app=useApp(),emit=defineEmits<{floating:[value:boolean]}>();
const floating=ref(false),open=ref(false),unread=ref(0),trigger=ref<HTMLButtonElement|null>(null);
const panel=ref<ComponentPublicInstance|null>(null),id=useId();
const pageActive=useCachedActivity();
const active=computed(()=>pageActive.value&&(!floating.value||open.value));
const label=computed(()=>unread.value?`打开聊天，${unread.value} 条新消息`:'打开聊天');
let alive=true,detach=()=>{},unsubscribe=()=>{};
const position=ref<{x:number;y:number}|null>(null),dragging=ref(false);
const triggerStyle=computed(()=>position.value?{left:`${position.value.x}px`,top:`${position.value.y}px`,right:'auto'}:undefined);
let gesture:{pointer:number;x:number;y:number;left:number;top:number;handle:HTMLButtonElement}|null=null;
let suppressClick=false;
function bounds(){
 const button=trigger.value,container=button?.closest('.shell')?.getBoundingClientRect();
 if(!button||!container)return null;
 const rect=button.getBoundingClientRect(),player=document.querySelector('.global-player')?.getBoundingClientRect();
 const minX=12,minY=56;
 return {rect,container,minX,minY,maxX:Math.max(minX,container.width-rect.width-12),maxY:Math.max(minY,(player?player.top-container.top:container.height)-rect.height-12)};
}
function place(x:number,y:number){const b=bounds();if(b)position.value={x:Math.max(b.minX,Math.min(x,b.maxX)),y:Math.max(b.minY,Math.min(y,b.maxY))};}
function cancelDrag(){
 const previous=gesture;gesture=null;dragging.value=false;
 if(previous?.handle.hasPointerCapture?.(previous.pointer))previous.handle.releasePointerCapture(previous.pointer);
}
function startDrag(event:PointerEvent){
 if(event.button!==0||event.isPrimary===false||!floating.value||open.value||!pageActive.value||modalDepth.value)return;
 const b=bounds();if(!b)return;
 suppressClick=false;
 gesture={pointer:event.pointerId,x:event.clientX,y:event.clientY,left:b.rect.left-b.container.left,top:b.rect.top-b.container.top,handle:trigger.value!};
 gesture.handle.setPointerCapture?.(event.pointerId);
}
function moveDrag(event:PointerEvent){
 if(!gesture||gesture.pointer!==event.pointerId)return;
 const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
 if(!dragging.value&&Math.hypot(dx,dy)<6)return;
 dragging.value=true;suppressClick=true;event.preventDefault();place(gesture.left+dx,gesture.top+dy);
}
function endDrag(event:PointerEvent){if(gesture?.pointer===event.pointerId)cancelDrag();}
function viewportChanged(){cancelDrag();if(position.value)place(position.value.x,position.value.y);}
watch([pageActive,floating,modalDepth],()=>{cancelDrag();},{flush:'sync'});
const seen=new Set<string>();
function remember(value:string){seen.add(value);if(seen.size>200)seen.delete(seen.values().next().value!);}
watch(()=>app.room?.id,()=>{cancelDrag();position.value=null;unread.value=0;open.value=false;seen.clear();for(const m of app.chatMessages)remember(m.id);},{immediate:true});
async function show(event?:MouseEvent){if(event?.detail&&suppressClick){suppressClick=false;event.preventDefault();return;}open.value=true;unread.value=0;await nextTick();panel.value?.$el.querySelector?.('[data-chat-close]')?.focus();}
watch(()=>ui.chatRequest,()=>{if(pageActive.value&&floating.value&&app.room?.id===ui.chatRoomId)void show();});
async function close(){open.value=false;await nextTick();viewportChanged();if(pageActive.value&&floating.value)trigger.value?.focus();}
function escape(event:KeyboardEvent){if(event.isComposing||!floating.value||!open.value)return;event.preventDefault();event.stopPropagation();void close();}
onMounted(()=>{
 const media=window.matchMedia('(max-width: 1100px), (max-height: 639px)');
 const resize=()=>{
  const restore=panel.value?.$el.contains?.(document.activeElement);
  floating.value=media.matches;open.value=false;
  if(!floating.value)unread.value=0;
  emit('floating',floating.value);
  void nextTick(viewportChanged);
  if(restore&&floating.value)void nextTick(()=>trigger.value?.focus());
 };
 resize();media.addEventListener('change',resize);window.addEventListener('resize',viewportChanged);
 detach=()=>{media.removeEventListener('change',resize);window.removeEventListener('resize',viewportChanged);};
 void subscribe('server-message',message=>{
  if(message.type==='chat-history'&&message.roomId===app.room?.id){for(const m of message.messages)remember(m.id);return;}
  if(message.type!=='chat'||message.data.roomId!==app.room?.id)return;
  const m=message.data;if(seen.has(m.id))return;remember(m.id);
  if(!active.value&&m.userId!==app.user?.id&&m.kind!=='activity')unread.value++;
 }).then(stop=>{if(alive)unsubscribe=stop;else stop();}).catch(e=>{if(alive)app.error(e);});
});
onUnmounted(()=>{alive=false;cancelDrag();detach();unsubscribe();});
</script>

<template>
 <!-- Keep the single chat instance and draft; the shell's shared modal inert still applies. -->
 <Teleport to=".shell" :disabled="!floating">
  <button v-if="pageActive&&floating" v-show="!open" ref="trigger" class="floating-chat-trigger" :class="{dragging}" :style="triggerStyle" title="点击打开聊天，按住可拖动位置" @pointerdown="startDrag" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag" :aria-label="label" :aria-controls="id" :aria-expanded="open" @click="show">
   <MessageCircle :size="22" /><span>聊天</span>
   <span v-if="unread" class="floating-chat-badge" aria-hidden="true">{{ unread>99?'99+':unread }}</span>
   <span class="sr-only" role="status" aria-live="polite">{{ unread?`${unread} 条新消息`:'' }}</span>
  </button>
  <RoomChat v-show="active" :id="id" ref="panel" :active="active" :class="{'floating-room-chat':floating}" @keydown.esc="escape">
   <template #actions><button v-if="floating" data-chat-close class="icon-button floating-chat-close" aria-label="收起聊天" @click="close"><X :size="18" /></button></template>
  </RoomChat>
 </Teleport>
</template>

<style scoped>
.floating-chat-trigger{touch-action:none;user-select:none;cursor:grab;position:fixed;top:68px;right:16px;bottom:auto;width:max-content;max-width:calc(100% - 32px);flex-shrink:0;flex-wrap:nowrap;white-space:nowrap;z-index:31;display:flex;gap:8px;align-items:center;min-height:48px;padding:12px 18px;border:1px solid #ffffffd9;border-radius:24px;background:var(--accent);color:white;box-shadow:0 6px 24px #38527530}
.floating-chat-trigger.dragging{cursor:grabbing}
.floating-chat-badge{position:absolute;right:-4px;top:-6px;min-width:22px;padding:3px 5px;border:2px solid white;border-radius:999px;background:#c64b55;color:white;font-size:11px;line-height:14px;text-align:center}
.floating-room-chat.room-chat{position:fixed;top:68px;right:16px;bottom:calc(var(--workspace-player,132px) + 16px + env(safe-area-inset-bottom,0px));width:min(360px,calc(100% - 32px));height:auto;max-height:560px;min-height:0;z-index:32;display:flex;flex-direction:column;margin:0;padding:16px;border:1px solid white;border-radius:20px;background:#f8fbfcf5;box-shadow:0 12px 40px #38527530}
.floating-room-chat :deep(.room-chat-header){height:auto;min-height:44px;padding-bottom:12px;flex-wrap:wrap}
.floating-room-chat :deep(.room-chat-messages){flex:1;min-height:0;max-height:none}
.floating-room-chat :deep(.chat-header-room){min-width:80px}
.floating-room-chat :deep(.chat-quick-replies){margin:8px 0}
.floating-chat-close{flex:0 0 32px;width:32px!important;min-height:32px}
@media(max-height:480px){.floating-room-chat.room-chat{top:56px;padding:10px}.floating-room-chat :deep(.chat-quick-replies){display:none}}

@media(max-width:720px),(max-width:900px) and (pointer:coarse){
 .floating-chat-trigger{top:auto;bottom:calc(var(--workspace-player) + 12px);right:16px;padding:10px 16px;min-height:48px;background:var(--accent)}
 .floating-room-chat.room-chat{top:calc(env(safe-area-inset-top,0px) + 8px);bottom:calc(var(--workspace-player) + 8px);right:8px;width:calc(100% - 16px);max-width:600px;max-height:none;padding:16px;border-radius:24px;background:linear-gradient(135deg,#e9f3ff,#faf3e7);box-shadow:0 12px 40px #38527530}
 .floating-room-chat :deep(.room-chat-header){min-height:48px}
 .floating-room-chat :deep(.floating-chat-close){width:44px!important;min-height:44px;height:44px;flex-basis:44px}
 .floating-room-chat :deep(.room-chat-messages){min-height:60px;padding:12px 0}
 .floating-room-chat :deep(.chat-message-bubble){font-size:14px;line-height:1.65;padding:10px 12px;border-radius:16px}
 .floating-room-chat :deep(.room-chat-form){flex-shrink:0}
 .floating-room-chat :deep(.room-chat-form textarea){min-height:44px;font-size:16px;border-radius:16px}
 .floating-room-chat :deep(.room-chat-actions .primary){min-height:44px;font-size:14px;background:var(--accent)}
 .floating-room-chat :deep(.chat-quick-replies){display:flex;flex-wrap:nowrap;overflow:auto;gap:8px}
 .floating-room-chat :deep(.chat-quick-replies button){min-height:44px;flex-shrink:0}
 .floating-room-chat :deep(.room-chat-note){display:none}
}


@media(max-width:720px) and (max-height:560px),(max-width:900px) and (pointer:coarse) and (max-height:560px){
 .floating-room-chat.room-chat{overflow:auto;padding:12px}
 .floating-room-chat :deep(.chat-quick-replies){display:none}
 .floating-room-chat :deep(.room-chat-messages){flex:1 0 80px}
}
</style>
