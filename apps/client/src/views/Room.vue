<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Play, Pause, SkipForward, SkipBack, Square, Plus, Radio, Users, Settings2, Volume2, LogOut, Disc3, Trash2, ArrowUp, ArrowDown, Monitor, ShieldCheck } from 'lucide-vue-next';
import { useApp } from '../store';
import * as bridge from '../bridge';
import type { Permissions, PermissionKey } from '@music-share/shared';
const app = useApp(), route = useRoute(), router = useRouter();
const panel = ref<'members' | 'settings' | 'source'>('members'), volume = ref(1), deviceList = ref<bridge.CaptureDevice[]>([]);
const captureDevice = computed(() => deviceList.value.find(device => device.isDefault || device.id === 'default'));
const deviceLoading = ref(false), deviceError = ref('');
let deviceRequest = 0;
async function refreshDevices(): Promise<boolean> {
  const request = ++deviceRequest;
  deviceLoading.value = true;
  deviceError.value = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const devices = await Promise.race([
      bridge.devices(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('读取默认设备超时，请检查输出设备连接后重试。')), 8000); })
    ]);
    if (request !== deviceRequest) return false;
    deviceList.value = devices;
    const device = captureDevice.value;
    if (!device) throw new Error(devices.length ? '当前媒体库未返回系统默认设备标识，请关闭客户端后重新运行 npm.cmd run desktop，加载新版媒体库。' : '未检测到系统默认输出设备，请检查 Windows 声音设置。');
    if (!device.sampleRate || !device.captureBits) throw new Error('当前媒体库未提供自动采集格式，请关闭客户端后重新运行 npm.cmd run desktop，加载新版媒体库。');
    return true;
  } catch (e) {
    if (request === deviceRequest) { deviceList.value = []; deviceError.value = e instanceof Error ? e.message : String(e); }
    return false;
  } finally {
    clearTimeout(timer);
    if (request === deviceRequest) deviceLoading.value = false;
  }
}
watch(panel, value => { if (value === 'source') void refreshDevices(); });

const track = computed(() => app.room?.playlist.find(t => t.id === app.room?.playback.sourceId));
const live = computed(() => app.room?.playback.sourceType === 'live');
const stoppableLive = computed(() => {
  const sources = [app.room?.playback, app.room?.pending?.playback];
  return sources.find(source => source?.sourceType === 'live' && (app.host || source.providerId === app.user?.id));
});

const failedStun = computed(() => app.stun.servers.filter(server => !server.ok));
const allStunFailed = computed(() => app.stun.servers.length > 0 && failedStun.value.length === app.stun.servers.length);
const labels: Record<PermissionKey, string> = { skip: '切歌 / 播放控制', stream: '本地推流', seek: '进度切换', enqueue: '加入播放列表' };
const keys: PermissionKey[] = ['skip', 'stream', 'seek', 'enqueue'];
const format = (ms: number) => `${Math.floor(ms / 60000).toString().padStart(2, '0')}:${Math.floor(ms / 1000 % 60).toString().padStart(2, '0')}`;
const disabled = computed(() => !app.connected || !!app.room?.pending);
// Keep the user's chosen position independent of the continuously ticking room clock.
const seekPreview = ref<number | null>(null);
const seekMaximum = computed(() => Math.max(0, (track.value?.durationMs ?? 1) - 1));
const displayedProgress = computed(() => seekPreview.value ?? Math.min(app.progress, seekMaximum.value));
watch(() => app.room?.playback.sourceEpoch, () => { seekPreview.value = null; });
function previewSeek(event: Event) { seekPreview.value = Number((event.target as HTMLInputElement).value); }
async function commitSeek(event: Event) {
  const positionMs = Math.min(seekMaximum.value, Math.max(0, Math.round(seekPreview.value ?? Number((event.target as HTMLInputElement).value))));
  if (!disabled.value && app.permission.seek && track.value && !live.value) {
    await app.act({ type: 'seek', payload: { positionMs } });
  }
  seekPreview.value = null;
}

onMounted(async () => { try { if (app.room?.id !== route.params.id) await bridge.join(String(route.params.id)); } catch (e) { app.error(e); } await refreshDevices(); });
async function exit() { await app.exitRoom(); await router.push('/'); }
async function startLive() {
  try {
    if (!await refreshDevices()) return;
    const device = captureDevice.value;
    if (device?.supported === false) throw new Error(`系统默认输出设备为 ${device.sampleRate}Hz / ${device.channels} 声道，当前仅支持双声道 44.1/48/88.2/96kHz；请调整 Windows 默认输出设备的格式。`);
    if (!device?.sampleRate || !device.captureBits) throw new Error('无法读取系统默认输出设备的采集格式，请确认使用新版媒体库并刷新设备信息。');
    await bridge.selectDevice('default');
    const spec = { sampleRate: device.sampleRate, bits: device.captureBits, channels: device.channels ?? 2 };
    await app.act({ type: app.permission.skip ? 'startLive' : 'requestLive', payload: { spec, bitrateBps: spec.sampleRate * spec.bits * spec.channels } });
  } catch (e) { app.error(e); }
}
function setDefault(key: PermissionKey, value: boolean) { if (app.room) void app.act({ type: 'defaults', payload: { ...app.room.defaults, [key]: value } }); }
function setOverride(memberId: string, key: PermissionKey, value: string) { const member = app.room?.members.find(m => m.id === memberId); if (!member) return; const overrides: Partial<Permissions> = { ...member.overrides }; if (value === 'default') delete overrides[key]; else overrides[key] = value === 'allow'; void app.act({ type: 'permission', payload: { memberId, overrides } }); }
function move(index: number, delta: number) { const ids = app.room!.playlist.map(t => t.id); [ids[index], ids[index + delta]] = [ids[index + delta]!, ids[index]!]; void app.act({ type: 'reorder', payload: { trackIds: ids } }); }
</script>
<template>
  <header class="topbar"><span>音乐房间 / {{ app.room?.name ?? '加入中…' }}</span><button class="text-button" @click="exit"><LogOut :size="15" />离开房间</button></header>
  <section v-if="app.room" class="page room-page"><div class="page-heading"><div><span class="eyebrow">YOUR SHARED FREQUENCY</span><h1>{{ app.room.name }}</h1><p class="muted"><Users :size="14" /> {{ app.room.members.filter(m => m.online).length }} / 8 人 · {{ app.host ? '你是房主' : '共享同一段旋律' }}</p></div><span class="quality-pill" :class="{ lossy: app.room.playback.qualityMode !== 'lossless' }"><ShieldCheck :size="14" />{{ app.room.playback.qualityMode === 'opus' ? 'OPUS · 有损' : app.room.playback.qualityMode === 'source' ? '原始有损音源' : '无损优先' }}</span></div>
  <div v-if="failedStun.length" class="stun-warning" role="status" aria-live="polite">
    <strong>{{ allStunFailed ? 'STUN 连接探测失败' : '部分 STUN 连接探测失败' }}</strong>
    <p>{{ allStunFailed ? '当前网络未收到 STUN 响应，公网直连可能受影响。局域网直连或已配置的 TURN 中继仍可能可用。' : '其他 STUN 仍可用，将继续尝试建立连接。' }}</p>
    <p v-for="server in failedStun" :key="server.url">{{ server.url }} · {{ server.error }}</p>
    <small>每 60 秒自动重试；检查网络、DNS 或防火墙是否允许 UDP。此提示不会停止已有播放。</small>
  </div>
  <div class="room-layout"><div class="room-main"><div class="player"><div class="player-cover"><Disc3 :size="80" :class="{ spinning: app.media.status === 'playing' }" /><span>共 鸣</span></div><div class="player-info"><div class="hero-label">{{ live ? 'LIVE SYSTEM AUDIO' : 'NOW PLAYING' }}</div><h2>{{ live ? '系统音频直播' : track?.name ?? '等待第一首音乐' }}</h2><p class="muted">{{ app.room.members.find(m => m.id === app.room?.playback.providerId)?.name ?? '添加一首收藏，开始共享' }}<template v-if="app.room.playback.spec"> · {{ app.room.playback.spec.sampleRate / 1000 }}kHz / {{ app.room.playback.spec.bits }}bit</template></p><div class="player-status"><span class="dot" :class="{ online: app.media.status === 'playing' }" />{{ app.room.pending ? `正在准备播放 ${format(app.room.pending.playback.positionMs)}，约 3–5 秒后同步生效…` : app.media.detail || (app.room.playback.sourceId ? '等待媒体连接' : '尚未播放') }}</div></div>
  <div class="progress-area"><input class="progress" type="range" min="0" :max="seekMaximum" :value="displayedProgress" step="1" :disabled="live || !track || !app.permission.seek || disabled" aria-label="歌曲进度" @pointerdown="seekPreview = displayedProgress" @pointercancel="seekPreview = null" @input="previewSeek" @change="commitSeek" /><div class="progress-times"><span>{{ format(displayedProgress) }}</span><span>{{ live ? `直播 · 缓冲 ${Math.round(app.media.bufferedMs / 1000)}s` : format(track?.durationMs ?? 0) }}</span></div></div>
  <div class="player-controls"><button class="icon-button" aria-label="上一首" :disabled="!app.permission.skip || disabled" @click="app.act({ type: 'previous', payload: {} })"><SkipBack :size="21" /></button><button class="play-button" :disabled="!app.permission.skip || disabled || live || !track" :aria-label="app.room.playback.playState === 'playing' ? '暂停' : '继续'" @click="app.act({ type: app.room.playback.playState === 'playing' ? 'pause' : 'resume', payload: {} })"><Pause v-if="app.room.playback.playState === 'playing'" :size="23" /><Play v-else :size="23" /></button><button class="icon-button" aria-label="下一首" :disabled="!app.permission.skip || disabled" @click="app.act({ type: 'next', payload: {} })"><SkipForward :size="21" /></button><button class="icon-button" aria-label="停止" :disabled="!app.permission.skip || !app.connected" @click="app.act({ type: 'stop', payload: {} })"><Square :size="16" /></button><div class="volume"><Volume2 :size="16" /><input v-model.number="volume" type="range" min="0" max="1" step="0.01" aria-label="本地音量" @input="bridge.setVolume(volume).catch(app.error)" /></div></div></div>
  <div class="section-title"><h2>播放列表 <span>{{ app.room.playlist.length }}</span></h2><div class="inline-actions"><button v-if="app.host" class="text-button" :disabled="disabled || app.room.playback.sourceType === 'file'" @click="app.act({ type: 'clear', payload: {} })">清空</button><button class="secondary" :disabled="!app.permission.enqueue || !app.native || !app.connected" @click="app.addFile()"><Plus :size="16" />添加本地音乐</button></div></div>
  <div v-if="!app.room.playlist.length" class="empty-state compact"><Disc3 :size="30" /><h3>把你的收藏带进来</h3><p>音乐文件保留在你的设备，播放时通过 P2P 共享。</p></div>
  <div v-else class="track-list"><div v-for="(item, i) in app.room.playlist" :key="item.id" class="track-row" :class="{ current: item.id === app.room.playback.sourceId }"><span class="track-number">{{ (i + 1).toString().padStart(2, '0') }}</span><div class="track-title"><strong>{{ item.name }}</strong><small>{{ app.room.members.find(m => m.id === item.providerId)?.name ?? '离线成员' }} · {{ item.available ? (item.lossless ? '无损音源' : '有损音源') : '提供者离线' }}</small></div><span class="track-duration">{{ format(item.durationMs) }}</span><button class="icon-button" aria-label="播放此曲" :disabled="!app.permission.skip || !item.available || disabled" @click="app.act({ type: 'play', payload: { trackId: item.id } })"><Play :size="16" /></button><template v-if="app.host"><button class="icon-button" aria-label="上移" :disabled="i === 0 || !app.connected" @click="move(i, -1)"><ArrowUp :size="14" /></button><button class="icon-button" aria-label="下移" :disabled="i === app.room.playlist.length - 1 || !app.connected" @click="move(i, 1)"><ArrowDown :size="14" /></button></template><button v-if="app.host || item.providerId === app.user?.id" class="icon-button" aria-label="移除音轨" :disabled="item.id === app.room.playback.sourceId || item.id === app.room.pending?.playback.sourceId || !app.connected" @click="app.act({ type: 'remove', payload: { trackId: item.id } })"><Trash2 :size="14" /></button></div></div>
  <p v-if="!app.native" class="native-note">{{ app.nativeReason }}</p><div class="network-strip"><span>缓冲 {{ (app.media.bufferedMs / 1000).toFixed(1) }}s</span><span>进度差 {{ Math.round(app.media.driftMs) }}ms</span><span>{{ (app.media.receiveBps / 1e6).toFixed(2) }} Mbps</span><span>P2P · 5M 中继共享预算</span></div></div>
  <aside class="room-aside"><div class="tabs"><button :class="{ active: panel === 'members' }" aria-label="成员" @click="panel = 'members'"><Users :size="17" />成员</button><button :class="{ active: panel === 'source' }" aria-label="音源" @click="panel = 'source'"><Monitor :size="17" />音源</button><button :class="{ active: panel === 'settings' }" aria-label="权限" @click="panel = 'settings'"><Settings2 :size="17" />权限</button></div>
  <template v-if="panel === 'members'"><h3>房间成员</h3><div v-for="member in app.room.members" :key="member.id" class="member-row"><span class="avatar">{{ member.name.slice(0, 1) }}</span><span>{{ member.name }}<small>{{ member.id === app.room.hostId ? '房主' : member.online ? '在线收听' : '暂时离线' }}</small></span><span class="dot" :class="{ online: member.online }" /></div><div class="aside-note">本地音量只影响自己。<br>切歌与进度由房间统一同步。</div></template>
  <template v-else-if="panel === 'source'"><h3>共享你的音源</h3><p class="muted">系统音频默认无损传输，允许 2–5 秒缓冲。</p><div class="aside-note"><strong>系统默认输出设备</strong><p>{{ deviceLoading ? '正在读取设备信息…' : captureDevice?.name ?? '未获取到默认设备' }}</p><p v-if="captureDevice?.sampleRate">{{ captureDevice.sampleRate / 1000 }}kHz / {{ captureDevice.channels }} 声道 · 采集 PCM {{ captureDevice.captureBits }}bit</p><p v-if="captureDevice?.integerConversion">系统浮点或高位深输出自动转换为 24bit 整数 PCM，无损传输从转换后的 PCM 开始。</p><p v-if="captureDevice?.supported === false">此设备格式暂不支持，请调整 Windows 默认输出设备格式。</p></div><p v-if="deviceError" role="alert" class="native-note">{{ deviceError }}</p><button class="text-button" :disabled="deviceLoading" @click="refreshDevices">{{ deviceLoading ? '读取中…' : '刷新设备信息' }}</button><p class="muted small">开始推流时自动读取系统默认输出设备，不重采样。推流期间关闭本应用房间输出，避免反馈。</p><button class="primary full" :disabled="!app.native || !app.permission.stream || disabled || deviceLoading || !!deviceError || !captureDevice || captureDevice?.supported === false" @click="startLive"><Radio :size="16" />{{ app.permission.skip ? '开始系统推流' : '申请推流席位' }}</button><button v-if="stoppableLive" class="secondary full" :disabled="!app.connected" @click="app.act({ type: 'stopLive', payload: { sourceEpoch: stoppableLive!.sourceEpoch } })"><Square :size="16" />停止推流</button><button class="secondary full" :disabled="!app.native || !app.permission.stream || !app.permission.skip || disabled" @click="app.addFile(true)">立即播放本地文件</button><template v-if="app.host"><div v-for="request in app.room.requests" :key="request.id" class="request-card"><p>{{ app.room.members.find(m => m.id === request.memberId)?.name }} 申请推流</p><button class="secondary" :disabled="disabled" @click="app.act({ type: 'approveLive', payload: { requestId: request.id } })">批准</button><button class="text-button" @click="app.act({ type: 'rejectLive', payload: { requestId: request.id } })">拒绝</button></div></template><div v-if="app.room.playback.sourceId && (app.host || app.room.playback.providerId === app.user?.id)" class="aside-note"><h4>音质模式</h4><p>带宽不足时可主动选择有损，影响全房间。</p><button class="secondary full" :disabled="disabled" @click="app.act({ type: 'quality', payload: { qualityMode: app.room!.playback.qualityMode === 'opus' ? (track?.lossless || live ? 'lossless' : 'source') : 'opus' } })">{{ app.room.playback.qualityMode === 'opus' ? '恢复原音质' : '切换 Opus · 有损' }}</button></div></template>
  <template v-else><h3>房间默认权限</h3><div v-for="key in keys" :key="key" class="permission-row"><span>{{ labels[key] }}</span><input type="checkbox" :checked="app.room.defaults[key]" :disabled="!app.host || !app.connected" @change="setDefault(key, ($event.target as HTMLInputElement).checked)" /></div><template v-if="app.host"><h3 class="spaced">成员单独设置</h3><div v-for="member in app.room.members.filter(m => m.id !== app.room?.hostId)" :key="member.id" class="override-card"><strong>{{ member.name }}</strong><label v-for="key in keys" :key="key" class="override-row"><span>{{ labels[key] }}</span><select :value="member.overrides[key] === undefined ? 'default' : member.overrides[key] ? 'allow' : 'deny'" :disabled="!app.connected" @change="setOverride(member.id, key, ($event.target as HTMLSelectElement).value)"><option value="default">跟随房间</option><option value="allow">允许</option><option value="deny">禁止</option></select></label></div></template><p class="aside-note">成员设置优先于默认值。房主始终具有全部权限。</p></template>
  </aside></div></section><div v-else class="empty-state"><Radio :size="32" /><h3>正在加入房间…</h3><button class="secondary" @click="router.push('/')">返回房间列表</button></div>
</template>
