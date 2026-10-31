<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { MessageCircle, Send, LoaderCircle, ArrowDown, MoreHorizontal, Heart, Music2 } from 'lucide-vue-next';
import { useApp } from '../store';
import { ui } from '../ui';
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
    const errors: Record<string, string> = {
      RATE_LIMITED: '发送太快了，请稍后重试', NOT_IN_ROOM: '你已离开房间，无法发送消息',
      INVALID_REQUEST: '服务端拒绝了聊天请求，请检查消息格式及客户端与服务端版本',
      CHAT_UNSUPPORTED: '当前服务端不支持聊天，请更新生产环境服务端后重连',
      CHAT_DISCONNECTED: '连接已断开，消息尚未确认；重连后可重试',
      SESSION_EXPIRED: '登录已失效，请重新登录', UNAUTHORIZED: '登录已失效，请重新登录',
    };
    error.value = errors[code] ?? code;
  } finally { if (alive) sending.value = false; }
}
</script>

<template>
  <section class="room-chat" aria-labelledby="room-chat-title">
    <header class="room-chat-header">
      <div class="chat-header-room">
        <h3 id="room-chat-title" class="chat-room-name" :title="app.room?.name">{{ app.room?.name || '一起听房间' }}</h3>
        <span class="chat-room-badge">{{ app.room?.settings?.visibility === 'invite' ? '私密' : '公开' }}</span>
      </div>
      <span class="chat-online">{{ app.room?.members.filter(m=>m.online).length??0 }} 在线</span>
      <button class="icon-button" aria-label="房间成员与邀请" title="房间成员与邀请" @click="ui.members=true">
        <MoreHorizontal :size="18" />
      </button>
    </header>
    <div ref="list" class="room-chat-messages" role="log" aria-label="房间聊天消息" aria-live="polite" aria-relevant="additions" tabindex="0" @scroll="scrollPosition">
      <div v-if="!app.chatMessages.length" class="room-chat-empty"><MessageCircle :size="28" /><p>边听边聊，让音乐连接彼此</p><small>发送第一条消息吧</small></div>
      <template v-for="message in app.chatMessages" :key="message.id">
      <article v-if="message.kind === 'activity'" class="chat-activity">
        <Music2 :size="13" aria-hidden="true" /><p><strong>{{ message.userName }}</strong><span v-if="message.userId === app.user?.id">（我）</span> {{ message.text }}</p><time :datetime="new Date(message.sentAt).toISOString()">{{ time(message.sentAt) }}</time>
      </article>
      <article v-else class="chat-message" :class="{ own: message.userId === app.user?.id }">
        <span v-if="message.userId!==app.user?.id" class="portrait chat-portrait" aria-hidden="true">{{ message.userName.slice(0,1) }}</span><div class="chat-message-meta"><strong>{{ message.userName }}<span v-if="message.userId === app.user?.id">（我）</span></strong><time :datetime="new Date(message.sentAt).toISOString()">{{ time(message.sentAt) }}</time></div>
        <p class="chat-message-bubble">{{ message.text }}</p>
      </article>
      </template>
    </div>
    <button v-if="unread" class="chat-unread text-button" @click="scrollToBottom"><ArrowDown :size="13" />有新消息，点击查看</button>
    <div class="chat-quick-replies"><button type="button" :disabled="!app.connected||sending" @click="draft='这首歌好听！'"><Heart :size="13" />好喜欢</button><button type="button" :disabled="!app.connected||sending" @click="draft='晚安'">晚安</button><button type="button" :disabled="!app.connected||sending" @click="draft='好听！'">好听！</button></div>
    <form class="room-chat-form" @submit.prevent="submit">
      <label class="sr-only" for="room-chat-draft">聊天消息</label>
      <textarea id="room-chat-draft" v-model="draft" maxlength="500" rows="1" :disabled="!app.connected || sending" placeholder="说点什么，让此刻更近…" @keydown="keydown" />
      <div class="room-chat-actions"><button class="primary" aria-label="发送聊天消息" :aria-busy="sending" :disabled="!canSend"><LoaderCircle v-if="sending" :size="14" class="spinning" /><Send v-else :size="14" /><span class="sr-only">{{ sending ? '发送中' : '发送' }}</span></button></div>
      <p v-if="error" class="chat-error" role="alert">{{ error }}</p>
    </form>
    
  </section>
</template>

<style scoped>
.chat-header-room {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.chat-room-name {
  font-size: 15px !important;
  font-weight: 600 !important;
  color: #1e293b !important;
  margin: 0 !important;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-room-badge {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 8px;
  background: rgba(80, 139, 115, 0.12);
  color: #2e7d5a;
  border: 1px solid rgba(80, 139, 115, 0.22);
  white-space: nowrap;
  font-weight: 500;
  flex-shrink: 0;
}

/* Compact messages without shrinking the text or its touch/keyboard controls. */
.room-chat-messages{padding:14px 3px 10px}
.chat-message{margin-bottom:12px}
.chat-message-meta{margin-bottom:4px}
.chat-message-bubble{width:fit-content;max-width:100%;padding:7px 10px;line-height:1.55;border-radius:10px}
.chat-message.own{padding-left:0}
.chat-message.own .chat-message-bubble{border-radius:10px}
.chat-activity{margin:10px 0;padding:6px 9px}
/* Keep the gutter stable while messages arrive; style only the chat log. */
.room-chat-messages{
  --chat-scroll-thumb:#b8c7d9;
  scrollbar-width:thin;
  scrollbar-color:var(--chat-scroll-thumb) transparent;
  scrollbar-gutter:stable;
}
.room-chat-messages:hover,.room-chat-messages:focus-within{--chat-scroll-thumb:#91a9c7}
/* WebView2 supports the native pseudo-elements. Reset the standard properties
   here so Chromium does not override the rounded custom thumb with its own. */
@supports selector(::-webkit-scrollbar){
  .room-chat-messages{scrollbar-width:auto;scrollbar-color:auto}
  .room-chat-messages::-webkit-scrollbar{width:8px;height:8px}
  .room-chat-messages::-webkit-scrollbar-track{background:transparent;margin-block:8px}
  .room-chat-messages::-webkit-scrollbar-thumb{
    background:var(--chat-scroll-thumb);
    border:2px solid transparent;
    border-radius:999px;
    background-clip:padding-box;
    min-height:32px;
  }
  .room-chat-messages::-webkit-scrollbar-thumb:hover{background-color:#7899c3}
  .room-chat-messages::-webkit-scrollbar-thumb:active{background-color:#5dbb00}
  .room-chat-messages::-webkit-scrollbar-button{display:none;width:0;height:0}
  .room-chat-messages::-webkit-scrollbar-corner{background:transparent}
}
@media(forced-colors:active){
  .room-chat-messages{scrollbar-color:auto;--chat-scroll-thumb:ButtonText}
  .room-chat-messages::-webkit-scrollbar-thumb:hover{background-color:Highlight}
  .room-chat-messages::-webkit-scrollbar-thumb:active{background-color:Highlight}
}
</style>
