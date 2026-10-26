<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { MessageCircle, Send, LoaderCircle, ArrowDown } from 'lucide-vue-next';
import { useApp } from '../store';
import { sendChat } from '../bridge';

const app = useApp();
const draft = ref(''), sending = ref(false), error = ref(''), unread = ref(0);
const list = ref<HTMLElement | null>(null), atBottom = ref(true);
const canSend = computed(() => !!app.room && app.connected && !!draft.value.trim() && !sending.value);
let alive = true, pending: { roomId: string; text: string; requestId: string } | null = null;
onUnmounted(() => { alive = false; });
const time = (value: number) => new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
function scrollPosition() {
  if (list.value) atBottom.value = list.value.scrollHeight - list.value.scrollTop - list.value.clientHeight < 32;
  if (atBottom.value) unread.value = 0;
}
async function scrollToBottom() {
  await nextTick();
  if (!alive) return;
  if (list.value) list.value.scrollTop = list.value.scrollHeight;
  atBottom.value = true; unread.value = 0;
}
watch(() => app.chatMessages.at(-1)?.id, () => {
  if (atBottom.value || app.chatMessages.at(-1)?.userId === app.user?.id) void scrollToBottom();
  else unread.value++;
}, { immediate: true });
watch(() => app.room?.id, () => { draft.value = ''; error.value = ''; pending = null; void scrollToBottom(); });
function keydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault(); void submit();
  }
}
async function submit() {
  if (!canSend.value || !app.room) return;
  const roomId = app.room.id, text = draft.value.trim();
  // A timed-out send can be retried without adding a duplicate message.
  if (!pending || pending.roomId !== roomId || pending.text !== text) pending = { roomId, text, requestId: crypto.randomUUID() };
  const requestId = pending.requestId;
  sending.value = true; error.value = '';
  try {
    await sendChat(roomId, text, requestId);
    if (!alive || app.room?.id !== roomId) return;
    if (draft.value.trim() === text) draft.value = '';
    pending = null; void scrollToBottom();
  } catch (e) {
    if (!alive || app.room?.id !== roomId) return;
    const code = e instanceof Error ? e.message : String(e);
    error.value = code === 'RATE_LIMITED' ? '发送太快了，请稍后重试' : code === 'NOT_IN_ROOM' ? '你已离开房间，无法发送消息' : code === 'INVALID_REQUEST' ? '消息不能为空，且最多 500 字' : code;
  } finally { if (alive) sending.value = false; }
}
</script>

<template>
  <section class="room-chat" aria-labelledby="room-chat-title">
    <header class="room-chat-header"><h3 id="room-chat-title"><MessageCircle :size="17" />房间聊天</h3><span><i class="dot" :class="{ online: app.connected }" />{{ app.connected ? '实时交流' : '连接已断开' }}</span></header>
    <div ref="list" class="room-chat-messages" role="log" aria-label="房间聊天消息" aria-live="polite" aria-relevant="additions" tabindex="0" @scroll="scrollPosition">
      <div v-if="!app.chatMessages.length" class="room-chat-empty"><MessageCircle :size="28" /><p>边听边聊，让音乐连接彼此</p><small>发送第一条消息吧</small></div>
      <article v-for="message in app.chatMessages" :key="message.id" class="chat-message" :class="{ own: message.userId === app.user?.id }">
        <div class="chat-message-meta"><strong>{{ message.userName }}<span v-if="message.userId === app.user?.id">（我）</span></strong><time :datetime="new Date(message.sentAt).toISOString()">{{ time(message.sentAt) }}</time></div>
        <p class="chat-message-bubble">{{ message.text }}</p>
      </article>
    </div>
    <button v-if="unread" class="chat-unread text-button" @click="scrollToBottom"><ArrowDown :size="13" />有新消息，点击查看</button>
    <form class="room-chat-form" @submit.prevent="submit">
      <label class="sr-only" for="room-chat-draft">聊天消息</label>
      <textarea id="room-chat-draft" v-model="draft" maxlength="500" rows="3" :disabled="!app.connected || sending" placeholder="分享此刻的心情…" @keydown="keydown" />
      <div class="room-chat-actions"><span>{{ draft.length }}/500 · Shift+Enter 换行</span><button class="primary" :disabled="!canSend"><LoaderCircle v-if="sending" :size="14" class="spinning" /><Send v-else :size="14" />{{ sending ? '发送中' : '发送' }}</button></div>
      <p v-if="error" class="chat-error" role="alert">{{ error }}</p>
    </form>
    <p class="room-chat-note">仅当前房间可见 · 最近 100 条 · 服务重启后清空</p>
  </section>
</template>
