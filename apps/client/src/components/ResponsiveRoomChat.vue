<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch, type ComponentPublicInstance } from 'vue';
import { MessageCircle, X } from 'lucide-vue-next';
import { useApp } from '../store';
import { subscribe } from '../bridge';
import RoomChat from './RoomChat.vue';

const app=useApp(),emit=defineEmits<{floating:[value:boolean]}>();
const floating=ref(false),open=ref(false),unread=ref(0),trigger=ref<HTMLButtonElement|null>(null);
const panel=ref<ComponentPublicInstance|null>(null),id=useId();
const active=computed(()=>!floating.value||open.value);
const label=computed(()=>unread.value?`打开聊天，${unread.value} 条新消息`:'打开聊天');
let alive=true,detach=()=>{},unsubscribe=()=>{};
const seen=new Set<string>();
function remember(value:string){seen.add(value);if(seen.size>200)seen.delete(seen.values().next().value!);}
watch(()=>app.room?.id,()=>{unread.value=0;open.value=false;seen.clear();for(const m of app.chatMessages)remember(m.id);},{immediate:true});
async function show(){open.value=true;unread.value=0;await nextTick();panel.value?.$el.querySelector?.('[data-chat-close]')?.focus();}
async function close(){open.value=false;await nextTick();if(floating.value)trigger.value?.focus();}
function escape(event:KeyboardEvent){if(event.isComposing||!floating.value||!open.value)return;event.preventDefault();event.stopPropagation();void close();}
onMounted(()=>{
 const media=window.matchMedia('(max-width: 1100px), (max-height: 639px)');
 const resize=()=>{
  const restore=panel.value?.$el.contains?.(document.activeElement);
  floating.value=media.matches;open.value=false;
  if(!floating.value)unread.value=0;
  emit('floating',floating.value);
  if(restore&&floating.value)void nextTick(()=>trigger.value?.focus());
 };
 resize();media.addEventListener('change',resize);detach=()=>media.removeEventListener('change',resize);
 void subscribe('server-message',message=>{
  if(message.type==='chat-history'&&message.roomId===app.room?.id){for(const m of message.messages)remember(m.id);return;}
  if(message.type!=='chat'||message.data.roomId!==app.room?.id)return;
  const m=message.data;if(seen.has(m.id))return;remember(m.id);
  if(!active.value&&m.userId!==app.user?.id&&m.kind!=='activity')unread.value++;
 }).then(stop=>{if(alive)unsubscribe=stop;else stop();}).catch(e=>{if(alive)app.error(e);});
});
onUnmounted(()=>{alive=false;detach();unsubscribe();});
</script>

<template>
 <!-- Keep the single chat instance and draft; the shell's shared modal inert still applies. -->
 <Teleport to=".shell" :disabled="!floating">
  <button v-if="floating" v-show="!open" ref="trigger" class="floating-chat-trigger" :aria-label="label" :aria-controls="id" :aria-expanded="open" @click="show">
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
.floating-chat-trigger{position:fixed;top:68px;right:16px;bottom:auto;width:max-content;max-width:calc(100% - 32px);flex-shrink:0;flex-wrap:nowrap;white-space:nowrap;z-index:31;display:flex;gap:8px;align-items:center;min-height:48px;padding:12px 18px;border:1px solid #ffffffd9;border-radius:24px;background:var(--accent);color:white;box-shadow:0 6px 24px #38527530}
.floating-chat-badge{position:absolute;right:-4px;top:-6px;min-width:22px;padding:3px 5px;border:2px solid white;border-radius:999px;background:#c64b55;color:white;font-size:11px;line-height:14px;text-align:center}
.floating-room-chat.room-chat{position:fixed;top:68px;right:16px;bottom:calc(var(--workspace-player,132px) + 16px + env(safe-area-inset-bottom,0px));width:min(360px,calc(100% - 32px));height:auto;max-height:560px;min-height:0;z-index:32;display:flex;flex-direction:column;margin:0;padding:16px;border:1px solid white;border-radius:20px;background:#f8fbfcf5;box-shadow:0 12px 40px #38527530}
.floating-room-chat :deep(.room-chat-header){height:auto;min-height:44px;padding-bottom:12px;flex-wrap:wrap}
.floating-room-chat :deep(.room-chat-messages){flex:1;min-height:0;max-height:none}
.floating-room-chat :deep(.chat-header-room){min-width:80px}
.floating-room-chat :deep(.chat-quick-replies){margin:8px 0}
.floating-chat-close{flex:0 0 32px;width:32px!important;min-height:32px}
@media(max-height:480px){.floating-room-chat.room-chat{top:56px;padding:10px}.floating-room-chat :deep(.chat-quick-replies){display:none}}
</style>
