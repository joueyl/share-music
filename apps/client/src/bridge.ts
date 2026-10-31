import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { apiResponse } from './api-response';
import { CloudPlayer } from './cloud-player';
import { AudioWaveform, releaseWaveformAudio } from './audio-waveform';
import { loadPlaybackSource } from './playback-source';
import { rememberTrackArtwork, trackArtwork } from './track-artwork';
import { normalizeAlbumCover, parsePlaylistLink, isPlaylistShortLink, playlistReference } from '@music-share/shared';
import type { SystemMediaState } from './system-media';
import type { ArtworkFrame } from './system-artwork';
import { listen } from '@tauri-apps/api/event';
import type { ChatMessage, Command, RoomSnapshot, TrackMetadata } from '@music-share/shared';
type Listener = (event: any) => void;
let socket: WebSocket | undefined, token = '', base = '', joinedRoom: string | null = null;
let browserGeneration = 0, reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let roomLeft = false;
const pendingChats = new Set<(error: Error) => void>();
function cancelChats(code: string) { for (const reject of pendingChats) reject(new Error(code)); }
const listeners = new Map<string, Set<Listener>>();
function emit(name: string, value: unknown) { listeners.get(name)?.forEach(fn => fn(value)); }
async function browserRequest(path: string, body?: unknown, signal?: AbortSignal, method?: 'POST' | 'PUT') {
  const res = await fetch(base + '/api' + path, { ...(signal ? { signal } : {}), method: method ?? (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token && path !== '/login' ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return apiResponse(res);
}
export async function subscribe(name: string, handler: Listener) {
  const receive = handler;
  handler = event => {
    if (roomLeft && (name === 'media-status' && event.status !== 'idle' || name === 'server-message' && ['snapshot', 'signal', 'admission', 'chat', 'chat-result', 'chat-history'].includes(event.type))) return;
    receive(event);
  };
  if (isTauri() && !['connection','server-message','media-status'].includes(name)) return listen(name, e => handler(e.payload));
  const nativeUnsubscribe = isTauri() ? await listen(name, e => handler(e.payload)) : undefined;
  const set = listeners.get(name) ?? new Set(); set.add(handler); listeners.set(name, set); return () => { set.delete(handler); nativeUnsubscribe?.(); };
}
export const desktop = isTauri();
if (desktop) {
  getCurrentWindow().setShadow(false).catch(() => {});
}
export async function windowMinimize() { if (desktop) await invoke('window_minimize'); }
export async function windowToggleMaximize() { if (desktop) await invoke('window_toggle_maximize'); }
export async function windowClose() { if (desktop) await invoke('window_close'); }
export async function startDragging() { if (desktop) await invoke('start_dragging'); }
export async function isWindowMaximized(): Promise<boolean> {
  if (!desktop) return false;
  try {
    return await getCurrentWindow().isMaximized();
  } catch {
    return false;
  }
}
export async function onWindowResized(callback: () => void): Promise<(() => void) | undefined> {
  if (!desktop) return undefined;
  try {
    return await getCurrentWindow().onResized(callback);
  } catch {
    return undefined;
  }
}
export async function notifyChat(payload:import('./chat-alerts').ChatAlertPayload) {
  return invoke<import('./chat-alerts').ChatAlertResult>('send_chat_notification',{...payload});
}
export async function clearChatAttention() { if(desktop)await invoke('clear_chat_attention'); }
export const taskbarArtworkAvailable=desktop&&typeof navigator!=='undefined'&&/Windows/i.test(navigator.userAgent);
export async function loadSystemArtwork(url:string) { return invoke<ArrayBuffer|number[]>('load_system_artwork',{url}); }
export async function updateTaskbarArtwork(artwork:ArtworkFrame) { if(desktop)await invoke('update_taskbar_artwork',{artwork}); }
export async function updateSystemMedia(state:SystemMediaState) { if(desktop)await invoke('update_system_media',{snapshot:state}); }
export async function login(serverUrl: string, name: string, password: string, register: boolean): Promise<{ user: { id: string; name: string } }> {
  cancelChats('SESSION_EXPIRED');
  roomLeft = false;


  const url = new URL(serverUrl); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('服务器地址无效');
  const generation = ++browserGeneration; clearTimeout(reconnectTimer);
  base = url.origin; const data = await browserRequest('/login', { name, password, register });
  if (generation !== browserGeneration) throw new Error('LOGIN_CANCELLED');
  token = data.token; socket?.close(); joinedRoom = null;
  connectBrowser(); return { user: data.user };
}
function connectBrowser() {
  if (!token) return;
  const generation = browserGeneration;
  const current = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
  socket = current;
  const active = () => generation === browserGeneration && current === socket && !!token;
  current.onopen = () => { if (active()) current.send(JSON.stringify({ type: 'auth', token })); };
  current.onmessage = event => {
    if (!active()) return;
    const message = JSON.parse(event.data);
    if (message.type === 'authenticated') { emit('connection', { connected: true }); if (joinedRoom) current.send(JSON.stringify({ type: 'join', roomId: joinedRoom })); }
    else emit('server-message', message);
  };
  current.onclose = event => {
    if (!active()) return;
    cancelChats('CHAT_DISCONNECTED');
    audio?.pause(); emit('connection', { connected: false });
    if (event.code === 4001 || event.code === 4009) { emit('server-message', { type: 'error', error: 'SESSION_EXPIRED' }); return; }
    reconnectTimer = setTimeout(() => { if (active()) connectBrowser(); }, 2000);
  };
}
export async function logout(): Promise<void> {
  cancelChats('SESSION_EXPIRED');
  clearCloud();
  if (desktop) await invoke('logout');
  ++browserGeneration;
  clearTimeout(reconnectTimer); reconnectTimer = undefined;
  token = ''; base = ''; joinedRoom = null;
  const previous = socket; socket = undefined;
  previous?.close(1000, 'Logout');
  audio?.pause(); emit('connection', { connected: false });
}

export type RoomSettings = NonNullable<RoomSnapshot['settings']>;
export type RoomSummary = { id: string; name: string; hostId: string; settings: RoomSettings; members: number; maxMembers: number; qualityMode: string };
export async function listRooms(keywords = '', category = ''): Promise<RoomSummary[]> {
  return browserRequest('/rooms?' + new URLSearchParams({ keywords: keywords.trim(), category }));
}
export async function createRoom(name: string, settings?: Partial<RoomSettings>, defaults?: RoomSnapshot['defaults']): Promise<RoomSnapshot> {
  return browserRequest('/rooms', { name: name.trim(), ...(settings ? { settings } : {}), ...(defaults ? { defaults } : {}) });
}
export async function resolveRoom(code: string): Promise<{ id: string; name: string }> {
  return browserRequest('/rooms/resolve/' + encodeURIComponent(code.trim()));
}
export async function updateRoomSettings(room: RoomSnapshot, name: string, settings: RoomSettings): Promise<RoomSnapshot> {
  return browserRequest(`/rooms/${room.id}/settings`, { expectedStateVersion: room.stateVersion, name: name.trim(), settings }, undefined, 'PUT');
}
export async function send(message: unknown): Promise<void> {

  if (socket?.readyState !== WebSocket.OPEN) throw new Error('控制连接未就绪');
  socket.send(JSON.stringify(message));
}
export async function join(roomId: string): Promise<void> {
  cancelChats('NOT_IN_ROOM');
  roomLeft = false;
  let unsubscribe: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>(async (resolve, reject) => {
      try {
        unsubscribe = await subscribe('server-message', message => {
          if (message.type === 'snapshot' && message.data.id === roomId) resolve();
          else if (message.type === 'error') reject(new Error(message.error));
        });
        timer = setTimeout(() => reject(new Error('加入房间超时，请检查连接')), 8000);
        await send({ type: 'join', roomId }); joinedRoom = roomId;
      } catch (e) { reject(e); }
    });
  } finally { clearTimeout(timer); unsubscribe?.(); }
}
export async function leave() {
  cancelChats('NOT_IN_ROOM');
  roomLeft = true; joinedRoom = null;
  clearCloud();
  if (socket?.readyState === WebSocket.OPEN) await send({ type: 'leave' });
}
export async function command(data: Command) { return send({ type: 'command', data }); }
export async function sendChat(roomId: string, text: string, requestId: string): Promise<ChatMessage> {
  let unsubscribe: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: ((error: Error) => void) | undefined;
  try {
    let resolve!: (message: ChatMessage) => void, reject!: (error: Error) => void;
    const response = new Promise<ChatMessage>((yes, no) => { resolve = yes; reject = no; });
    // Observe cancellation even while the native event subscription is being installed.
    void response.catch(() => {});
    let cancelled = false;
    cancel = error => { cancelled = true; reject(error); }; pendingChats.add(cancel);
    const generation = browserGeneration, current = socket;
    unsubscribe = await subscribe('server-message', message => {
      if (message.type === 'chat' && message.data.roomId === roomId && message.data.requestId === requestId) resolve(message.data);
      if (message.type === 'chat-result' && message.requestId === requestId && message.data.roomId === roomId && message.data.requestId === requestId) resolve(message.data);
      if (message.type === 'chat-error' && message.requestId === requestId) reject(new Error(message.error));
      // Older deployments reply with an uncorrelated protocol error instead of chat-error.
      if (message.type === 'error' && ['UNKNOWN_MESSAGE', 'INVALID_REQUEST', 'NOT_IN_ROOM', 'UNAUTHORIZED', 'SESSION_EXPIRED', 'RATE_LIMITED'].includes(message.error)) {
        reject(new Error(message.error === 'UNKNOWN_MESSAGE' ? 'CHAT_UNSUPPORTED' : message.error));
      }
    });
    timer = setTimeout(() => reject(new Error('聊天消息发送超时，尚未收到确认；可重试，若持续失败请检查服务端聊天版本')), 8000);
    // Handle synchronous send failures through the same promise to avoid orphaned rejections.
    if (cancelled) { /* Do not send after leaving or changing sessions during subscription. */ }
    else if (generation !== browserGeneration || current !== socket) reject(new Error('SESSION_EXPIRED'));
    else if (roomLeft) reject(new Error('NOT_IN_ROOM'));
    else void send({ type: 'chat', roomId, requestId, text }).catch(reject);
    return await response;
  } finally { clearTimeout(timer); unsubscribe?.(); if (cancel) pendingChats.delete(cancel); }
}
export async function importFile(): Promise<TrackMetadata> {
 throw new Error('本地文件云上传已停用，请从音乐搜索或音乐库添加歌曲');
}
export async function setVolume(volume: number) { if (audio) audio.volume=volume; }
export async function capabilities(): Promise<{ native: boolean; reason: string; capture: boolean }> { return desktop ? invoke('media_capabilities') : { native: false, capture: false, reason: '音乐直链播放与 WebSocket 同步' }; }

let audio = typeof Audio === 'undefined' ? null : new Audio();
export function createPlaybackWaveform() { return audio ? new AudioWaveform(() => audio) : null; }
function replacePlaybackAudio(previous: HTMLAudioElement) {
  const next = new Audio(); next.volume = previous.volume; next.muted = previous.muted; next.playbackRate = previous.playbackRate;
  releaseWaveformAudio(previous); previous.removeAttribute('src'); previous.load();
  audio = next; return next;
}
const cloudPlayer = audio ? new CloudPlayer(audio,
  async (roomId, trackId, track) => loadPlaybackSource(async (refresh=false) => await browserRequest(`/rooms/${roomId}/music/${trackId}`+(refresh?'?refresh=1':'')), desktop, track,
    current=>browserAudio(roomId,trackId,current)),
  send, emit, Date.now, replacePlaybackAudio) : null;
export async function browserAudio(roomId:string,trackId:string,track:Pick<TrackMetadata,'sizeBytes'>):Promise<ArrayBuffer>{
 if(!Number.isSafeInteger(track.sizeBytes)||track.sizeBytes<1||track.sizeBytes>100*1024*1024)throw new Error('PLAYBACK_AUDIO_TOO_LARGE');
 let response:Response;
 try{response=await fetch(base+`/api/rooms/${roomId}/music/${trackId}/audio`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(75000),cache:'no-store'});}
 catch{throw new Error('PLAYBACK_AUDIO_DOWNLOAD_FAILED');}
 if(response.status===404)throw new Error('PLAYBACK_WEB_SERVER_OUTDATED');
 if(!response.ok){await apiResponse(response);throw new Error('PLAYBACK_AUDIO_DOWNLOAD_FAILED');}
 const reader=response.body?.getReader();if(!reader)throw new Error('PLAYBACK_AUDIO_DOWNLOAD_FAILED');
 const parts:Uint8Array<ArrayBuffer>[]=[],expected=track.sizeBytes;let size=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
   if(size>expected)throw new Error('PLAYBACK_AUDIO_INTEGRITY_FAILED');parts.push(new Uint8Array(value));
  }
 }finally{await reader.cancel().catch(()=>{});}
 if(size!==expected)throw new Error('PLAYBACK_AUDIO_INTEGRITY_FAILED');
 const data=await new Blob(parts).arrayBuffer();
 return data;
}
function clearCloud() { cloudPlayer?.clear(); }
export async function syncCloud(room: RoomSnapshot, clockOffset: number) {
  if (room.playlist) await cloudPlayer?.sync(room, clockOffset);
}
setInterval(() => { if (socket?.readyState === WebSocket.OPEN) cloudPlayer?.tick(); }, 100);

export type MusicSearchItem = { id: string; name: string; artists: string; album: string; coverUrl: string; durationMs: number };
export type UploadedMusicItem = Omit<MusicSearchItem,'durationMs'> & {durationMs:number|null;sizeBytes:number|null;canAdd?:boolean};
export async function addUploadedMusic(roomId:string,hash:string,requestId:string):Promise<TrackMetadata> {
 const result=await browserRequest(`/rooms/${roomId}/music/uploaded`,{hash,requestId});
 if(!result.ok||!result.track?.sourceUrl)throw new Error('MUSIC_IMPORT_FAILED');
 rememberTrackArtwork(base,result.track.contentHash,albumCover(result.track.coverUrl));
 return result.track;
}
export async function uploadedMusic(keywords='',offset=0,signal?:AbortSignal):Promise<{songs:UploadedMusicItem[];total:number}> {
 return browserRequest('/music/uploaded?'+new URLSearchParams({keywords:keywords.trim(),offset:String(offset),limit:'20'}),undefined,signal);
}
function albumCover(value: unknown): string {
 return normalizeAlbumCover(value)??'';
}
export async function searchMusic(keywords: string, offset = 0): Promise<{ songs: MusicSearchItem[]; total: number }> {
 const query = new URLSearchParams({keywords:keywords.trim(),type:'1',limit:'20',offset:String(offset)});
 const data = await browserRequest('/netease/cloudsearch?' + query);
 if(data.code!==200) throw new Error(data.code===301?'NETEASE_LOGIN_REQUIRED':'NETEASE_UNAVAILABLE');
 const songs = (data.result?.songs ?? []).map((s:any)=>({id:String(s.id),name:String(s.name??''),artists:(s.ar??s.artists??[]).map((a:any)=>a.name).join(' / '),album:String(s.al?.name??s.album?.name??''),coverUrl:albumCover(s.al?.picUrl??s.album?.picUrl),durationMs:Number(s.dt??s.duration??0)}));
 return {songs,total:Number(data.result?.songCount??songs.length)};
}
export async function addSearchedMusic(roomId:string,songId:string,requestId:string,coverUrl?:string) {
 const result = await browserRequest(`/rooms/${roomId}/music/netease`,{songId,requestId});
 if(!result.ok || !result.track?.sourceUrl)throw new Error('MUSIC_IMPORT_FAILED');
 rememberTrackArtwork(base,result.track.contentHash,albumCover(result.track.coverUrl)||coverUrl);
 return result.track as TrackMetadata;
}
export function playingTrackCover(track:TrackMetadata|null|undefined) { return trackArtwork(base,track); }
export async function loadTrackCover(roomId:string,track:TrackMetadata):Promise<string> {
 const known=playingTrackCover(track);if(known)return known;
 try{
  const data=await browserRequest(`/rooms/${roomId}/music/${track.id}/cover`);
  const cover=albumCover(data.coverUrl);rememberTrackArtwork(base,track.contentHash,cover);return cover;
 }catch{return '';}// Older servers may lack the backfill endpoint; never interrupt playback.
}

export async function suggestMusic(keywords:string,signal?:AbortSignal):Promise<string[]> {
 const term=keywords.trim();if(!term)return [];
 const query=new URLSearchParams({keywords:term,type:'mobile'});
 const data=await browserRequest('/netease/search_suggest?'+query,undefined,signal);
 if(data.code!==200)throw new Error('NETEASE_UNAVAILABLE');
 const items=Array.isArray(data.result?.allMatch)?data.result.allMatch:[];
 return [...new Set<string>(items.map((item:any)=>item.keyword).filter((s:unknown):s is string=>typeof s==='string'&&!!s.trim()&&s.length<=100).map((s:string)=>s.trim()))].slice(0,8);
}

function checkMusicResult(data:any) { if(data.code!==200)throw new Error(data.code===301?'NETEASE_LOGIN_REQUIRED':'NETEASE_UNAVAILABLE');return data; }
function musicItem(song:any):MusicSearchItem {
  return {id:String(song.id),name:String(song.name??''),artists:(song.ar??song.artists??[]).map((a:any)=>a.name).join(' / '),album:String(song.al?.name??song.album?.name??''),coverUrl:albumCover(song.al?.picUrl??song.album?.picUrl),durationMs:Number(song.dt??song.duration??0)};
}
export async function similarMusic(id:string,signal?:AbortSignal):Promise<MusicSearchItem[]> {
  if(!/^\d{1,20}$/.test(id))throw new Error('INVALID_REQUEST');
  const data=checkMusicResult(await browserRequest('/netease/simi_song?'+new URLSearchParams({id,limit:'12',offset:'0'}),undefined,signal));
  const seen=new Set([id]);
  return (Array.isArray(data.songs)?data.songs:[]).map(musicItem).filter((song:MusicSearchItem)=>{
    if(!/^\d{1,20}$/.test(song.id)||!song.name.trim()||seen.has(song.id))return false;
    seen.add(song.id);return true;
  });
}
export type MusicPlaylist={id:string;name:string;coverUrl:string;trackCount:number;creatorId:string};
function playlistItem(p:any):MusicPlaylist { return {id:String(p.id),name:String(p.name??''),coverUrl:albumCover(p.coverImgUrl),trackCount:Number(p.trackCount??0),creatorId:String(p.creator?.userId??'')}; }
export async function resolvePlaylistLink(input:string):Promise<{id:string}> {
  try{return {id:parsePlaylistLink(input).id};}catch(error){
    if(!isPlaylistShortLink(input))throw error;
  }
  let result:any;
  try{result=await browserRequest('/music/playlist/resolve',{input:playlistReference(input)});}
  catch(error){const code=error instanceof Error?error.message:String(error);if(code==='HTTP 404'||code==='服务器返回非 JSON 响应（HTTP 404）')throw new Error('PLAYLIST_LINK_ENDPOINT_UNAVAILABLE');throw error;}
  if(typeof result?.id!=='string'||!/^\d{1,20}$/.test(result.id))throw new Error('PLAYLIST_LINK_RESOLVE_FAILED');
  return {id:result.id};
}
export async function playlistDetail(id:string):Promise<MusicPlaylist> {
  const data=checkMusicResult(await browserRequest('/netease/playlist_detail?'+new URLSearchParams({id})));return playlistItem(data.playlist);
}
export async function userPlaylists(uid:string,offset=0):Promise<{playlists:MusicPlaylist[];more:boolean}> {
  const data=checkMusicResult(await browserRequest('/netease/user_playlist?'+new URLSearchParams({uid,offset:String(offset),limit:'30'})));
  return {playlists:(data.playlist??[]).map(playlistItem),more:!!data.more};
}
export async function playlistSongs(id:string,offset=0):Promise<MusicSearchItem[]> {
  const data=checkMusicResult(await browserRequest('/netease/playlist_track_all?'+new URLSearchParams({id,offset:String(offset),limit:'50'})));return (data.songs??[]).map(musicItem);
}
export async function trackMetadata(roomId:string,trackId:string):Promise<TrackMetadata> { return browserRequest(`/rooms/${roomId}/music/${trackId}/metadata`); }
export async function songLyrics(id:string,signal?:AbortSignal) {
  return checkMusicResult(await browserRequest('/netease/lyric_new?'+new URLSearchParams({id}),undefined,signal));
}
export async function playMusic(roomId:string,trackId:string,requestId:string) { return browserRequest(`/rooms/${roomId}/music/play`,{trackId,requestId}); }
