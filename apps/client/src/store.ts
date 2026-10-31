import { createChatAlerts } from './chat-alerts';
import { createChatSound } from './chat-sound';
import chatNotificationSound from './assets/chat-notification.wav?url';
import { computed, onScopeDispose, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { ALL_PERMISSIONS, DEFAULT_PERMISSIONS, positionAt, type Action, type ChatMessage, type RoomSnapshot } from '@music-share/shared';
import * as bridge from './bridge';
import { saveLogin, loadSavedLogin, clearSavedLogin } from './saved-login';
import { getServerUrl } from './server-config';
import { trackArtwork } from './track-artwork';
import { createSystemArtworkSync, systemArtworkPixels, type ArtworkRequest } from './system-artwork';
import { systemMediaAction, systemMediaState, type SystemMediaEvent } from './system-media';
const messages: Record<string, string> = {
  CHAT_NOTIFICATION_FAILED:'系统通知请求失败，请检查系统通知设置',
  CHAT_ATTENTION_FAILED:'任务栏提醒请求失败，系统可能不支持此提示方式',
  CHAT_NOTIFICATION_SOUND_FAILED:'消息提示音未能播放，请在窗口内点击一次并检查系统音量',
  PLAYBACK_AUDIO_BUSY:'音频读取繁忙，请稍后切歌重试',
  PLAYBACK_WEB_SERVER_OUTDATED:'Web 播放需要新版音频读取接口，请先更新并重启服务端',
  UPLOADED_MUSIC_METADATA_MISSING:'该历史上传文件缺少音频参数，请重新添加原歌曲后再试',
  MUSIC_LINK_EXPIRED:'音乐链接已失效且刷新失败，请稍后重试',
  MUSIC_CONTENT_CHANGED:'音源内容已变化，请重新添加该歌曲',
  MUSIC_SOURCE_UNREFRESHABLE:'历史记录没有可续期的歌曲来源，请重新搜索添加',
  LOCAL_UPLOAD_NOT_SUPPORTED:'本地文件云上传已停用，请从音乐搜索或音乐库添加',
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
  MUSIC_NOT_AVAILABLE: '当前账号无法获取这首歌曲的完整音源', MUSIC_TRIAL_ONLY: '这首歌曲仅能试听，不能添加完整音源', MUSIC_AUDIO_UNSUPPORTED: '音源不是受支持的 MP3，暂无法添加',
  MUSIC_SOURCE_INVALID: '网易云返回的音源地址无效，已阻止下载', MUSIC_DOWNLOAD_FAILED: '服务端下载音乐失败，请稍后重试', MUSIC_TOO_LARGE: '音乐超过 100MB 限制', MUSIC_IMPORT_BUSY: '服务端正在处理其他音乐，请稍后重试', MUSIC_IMPORT_FAILED: '添加未完成，请重试',

  FORBIDDEN: '没有此操作权限', HOST_ONLY: '仅房主可操作', ROOM_FULL: '房间已满，最多 8 人', STATE_CONFLICT: '房间状态已更新，请重新操作',
  PLAYBACK_TRANSITION_PENDING: '正在准备播放，请稍候', FILE_ONLY: '直播不能暂停或拖动进度', LIVE_ONLY: '当前音源不是系统推流', STALE_SOURCE: '音源已切换，请重新操作', PROVIDER_OFFLINE: '音源提供者已离线',
  INSUFFICIENT_BANDWIDTH: '带宽不足，请等待或主动选择有损模式', RELAY_BUDGET_EXHAUSTED: '服务器中继预算已用完',
  TURN_NOT_CONFIGURED: '服务器未配置 TURN 中继', TURN_PROVIDER_UNAVAILABLE: '公共 TURN 服务暂时不可用，请检查配置或稍后重试', TURN_INVALID_RESPONSE: 'TURN 服务返回了无效配置', INVALID_CREDENTIALS: '用户名或密码错误', NAME_TAKEN: '用户名已被使用',
  SESSION_EXPIRED: '会话已失效，请重新登录', TRACK_IN_USE: '当前音轨正在使用', SOURCE_IS_LOSSY: '原文件为有损音源，不能切换为无损',
  RATE_LIMITED: '操作过于频繁，请稍后再试', NO_SOURCE: '当前没有播放音源', UNSUPPORTED_AUDIO_SPEC: '首版支持双声道 16/24bit、44.1–96kHz 指定规格',
};
export const useApp = defineStore('app', () => {
  const user = ref<{ id: string; name: string } | null>(null), room = ref<RoomSnapshot | null>(null), connected = ref(false), notice = ref(''), native = ref(false), nativeReason = ref('');
  const media = ref({ status: 'idle', detail: '', bufferedMs: 0, driftMs: 0, receiveBps: 0 });
  const chatMessages = ref<ChatMessage[]>([]);
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
  const syncArtwork=createSystemArtworkSync(source=>systemArtworkPixels(source,bridge.loadSystemArtwork),bridge.updateTaskbarArtwork);
  watch(():ArtworkRequest|null=>{
    if(!bridge.taskbarArtworkAvailable||!connected.value||!room.value||room.value.playback.playState==='stopped')return null;
    const track=room.value.playlist.find(item=>item.id===room.value!.playback.sourceId);
    if(!track)return null;
    return {roomId:room.value.id,trackId:track.id,sourceEpoch:room.value.playback.sourceEpoch,source:trackArtwork(getServerUrl(),track)||null};
  },request=>{void syncArtwork(request);});
  function error(e: unknown) { const code = e instanceof Error ? e.message : String(e); notice.value = code.startsWith('CAPTURE_RATE_OR_CHANNEL_MISMATCH') ? `采集格式与输出设备不匹配，请刷新音源面板的设备格式，或调整 Windows 输出设备设置。${code.slice(code.indexOf(':') + 1)}` : messages[code] ?? code; }
  const chatSound=createChatSound(chatNotificationSound);
  const chatAlerts=createChatAlerts({desktop:bridge.desktop,context:()=>acceptEvents&&room.value&&user.value?{roomId:room.value.id,userId:user.value.id,roomName:room.value.name}:null,notify:bridge.notifyChat,clearAttention:bridge.clearChatAttention,sound:chatSound,error});
  watch(()=>[room.value?.id,user.value?.id],()=>chatAlerts.reset(),{flush:'sync'});
  const unlockChatSound=()=>chatSound.unlock();
  onScopeDispose(()=>{chatAlerts.reset();chatSound.dispose();if(typeof window!=='undefined'){window.removeEventListener?.('pointerdown',unlockChatSound,true);window.removeEventListener?.('keydown',unlockChatSound,true);}});
  async function initialize() {
    if (initialized) return; initialized = true;
    if(bridge.desktop&&typeof window!=='undefined'){
      window.addEventListener?.('pointerdown',unlockChatSound,true);
      window.addEventListener?.('keydown',unlockChatSound,true);
    }
    const cap = await bridge.capabilities(); native.value = cap.native; nativeReason.value = cap.reason;
    await bridge.subscribe('connection', e => { if (!acceptEvents) return; connected.value = e.connected; if (e.connected) requestClock(); else clearActionFeedback(); });
    await bridge.subscribe('playback-cache-warning', e => { if (acceptEvents) error(e.error); });
    await bridge.subscribe('media-status', e => { if (!acceptEvents) return; media.value = e; });
    await bridge.subscribe('system-media-control', (event:SystemMediaEvent) => {
      if(!acceptEvents)return;
      const action=systemMediaAction(event,room.value,user.value?.id??null,connected.value);
      if(action)void act(action);
    });
    await bridge.subscribe('clock-offset', e => { if (!acceptEvents) return; offset.value = e.offsetMs; });
    await bridge.subscribe('server-message', message => {
      if (!acceptEvents) return;
      if(message.type==='result')finishAction(message.commandId);
      if (message.type === 'snapshot') {
        if (room.value?.id !== message.data.id) chatMessages.value = [];
        if (!clockSynced && Number.isFinite(message.data.serverNow)) offset.value = message.data.serverNow - Date.now();
        room.value = message.data; void bridge.syncCloud(message.data, offset.value);
      }
      else if (message.type === 'chat-history' && message.roomId === room.value?.id) {chatMessages.value = message.messages.slice(-100);chatAlerts.seed(message.messages);}
      else if ((message.type === 'chat' || message.type === 'chat-result') && message.data.roomId === room.value?.id) {
        if (!chatMessages.value.some(m => m.id === message.data.id)) {chatMessages.value = [...chatMessages.value, message.data].slice(-100);if(message.type==='chat')chatAlerts.receive(message.data);}
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
    busy.value = true; acceptEvents = false;clearActionFeedback();chatAlerts.reset();
    try {
      await clearSavedLogin();
      await bridge.logout();
      user.value = null; room.value = null; connected.value = false; notice.value = ''; offset.value = 0;
      chatMessages.value = [];
      media.value = { status: 'idle', detail: '', bufferedMs: 0, driftMs: 0, receiveBps: 0 };
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
    chatAlerts.reset();
    try {
      await bridge.leave(); clearActionFeedback();room.value = null; chatMessages.value = [];
      media.value = { status: 'idle', detail: '', bufferedMs: 0, driftMs: 0, receiveBps: 0 };
    } catch (e) { error(e); }
  }
  return { user, room, chatMessages, connected, notice, native, nativeReason, media, busy, pendingActions, host, permission, progress, offset, initialize, login, restoreLogin, logout, act, addFile, exitRoom, error };
});
