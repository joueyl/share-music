import { invoke } from '@tauri-apps/api/core';
import type { TrackMetadata } from '@music-share/shared';
import { extractEmbeddedCover } from './embedded-cover';
import { releaseEmbeddedTrackArtwork, setEmbeddedTrackArtwork } from './track-artwork';
export type PlaybackSource = { url: string; release: () => void };
type CacheMetadata = Pick<TrackMetadata, 'contentHash' | 'sizeBytes' | 'name' | 'ossKey'>;
function audioBytes(bytes: ArrayBuffer | number[] | null): ArrayBuffer | Uint8Array<ArrayBuffer> | null {
  return bytes instanceof ArrayBuffer ? bytes : Array.isArray(bytes) ? new Uint8Array(bytes) : null;
}

export async function loadPlaybackSource(source: string | (() => Promise<string>), desktop: boolean, track: CacheMetadata,webBytes?:()=>Promise<ArrayBuffer>): Promise<string | PlaybackSource> {
  const resolveUrl = () => typeof source === 'string' ? Promise.resolve(source) : source();
  if (!desktop&&!webBytes) return resolveUrl();
  // Desktop reads its verified native cache; Web uses the authenticated audio API.
  // Both analyse the exact same Blob that the media element plays, not fake data.
  const key = { contentHash: track.contentHash, sizeBytes: track.sizeBytes };
  let data = desktop?audioBytes(await invoke<ArrayBuffer | number[] | null>('read_cached_audio', key)):await webBytes!();
  if (desktop&&!data?.byteLength) {
    const url = await resolveUrl();
    data = audioBytes(await invoke<ArrayBuffer | number[]>('load_playback_audio', { url, ...key }));
  }
  if (!data || !data.byteLength) throw new Error('PLAYBACK_AUDIO_DOWNLOAD_FAILED');
  const extension = (track.ossKey ?? track.name).split('.').at(-1)?.toLowerCase();
  const types: Record<string, string> = { mp3: 'audio/mpeg', flac: 'audio/flac', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', webm: 'audio/webm' };
  const type = types[extension ?? ''] ?? '';
  const cover = await extractEmbeddedCover(data instanceof ArrayBuffer ? new Uint8Array(data) : data, type || undefined);
  const local = URL.createObjectURL(new Blob([data], { type }));
  let coverUrl:string|null=null,released=false;
  if (cover) {
    try { coverUrl=URL.createObjectURL(cover);setEmbeddedTrackArtwork(track.contentHash,coverUrl); }
    catch { /* Cover allocation is optional; retain normal audio playback. */ }
  }
  return { url: local, release: () => {
    if(released)return;released=true;URL.revokeObjectURL(local);
    if(coverUrl){releaseEmbeddedTrackArtwork(track.contentHash,coverUrl);URL.revokeObjectURL(coverUrl);}
  } };
}
