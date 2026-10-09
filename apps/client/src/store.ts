import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { ALL_PERMISSIONS, DEFAULT_PERMISSIONS, positionAt, type Action, type RoomSnapshot } from '@music-share/shared';
import * as bridge from './bridge';
const messages: Record<string, string> = {
  FORBIDDEN: '没有此操作权限', HOST_ONLY: '仅房主可操作', ROOM_FULL: '房间已满，最多 8 人', STATE_CONFLICT: '房间状态已更新，请重新操作',
  PLAYBACK_TRANSITION_PENDING: '正在准备播放，请稍候', FILE_ONLY: '直播不能暂停或拖动进度', LIVE_ONLY: '当前音源不是系统推流', STALE_SOURCE: '音源已切换，请重新操作', PROVIDER_OFFLINE: '音源提供者已离线',
  INSUFFICIENT_BANDWIDTH: '带宽不足，请等待或主动选择有损模式', RELAY_BUDGET_EXHAUSTED: '服务器中继预算已用完',
  TURN_NOT_CONFIGURED: '服务器未配置 TURN 中继', TURN_PROVIDER_UNAVAILABLE: '公共 TURN 服务暂时不可用，请检查配置或稍后重试', TURN_INVALID_RESPONSE: 'TURN 服务返回了无效配置', INVALID_CREDENTIALS: '用户名或密码错误', NAME_TAKEN: '用户名已被使用',
  SESSION_EXPIRED: '会话已失效，请重新登录', TRACK_IN_USE: '当前音轨正在使用', SOURCE_IS_LOSSY: '原文件为有损音源，不能切换为无损',
  RATE_LIMITED: '操作过于频繁，请稍后再试', NO_SOURCE: '当前没有播放音源', UNSUPPORTED_AUDIO_SPEC: '首版支持双声道 16/24bit、44.1–96kHz 指定规格',
};
export const useApp = defineStore('app', () => {
  const user = ref<{ id: string; name: string } | null>(null), room = ref<RoomSnapshot | null>(null), connected = ref(false), notice = ref(''), native = ref(false), nativeReason = ref('');
  const stun = ref<{ checking: boolean; servers: { url: string; ok: boolean; error: string }[] }>({ checking: false, servers: [] });
  const media = ref({ status: 'idle', detail: '', bufferedMs: 0, driftMs: 0, receiveBps: 0 });
  const now = ref(Date.now()), offset = ref(0), busy = ref(false);
  let acceptEvents = true;
  let clockTimer: ReturnType<typeof setInterval> | undefined, initialized = false;
  const permission = computed(() => !!room.value && !!user.value && room.value.hostId === user.value.id ? ALL_PERMISSIONS : room.value?.members.find(m => m.id === user.value?.id)?.permissions ?? DEFAULT_PERMISSIONS);
  const host = computed(() => !!room.value && room.value.hostId === user.value?.id);
  const progress = computed(() => room.value ? positionAt(room.value.playback, now.value + offset.value) : 0);
  function error(e: unknown) { const code = e instanceof Error ? e.message : String(e); notice.value = code.startsWith('CAPTURE_RATE_OR_CHANNEL_MISMATCH') ? `采集格式与输出设备不匹配，请刷新音源面板的设备格式，或调整 Windows 输出设备设置。${code.slice(code.indexOf(':') + 1)}` : messages[code] ?? code; }
  async function initialize() {
    if (initialized) return; initialized = true;
    const cap = await bridge.capabilities(); native.value = cap.native; nativeReason.value = cap.reason;
    await bridge.subscribe('connection', e => { if (!acceptEvents) return; connected.value = e.connected; if (!e.connected) stun.value = { checking: false, servers: [] }; });
    await bridge.subscribe('stun-status', e => { if (!acceptEvents) return; stun.value = e; });
    await bridge.subscribe('media-status', e => { if (!acceptEvents) return; media.value = e; });
    await bridge.subscribe('clock-offset', e => { if (!acceptEvents) return; offset.value = e.offsetMs; });
    await bridge.subscribe('server-message', message => {
      if (!acceptEvents) return;
      if (message.type === 'snapshot') room.value = message.data;
      else if (message.type === 'error' || message.type === 'result' && !message.ok || message.type === 'admission' && !message.ok) error(message.error);
      else if (message.type === 'clock' && !bridge.desktop) {
        const received = Date.now(), roundTrip = received - message.clientSentAt - (message.serverSentAt - message.serverReceivedAt);
        if (roundTrip < 500) offset.value = ((message.serverReceivedAt - message.clientSentAt) + (message.serverSentAt - received)) / 2;
      }
    });
    clockTimer = setInterval(() => { now.value = Date.now(); }, 50);
    if (!bridge.desktop) setInterval(() => { if (connected.value) void bridge.send({ type: 'clock', requestId: crypto.randomUUID(), clientSentAt: Date.now() }).catch(error); }, 5000);
  }
  async function login(serverUrl: string, name: string, password: string, register: boolean) {
    acceptEvents = true; busy.value = true; notice.value = ''; try { user.value = (await bridge.login(serverUrl, name, password, register)).user; } catch (e) { error(e); } finally { busy.value = false; }
  }
  async function logout() {
    if (busy.value) return;
    busy.value = true; acceptEvents = false;
    try {
      await bridge.logout();
      user.value = null; room.value = null; connected.value = false; notice.value = ''; offset.value = 0;
      media.value = { status: 'idle', detail: '', bufferedMs: 0, driftMs: 0, receiveBps: 0 };
      stun.value = { checking: false, servers: [] };
    } catch (e) { acceptEvents = true; error(e); }
    finally { busy.value = false; }
  }
  async function act(action: Action) {
    if (!room.value || !connected.value) return error('控制连接未就绪');
    try { await bridge.command({ commandId: crypto.randomUUID(), roomId: room.value.id, expectedStateVersion: room.value.stateVersion, action }); } catch (e) { error(e); }
  }
  async function addFile(instant = false) { try { const track = await bridge.importFile(); await act({ type: instant ? 'instant' : 'enqueue', payload: track }); } catch (e) { if (String(e) !== 'Error: CANCELLED') error(e); } }
  async function exitRoom() {
    try {
      await bridge.leave(); room.value = null;
      media.value = { status: 'idle', detail: '', bufferedMs: 0, driftMs: 0, receiveBps: 0 };
    } catch (e) { error(e); }
  }
  return { user, room, connected, notice, native, nativeReason, media, stun, busy, host, permission, progress, offset, initialize, login, logout, act, addFile, exitRoom, error };
});
