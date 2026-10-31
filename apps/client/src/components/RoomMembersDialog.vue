<script setup lang="ts">
import { ref } from 'vue';
import { Users, Settings2, X, Link, Check } from 'lucide-vue-next';
import { useApp } from '../store';
import { useDialogFocus } from '../useDialogFocus';
import type { Permissions, PermissionKey } from '@music-share/shared';

const app = useApp(), emit = defineEmits<{ close: [] }>(), panel = ref<'members' | 'settings'>('members'), dialog = ref<HTMLElement | null>(null);
const copied = ref(false);
useDialogFocus(dialog, () => emit('close'));

const keys: PermissionKey[] = ['skip', 'seek', 'enqueue'];
const labels: Record<PermissionKey, string> = { skip: '切歌 / 播放控制', stream: '旧版兼容字段', seek: '进度切换', enqueue: '加入播放列表' };

function setDefault(key: PermissionKey, value: boolean) {
  if (app.room) void app.act({ type: 'defaults', payload: { ...app.room.defaults, [key]: value } });
}

function setOverride(memberId: string, key: PermissionKey, value: string) {
  const member = app.room?.members.find(m => m.id === memberId);
  if (!member) return;
  const overrides: Partial<Permissions> = { ...member.overrides };
  if (value === 'default') delete overrides[key];
  else overrides[key] = value === 'allow';
  void app.act({ type: 'permission', payload: { memberId, overrides } });
}

async function copyInvite() {
  const code = app.room?.inviteCode;
  if (!code) return;
  const roomName = app.room?.name || '一起听房间';
  const track = app.room?.playlist.find((t) => t.id === app.room?.playback.sourceId);
  const songDesc = track ? `《${track.name}》- ${track.artists}` : '好听的音乐';
  
  const hostUrl = typeof window !== 'undefined' && !window.location.origin.includes('localhost') && !window.location.origin.includes('127.0.0.1')
    ? window.location.origin
    : 'https://share.jouei.cn';
    
  const shareText = `我在【${roomName}】听 ${songDesc}，来和我一起听歌吧！\n房间邀请码：${code}\n客户端下载 / 网页加入：${hostUrl}`;
  
  try {
    await navigator.clipboard.writeText(shareText);
    copied.value = true;
    app.notice = '邀请信息已复制，快去发给好友吧！';
    setTimeout(() => { copied.value = false; }, 2500);
  } catch {
    app.notice = `房间码：${code}，请手动复制分享`;
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop tone-modal-backdrop" @click.self="emit('close')">
      <section ref="dialog" class="tone-dialog members-dialog" role="dialog" aria-modal="true" aria-label="房间成员与权限">
        <header class="dialog-heading">
          <h2>一起听的人</h2>
          <button class="round-close" aria-label="关闭成员与权限" @click="emit('close')">
            <X :size="20" />
          </button>
        </header>

        <div class="room-invite-card">
          <div class="invite-card-info">
            <span class="invite-label">房间邀请码</span>
            <strong class="invite-code">{{ app.room?.inviteCode }}</strong>
          </div>
          <button type="button" class="primary invite-copy-action" @click="copyInvite">
            <Check v-if="copied" :size="15" />
            <Link v-else :size="15" />
            <span>{{ copied ? '已复制邀请文案' : '复制邀请房间' }}</span>
          </button>
        </div>

        <div class="tabs">
          <button :class="{ active: panel === 'members' }" @click="panel = 'members'">
            <Users :size="16" />成员
          </button>
          <button :class="{ active: panel === 'settings' }" @click="panel = 'settings'">
            <Settings2 :size="16" />权限
          </button>
        </div>

        <template v-if="panel === 'members'">
          <div v-for="member in app.room?.members" :key="member.id" class="member-row">
            <span class="portrait">{{ member.name.slice(0, 1) }}</span>
            <span>{{ member.name }}<small>{{ member.id === app.room?.hostId ? '房主' : member.online ? '在线收听' : '暂时离线' }}</small></span>
            <i class="dot" :class="{ online: member.online }" />
          </div>
          <p class="aside-note">本地音量只影响自己。切歌与进度由房间统一同步。</p>
        </template>

        <template v-else>
          <h3>房间默认权限</h3>
          <label v-for="key in keys" :key="key" class="permission-row">
            <span>{{ labels[key] }}</span>
            <input type="checkbox" :checked="app.room?.defaults[key]" :disabled="!app.host || !app.connected" @change="setDefault(key, ($event.target as HTMLInputElement).checked)" />
          </label>
          <template v-if="app.host">
            <h3>成员单独设置</h3>
            <div v-for="member in app.room?.members.filter(m => m.id !== app.room?.hostId)" :key="member.id" class="override-card">
              <strong>{{ member.name }}</strong>
              <label v-for="key in keys" :key="key" class="override-row">
                <span>{{ labels[key] }}</span>
                <select class="tone-select" :value="member.overrides[key] === undefined ? 'default' : member.overrides[key] ? 'allow' : 'deny'" :disabled="!app.connected" @change="setOverride(member.id, key, ($event.target as HTMLSelectElement).value)">
                  <option value="default">跟随房间</option>
                  <option value="allow">允许</option>
                  <option value="deny">禁止</option>
                </select>
              </label>
            </div>
          </template>
        </template>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.room-invite-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  margin: 8px 0 16px;
  background: linear-gradient(135deg, rgba(93, 187, 0, 0.08) 0%, rgba(80, 139, 115, 0.08) 100%);
  border: 1px solid rgba(93, 187, 0, 0.2);
  border-radius: 14px;
}

.invite-card-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.invite-label {
  font-size: 11px;
  color: #64748b;
}

.invite-code {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #1e293b;
  font-family: monospace;
}

.invite-copy-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-size: 12px;
  height: 34px;
  border-radius: 17px;
  white-space: nowrap;
}
</style>
