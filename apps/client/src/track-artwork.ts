import { shallowRef } from 'vue';
import { normalizeAlbumCover } from '@music-share/shared';
const key = 'music-share:artwork:v1';
const entries = shallowRef(new Map<string,string>());
const embedded = shallowRef(new Map<string,string>());
export function setEmbeddedTrackArtwork(hash:string,url:string) {
  if(!/^(?:[a-f0-9]{32}|[a-f0-9]{64})$/.test(hash)||!url.startsWith('blob:'))return;
  const next=new Map(embedded.value);next.set(hash,url);embedded.value=next;
}
export function releaseEmbeddedTrackArtwork(hash:string,url:string) {
  if(embedded.value.get(hash)!==url)return;
  const next=new Map(embedded.value);next.delete(hash);embedded.value=next;
}
let loaded = false;
function load() {
  if (loaded) return; loaded = true;
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(saved)) return;
    const map = new Map<string,string>();
    for (const item of saved.slice(-256)) {
      if (!Array.isArray(item) || typeof item[0] !== 'string' || item[0].length > 2200) continue;
      const url = normalizeAlbumCover(item[1]); if (url) map.set(item[0],url);
    }
    entries.value = map;
  } catch { /* Artwork caching is optional, even if browser storage is unavailable. */ }
}
function cacheKey(server:string,hash:unknown):string|null {
  if(typeof hash!=='string'||!/^(?:[a-f0-9]{32}|[a-f0-9]{64})$/.test(hash))return null;
  try{return `${new URL(server).origin}|${hash}`;}catch{return null;}
}
export function rememberTrackArtwork(server:string,hash:unknown,value:unknown) {
  const id=cacheKey(server,hash),url=normalizeAlbumCover(value);if(!id||!url)return;
  load(); const next=new Map(entries.value);next.delete(id);next.set(id,url);
  while(next.size>256)next.delete(next.keys().next().value!);
  entries.value=next;
  try{localStorage.setItem(key,JSON.stringify([...next]));}catch{/* Keep the in-memory fallback. */}
}
export function trackArtwork(server:string,track:{contentHash:string;coverUrl?:string|null}|null|undefined):string {
  if(!track)return '';
  const local=embedded.value.get(track.contentHash);if(local)return local;
  const cover=normalizeAlbumCover(track.coverUrl);if(cover)return cover;
  load();const id=cacheKey(server,track.contentHash);return id?entries.value.get(id)??'':'';
}
