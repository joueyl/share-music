import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { ALL_PERMISSIONS, DEFAULT_PERMISSIONS, positionAt, type Action, type ChatMessage, type RoomSnapshot } from '@music-share/shared';
import * as bridge from './bridge';
import { saveLogin, loadSavedLogin, clearSavedLogin } from './saved-login';
import { getServerUrl } from './server-config';
import { systemMediaAction, systemMediaState, type SystemMediaEvent } from './system-media';
const messages: Record<string, string> = {
  PLAYBACK_AUDIO_BUSY:'音频读取繁忙，请稍后切歌重试',
  PLAYBACK_WEB_SERVER_OUTDATED:'Web 播放需要新版音频读取接口，请先更新并重启服务端',
  UPLOADED_MUSIC_METADATA_MISSING:'该历史上传文件缺少音频参数，请重新添加原歌曲后再试',
  UPLOADED_MUSIC_NOT_FOUND:'OSS 中的音乐文件已不存在，无法加入播放列表',
  TRACK_NOT_FOUND:'音乐不存在，请刷新列表',PLAYLIST_FULL:'播放列表已满，最多 200 首',
  PLAYBACK_AUDIO_METADATA_INVALID: '音频缓存信息无效',
  PLAYBACK_AUDIO_INTEGRITY_FAILED: '音乐文件校验失败，请重新添加该歌曲',
  PLAYBACK_AUDIO_CACHE_READ_FAILED: '读取音乐缓存失败，请重试',
  PLAYBACK_AUDIO_CACHE_WRITE_FAILED: '音乐可正常播放，但缓存目录无法写入，下次可能需要重新下载',
  PLAYBACK_AUDIO_URL_INVALID: '播放地址无效，已阻止获取本地音频',
  PLAYBACK_AUDIO_DOWNLOAD_FAILED: '本地音频加载失败，请检查网络并重启客户端更新音频模块',
  PLAYBACK_AUDIO_TOO_LARGE: '音频超过本地播放的 100MB 限制',
  SAVED_LOGIN_UNSUPPORTED: '当前环境不支持安全保存密码，请手动登录',
  SAVED_LOGIN_INVALID: '保存的登录信息无效，请重新输入',
  SAVED_LOGIN_READ_FAILED: '无法读取系统保存的密码，请手动登录',
  SAVED_LOGIN_WRITE_FAILED: '登录成功，但无法保存密码，下次启动请手动登录',
  SAVED_LOGIN_DELETE_FAILED: '无法清除系统保存的密码，请重试退出登录',
  NETEASE_LOGIN_REQUIRED: '服务端网易云账号未登录，请管理员访问 /loginServe 扫码', NETEASE_UNAVAILABLE: '网易云服务暂不可用，请稍后重试',
  MUSIC_NOT_AVAILABLE: '当前账号无法获取这首歌曲的完整音源', MUSIC_TRIAL_ONLY: '这首歌曲仅能试听，不能上传完整音乐', MUSIC_AUDIO_UNSUPPORTED: '音源不是受支持的 MP3，暂无法添加',
  MUSIC_SOURCE_INVALID: '网易云返回的音源地址无效，已阻止下载', MUSIC_DOWNLOAD_FAILED: '服务端下载音乐失败，请稍后重试', MUSIC_TOO_LARGE: '音乐超过 100MB 限制', MUSIC_IMPORT_BUSY: '服务端正在处理其他音乐，请稍后重试', MUSIC_IMPORT_FAILED: '添加未完成，请重试',

  OSS_NOT_CONFIGURED: '服务端尚未配置 OSS 凭据或地域', OSS_INVALID_CONFIG: 'OSS 连接配置无效，请检查接入点与地域', OSS_ACCESS_POINT_INCOMPLETE: 'OSS 接入点域名和别名必须同时配置', OSS_UPLOAD_FAILED: 'OSS 上传失败，请检查网络、凭据及接入点授权',
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
  const webrtc = ref<Record<string, { roomId: string; peerId: string; sourceEpoch: number; status: string; detail: string }>>({});
  const chatMessages = ref<ChatMessage[]>([]);
  function currentConnection(event: { roomId: string; peerId: string; sourceEpoch: number }) {
    const current = room.value;
    return !!current && event.roomId === current.id &&
      [current.playback.sourceId ? current.playback.sourceEpoch : undefined, current.pending?.playback.sourceEpoch].includes(event.sourceEpoch) &&
      current.members.some(member => member.id === event.peerId && member.online);
  }
  const webrtcWarnings = computed(() => Object.values(webrtc.value).filter(event => currentConnection(event) && event.status !== 'connected'));
  const now = ref(Date.now()), offset = ref(0), busy = ref(false);
  let acceptEvents = true, clockSynced = false;
  function requestClock() { void bridge.send({ type: 'clock', requestId: crypto.randomUUID(), clientSentAt: Date.now() }).catch(error); }
  let clockTimer: ReturnType<typeof setInterval> | undefined, initialized = false;
  const permission = computed(() => !!room.value && !!user.value && room.value.hostId === user.value.id ? ALL_PERMISSIONS : room.value?.members.find(m => m.id === user.value?.id)?.permissions ?? DEFAULT_PERMISSIONS);
  const host = computed(() => !!room.value && room.value.hostId === user.value?.id);
  const progress = computed(() => room.value ? positionAt(room.value.playback, now.value + offset.value) : 0);
  let systemMediaActive=false,lastSystemMedia='';
  function syncSystemMedia() {
    if(!bridge.desktop||(!room.value&&!systemMediaActive))return;
    const state=systemMediaState(room.value,user.value?.id??null,connected.value,offset.value);
    systemMediaActive=!!room.value;
    const signature=JSON.stringify({...state,positionMs:Math.floor(state.positionMs/1000)*1000});if(signature===lastSystemMedia)return;lastSystemMedia=signature;
    void bridge.updateSystemMedia(state).catch(()=>{}); // Optional desktop integration must not interrupt playback.
  }
  watch(()=>[room.value?.id,room.value?.playback.sourceId,room.value?.playback.sourceEpoch,room.value?.playback.playState,!!room.value?.pending,connected.value,permission.value.skip,permission.value.seek],syncSystemMedia);
  function error(e: unknown) { const code = e instanceof Error ? e.message : String(e); notice.value = code.startsWith('CAPTURE_RATE_OR_CHANNEL_MISMATCH') ? `采集格式与输出设备不匹配，请刷新音源面板的设备格式，或调整 Windows 输出设备设置。${code.slice(code.indexOf(':') + 1)}` : messages[code] ?? code; }
  async function initialize() {
    if (initialized) return; initialized = true;
    const cap = await bridge.capabilities(); native.value = cap.native; nativeReason.value = cap.reason;
    await bridge.subscribe('connection', e => { if (!acceptEvents) return; connected.value = e.connected; if (e.connected) requestClock(); else {clearActionFeedback();stun.value = { checking: false, servers: [] };} });
    await bridge.subscribe('stun-status', e => { if (!acceptEvents) return; stun.value = e; });
    await bridge.subscribe('playback-cache-warning', e => { if (acceptEvents) error(e.error); });
    await bridge.subscribe('media-status', e => { if (!acceptEvents) return; media.value = e; });
    await bridge.subscribe('system-media-control', (event:SystemMediaEvent) => {
      if(!acceptEvents)return;
      const action=systemMediaAction(event,room.value,user.value?.id??null,connected.value);
      if(action)void act(action);
    });
    await bridge.subscribe('webrtc-status', event => {
      if (!acceptEvents || !currentConnection(event)) return;
      webrtc.value = { ...webrtc.value, [`${event.peerId}:${event.sourceEpoch}`]: event };
    });
    await bridge.subscribe('clock-offset', e => { if (!acceptEvents) return; offset.value = e.offsetMs; });
    await bridge.subscribe('server-message', message => {
      if (!acceptEvents) return;
      if(message.type==='result')finishAction(message.commandId);
      if (message.type === 'snapshot') {
        if (room.value?.id !== message.data.id) chatMessages.value = [];
        if (room.value?.id !== message.data.id) webrtc.value = {};
        if (!clockSynced && Number.isFinite(message.data.serverNow)) offset.value = message.data.serverNow - Date.now();
        room.value = message.data; void bridge.syncCloud(message.data, offset.value);
        webrtc.value = Object.fromEntries(Object.entries(webrtc.value).filter(([, event]) => currentConnection(event)));
      }
      else if (message.type === 'chat-history' && message.roomId === room.value?.id) chatMessages.value = message.messages.slice(-100);
      else if ((message.type === 'chat' || message.type === 'chat-result') && message.data.roomId === room.value?.id) {
        if (!chatMessages.value.some(m => m.id === message.data.id)) chatMessages.value = [...chatMessages.value, message.data].slice(-100);
      }
      else if (message.type === 'error' || message.type === 'result' && !message.ok || message.type === 'admission' && !message.ok) error(message.error);
      else if (message.type === 'clock') {
        const received = Date.now(), roundTrip = received - message.clientSentAt - (message.serverSentAt - message.serverReceivedAt);
        if (roundTrip >= 0 && roundTrip < 1000) {
          clockSynced = true;
          offset.value = ((message.serverReceivedAt - message.clientSentAt) + (message.serverSentAt - received)) / 2;
          if (room.value) void bridge.syncCloud(room.value, offset.value);
        }
      }
    });
    clockTimer = setInterval(() => { now.value = Date.now(); }, 50);
    setInterval(() => { if (connected.value) requestClock(); }, 5000);
    setInterval(syncSystemMedia,1000);
  }
  async function login(name: string, password: string, register: boolean, remember = false) {
    if (busy.value) return;
    acceptEvents = true; clockSynced = false; offset.value = 0; busy.value = true; notice.value = '';
    try {
      const serverUrl = getServerUrl();
      user.value = (await bridge.login(serverUrl, name, password, register)).user;
      // Persist only after authentication succeeds; never use browser storage for passwords.
      try {
        if (remember) await saveLogin({ serverUrl: new URL(serverUrl).origin, name, password });
        else await clearSavedLogin();
      } catch (e) { error(e); }
    } catch (e) {
      if ((e instanceof Error ? e.message : String(e)) === 'INVALID_CREDENTIALS') {
        try { await clearSavedLogin(); } catch { /* Preserve the authentication error. */ }
      }
      error(e);
    } finally { busy.value = false; }
  }
  async function restoreLogin() {
    const saved = await loadSavedLogin();
    if (!saved) return null;
    const serverUrl = getServerUrl();
    let savedOrigin = '';
    try { savedOrigin = new URL(saved.serverUrl).origin; } catch { /* Invalid or legacy credentials are not reused. */ }
    if (savedOrigin !== serverUrl) {
      notice.value = '当前环境的服务器已更改，请重新登录';
      return null;
    }
    await login(saved.name, saved.password, false, true);
    return { name: saved.name };
  }
  async function logout() {
    if (busy.value) return;
    busy.value = true; acceptEvents = false;clearActionFeedback();
    try {
      await clearSavedLogin();
      await bridge.logout();
      user.value = null; room.value = null; connected.value = false; notice.value = ''; offset.value = 0;
      chatMessages.value = [];
      media.value = { status: 'idle', detail: '', bufferedMs: 0, driftMs: 0, receiveBps: 0 };
      webrtc.value = {};
      stun.value = { checking: false, servers: [] };
    } catch (e) { acceptEvents = true; error(e); }
    finally { busy.value = false; }
  }
  async function act(action: Action) {
    if (!room.value || !connected.value) return error('控制连接未就绪');
    const commandId=crypto.randomUUID();
    actionTimers.set(commandId,setTimeout(()=>finishAction(commandId),15000));
    pendingActions.value++;
    try { await bridge.command({ commandId, roomId: room.value.id, expectedStateVersion: room.value.stateVersion, action }); } catch (e) { finishAction(commandId);error(e); }
  }
  const pendingActions=ref(0);
  const actionTimers=new Map<string,ReturnType<typeof setTimeout>>();
  function finishAction(id:string){const timer=actionTimers.get(id);if(timer===undefined)return;clearTimeout(timer);actionTimers.delete(id);pendingActions.value=actionTimers.size;}
  function clearActionFeedback(){for(const timer of actionTimers.values())clearTimeout(timer);actionTimers.clear();pendingActions.value=0;}
  async function addFile(instant = false) { try { const track = await bridge.importFile(); await act({ type: instant ? 'instant' : 'enqueue', payload: track }); } catch (e) { if (String(e) !== 'Error: CANCELLED') error(e); } }
  async function exitRoom() {
    try {
      await bridge.leave(); clearActionFeedback();room.value = null; chatMessages.value = [];
      webrtc.value = {};
      media.value = { status: 'idle', detail: '', bufferedMs: 0, driftMs: 0, receiveBps: 0 };
    } catch (e) { error(e); }
  }
  return { user, room, chatMessages, connected, notice, native, nativeReason, media, stun, webrtcWarnings, busy, pendingActions, host, permission, progress, offset, initialize, login, restoreLogin, logout, act, addFile, exitRoom, error };
});
