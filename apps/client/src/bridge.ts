import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Command, RoomSnapshot, TrackMetadata } from '@music-share/shared';
type Listener = (event: any) => void;
let socket: WebSocket | undefined, token = '', base = '', joinedRoom: string | null = null;
let browserGeneration = 0, reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let roomLeft = false;
const listeners = new Map<string, Set<Listener>>();
function emit(name: string, value: unknown) { listeners.get(name)?.forEach(fn => fn(value)); }
async function browserRequest(path: string, body?: unknown) {
  const res = await fetch(base + '/api' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token && path !== '/login' ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await res.json(); if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`); return data;
}
export async function subscribe(name: string, handler: Listener) {
  const receive = handler;
  handler = event => {
    if (roomLeft && (name === 'media-status' && event.status !== 'idle' || name === 'server-message' && ['snapshot', 'signal', 'admission'].includes(event.type))) return;
    receive(event);
  };
  if (isTauri()) return listen(name, e => handler(e.payload));
  const set = listeners.get(name) ?? new Set(); set.add(handler); listeners.set(name, set); return () => set.delete(handler);
}
export const desktop = isTauri();
export async function login(serverUrl: string, name: string, password: string, register: boolean): Promise<{ user: { id: string; name: string } }> {
  roomLeft = false;
  if (desktop) return invoke('login', { serverUrl, name, password, register });
  if (!import.meta.env.DEV) throw new Error('请使用 Tauri 桌面客户端');
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
    emit('connection', { connected: false });
    if (event.code === 4001 || event.code === 4009) { emit('server-message', { type: 'error', error: 'SESSION_EXPIRED' }); return; }
    reconnectTimer = setTimeout(() => { if (active()) connectBrowser(); }, 2000);
  };
}
export async function logout(): Promise<void> {
  if (desktop) return invoke('logout');
  ++browserGeneration;
  clearTimeout(reconnectTimer); reconnectTimer = undefined;
  token = ''; base = ''; joinedRoom = null;
  const previous = socket; socket = undefined;
  previous?.close(1000, 'Logout');
  emit('connection', { connected: false });
}

export async function listRooms(): Promise<{ id: string; name: string; members: number; maxMembers: number; qualityMode: string }[]> { return desktop ? invoke('list_rooms') : browserRequest('/rooms'); }
export async function createRoom(name: string): Promise<RoomSnapshot> { return desktop ? invoke('create_room', { name }) : browserRequest('/rooms', { name }); }
export async function send(message: unknown): Promise<void> {
  if (desktop) return invoke('send_control', { message });
  if (socket?.readyState !== WebSocket.OPEN) throw new Error('控制连接未就绪');
  socket.send(JSON.stringify(message));
}
export async function join(roomId: string): Promise<void> {
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
        if (desktop) await invoke('join_room', { roomId });
        else { await send({ type: 'join', roomId }); joinedRoom = roomId; }
      } catch (e) { reject(e); }
    });
  } finally { clearTimeout(timer); unsubscribe?.(); }
}
export async function leave() {
  roomLeft = true; joinedRoom = null;
  if (desktop) return invoke('leave_room');
  if (socket?.readyState === WebSocket.OPEN) await send({ type: 'leave' });
}
export async function command(data: Command) { return send({ type: 'command', data }); }
export async function importFile(): Promise<TrackMetadata> { if (!desktop) throw new Error('浏览器预览不支持音频，请使用桌面客户端'); return invoke('import_file'); }
export type CaptureDevice = { id: string; name: string; isDefault?: boolean; sampleRate?: number; channels?: number; deviceBits?: number; captureBits?: number; integerConversion?: boolean; supported?: boolean };
export async function devices(): Promise<CaptureDevice[]> { return desktop ? invoke('capture_devices') : []; }
export async function selectDevice(deviceId: string) { if (!desktop) throw new Error('请使用桌面客户端'); return invoke('select_capture_device', { deviceId }); }
export async function setVolume(volume: number) { if (desktop) return invoke('set_volume', { volume }); }
export async function capabilities(): Promise<{ native: boolean; reason: string; capture: boolean }> { return desktop ? invoke('media_capabilities') : { native: false, capture: false, reason: '浏览器仅预览房间控制；音频需要 Tauri 原生客户端' }; }
