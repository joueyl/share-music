import { invoke, isTauri } from '@tauri-apps/api/core';
import { apiResponse } from './api-response';
import { listen } from '@tauri-apps/api/event';
import type { Command, RoomSnapshot, TrackMetadata } from '@music-share/shared';
type Listener = (event: any) => void;
let socket: WebSocket | undefined, token = '', base = '', joinedRoom: string | null = null;
let browserGeneration = 0, reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let roomLeft = false;
const listeners = new Map<string, Set<Listener>>();
function emit(name: string, value: unknown) { listeners.get(name)?.forEach(fn => fn(value)); }
async function browserRequest(path: string, body?: unknown, signal?: AbortSignal) {
  const res = await fetch(base + '/api' + path, { ...(signal ? { signal } : {}), method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token && path !== '/login' ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return apiResponse(res);
}
export async function subscribe(name: string, handler: Listener) {
  const receive = handler;
  handler = event => {
    if (roomLeft && (name === 'webrtc-status' || name === 'media-status' && event.status !== 'idle' || name === 'server-message' && ['snapshot', 'signal', 'admission'].includes(event.type))) return;
    receive(event);
  };
  if (isTauri() && !['connection','server-message','media-status'].includes(name)) return listen(name, e => handler(e.payload));
  const nativeUnsubscribe = isTauri() ? await listen(name, e => handler(e.payload)) : undefined;
  const set = listeners.get(name) ?? new Set(); set.add(handler); listeners.set(name, set); return () => { set.delete(handler); nativeUnsubscribe?.(); };
}
export const desktop = isTauri();
export async function login(serverUrl: string, name: string, password: string, register: boolean): Promise<{ user: { id: string; name: string } }> {
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
    audio?.pause(); emit('connection', { connected: false });
    if (event.code === 4001 || event.code === 4009) { emit('server-message', { type: 'error', error: 'SESSION_EXPIRED' }); return; }
    reconnectTimer = setTimeout(() => { if (active()) connectBrowser(); }, 2000);
  };
}
export async function logout(): Promise<void> {
  clearCloud();
  if (desktop) await invoke('logout');
  ++browserGeneration;
  clearTimeout(reconnectTimer); reconnectTimer = undefined;
  token = ''; base = ''; joinedRoom = null;
  const previous = socket; socket = undefined;
  previous?.close(1000, 'Logout');
  audio?.pause(); emit('connection', { connected: false });
}

export async function listRooms(): Promise<{ id: string; name: string; members: number; maxMembers: number; qualityMode: string }[]> { return browserRequest('/rooms'); }
export async function createRoom(name: string): Promise<RoomSnapshot> { return browserRequest('/rooms', { name }); }
export async function send(message: unknown): Promise<void> {

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
        await send({ type: 'join', roomId }); joinedRoom = roomId;
      } catch (e) { reject(e); }
    });
  } finally { clearTimeout(timer); unsubscribe?.(); }
}
export async function leave() {
  roomLeft = true; joinedRoom = null;
  clearCloud();
  if (socket?.readyState === WebSocket.OPEN) await send({ type: 'leave' });
}
export async function command(data: Command) { return send({ type: 'command', data }); }
export async function importFile(): Promise<TrackMetadata> {
 const file = await new Promise<File>((resolve,reject)=>{ const i=document.createElement('input'); i.type='file'; i.accept='audio/*'; i.onchange=()=>i.files?.[0]?resolve(i.files[0]):reject(new Error('CANCELLED')); i.oncancel=()=>reject(new Error('CANCELLED')); i.click(); });
 if(file.size>100*1024*1024) throw new Error('音乐不能超过100MB');
 const data=await file.arrayBuffer(), ctx=new AudioContext();
 let decoded: AudioBuffer; try { decoded=await ctx.decodeAudioData(data.slice(0)); } finally { await ctx.close(); }
 const durationMs=Math.round(decoded.duration*1000);
 const contentHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)), b=>b.toString(16).padStart(2,'0')).join('');
 const res=await fetch(base+'/api/music/upload',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/octet-stream','X-Music-Filename':encodeURIComponent(file.name)},body:data});
 const result=await apiResponse(res);
 return {id:crypto.randomUUID(),name:file.name,durationMs,sizeBytes:file.size,spec:{sampleRate:decoded.sampleRate,bits:16,channels:decoded.numberOfChannels},lossless:false,bitrateBps:Math.min(20000000,Math.ceil(file.size*8000/durationMs)),contentHash,ossKey:result.ossKey};
}
export async function setVolume(volume: number) { audio.volume=volume; }
export async function capabilities(): Promise<{ native: boolean; reason: string; capture: boolean }> { return desktop ? invoke('media_capabilities') : { native: false, capture: false, reason: 'OSS 音乐播放与 WebSocket 同步' }; }

const audio=typeof Audio === 'undefined' ? null! as HTMLAudioElement : new Audio(); let cloud:RoomSnapshot|null=null, epoch=-1, offset=0, ready=false, reported=0;
function clearCloud(){cloud=null;epoch=-1;ready=false;if(audio){audio.pause();audio.removeAttribute('src');audio.load();}}
export async function syncCloud(room:RoomSnapshot, clockOffset:number){
 if(!audio || !room.playlist) return; cloud=room;offset=clockOffset;const p=room.pending?.playback??room.playback,t=room.playlist.find(t=>t.id===p.sourceId);
 if(!t?.ossKey){clearCloud();return;} if(epoch===p.sourceEpoch)return;
 epoch=p.sourceEpoch;ready=false;audio.pause();const expected=epoch;
 try{const data=await browserRequest(`/rooms/${room.id}/music/${t.id}`);if(epoch!==expected)return;audio.src=data.url;audio.load();}catch(e){emit('server-message',{type:'error',error:String(e)});}
}
if(audio) audio.oncanplay=()=>{if(!cloud||ready)return;ready=true;const p=cloud.pending;if(p&&!p.committed)void send({type:'ready',roomId:cloud.id,transitionId:p.id,sourceEpoch:epoch});};
if(audio) audio.onerror=()=>emit('server-message',{type:'error',error:'音乐加载失败，请检查 OSS 或格式'});
setInterval(()=>{if(!cloud||!ready||socket?.readyState!==WebSocket.OPEN)return;const p=cloud.pending?.committed?cloud.pending.playback:cloud.playback;if(p.sourceEpoch!==epoch)return;
 const now=Date.now()+offset;if(now<p.effectiveAtServerMs||p.playState!=='playing'){audio.pause();return;}
 const target=p.positionMs+now-p.effectiveAtServerMs;if(Math.abs(audio.currentTime*1000-target)>600)audio.currentTime=target/1000;
 if(audio.paused)void audio.play().catch(()=>emit('server-message',{type:'error',error:'请点击页面以允许播放'}));
 emit('media-status',{status:audio.paused?'buffering':'playing',detail:'OSS · WebSocket 同步',bufferedMs:0,driftMs:audio.currentTime*1000-target,receiveBps:0});
 if(Date.now()-reported>1000&&!audio.paused&&!audio.seeking&&audio.readyState>=3){reported=Date.now();void send({type:'progress',roomId:cloud.id,sourceEpoch:epoch,positionMs:audio.currentTime*1000}).catch(()=>{});}
},200);

export type MusicSearchItem = { id: string; name: string; artists: string; album: string; durationMs: number };
export async function searchMusic(keywords: string, offset = 0): Promise<{ songs: MusicSearchItem[]; total: number }> {
 const query = new URLSearchParams({keywords:keywords.trim(),type:'1',limit:'20',offset:String(offset)});
 const data = await browserRequest('/netease/cloudsearch?' + query);
 if(data.code!==200) throw new Error(data.code===301?'NETEASE_LOGIN_REQUIRED':'NETEASE_UNAVAILABLE');
 const songs = (data.result?.songs ?? []).map((s:any)=>({id:String(s.id),name:String(s.name??''),artists:(s.ar??s.artists??[]).map((a:any)=>a.name).join(' / '),album:String(s.al?.name??s.album?.name??''),durationMs:Number(s.dt??s.duration??0)}));
 return {songs,total:Number(data.result?.songCount??songs.length)};
}
export async function addSearchedMusic(roomId:string,songId:string,requestId:string) {
 const result = await browserRequest(`/rooms/${roomId}/music/netease`,{songId,requestId});
 if(!result.ok || !result.track?.ossKey)throw new Error('MUSIC_IMPORT_FAILED');
 return result.track as TrackMetadata;
}

export async function suggestMusic(keywords:string,signal?:AbortSignal):Promise<string[]> {
 const term=keywords.trim();if(!term)return [];
 const query=new URLSearchParams({keywords:term,type:'mobile'});
 const data=await browserRequest('/netease/search_suggest?'+query,undefined,signal);
 if(data.code!==200)throw new Error('NETEASE_UNAVAILABLE');
 const items=Array.isArray(data.result?.allMatch)?data.result.allMatch:[];
 return [...new Set<string>(items.map((item:any)=>item.keyword).filter((s:unknown):s is string=>typeof s==='string'&&!!s.trim()&&s.length<=100).map((s:string)=>s.trim()))].slice(0,8);
}
