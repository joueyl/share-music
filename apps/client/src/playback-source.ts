import { invoke } from '@tauri-apps/api/core';
import { verifyAudio } from './audio-integrity';
import type { TrackMetadata } from '@music-share/shared';
import { extractEmbeddedCover } from './embedded-cover';
import { releaseEmbeddedTrackArtwork, setEmbeddedTrackArtwork } from './track-artwork';
export type PlaybackSource = { url: string; release: () => void };
type CacheMetadata = Pick<TrackMetadata, 'contentHash' | 'sizeBytes' | 'name' | 'ossKey' | 'sourceUrl'>;
function audioBytes(bytes: ArrayBuffer | number[] | null): ArrayBuffer | Uint8Array<ArrayBuffer> | null {
  return bytes instanceof ArrayBuffer ? bytes : Array.isArray(bytes) ? new Uint8Array(bytes) : null;
}

export type PlaybackLink = {url:string;contentHash?:string;sizeBytes?:number};
export async function loadPlaybackSource(source: string | ((refresh?:boolean) => Promise<string | PlaybackLink>), desktop: boolean, track: CacheMetadata,webBytes?:(current:CacheMetadata)=>Promise<ArrayBuffer>): Promise<string | PlaybackSource> {
  if (!desktop&&!webBytes) throw new Error('PLAYBACK_AUDIO_DOWNLOAD_FAILED');
  let current=track,data:ArrayBuffer | Uint8Array<ArrayBuffer> | null=null;
  const resolve = async (refresh:boolean) => {
    const result=typeof source==='string'?source:await source(refresh);
    const link=typeof result==='string'?{url:result}:result;
    // URL and checksum are a single provider response, never mix a new URL with an old MD5.
    if((link.contentHash===undefined)!==(link.sizeBytes===undefined))throw new Error('PLAYBACK_AUDIO_METADATA_INVALID');
    current={...track,sourceUrl:link.url,...(link.contentHash!==undefined?{contentHash:link.contentHash,sizeBytes:link.sizeBytes!}:{})};
    return link.url;
  };
  for(let attempt=0;attempt<2;attempt++) {
    try {
      data=null;
      if(desktop&&attempt===0)data=audioBytes(await invoke<ArrayBuffer | number[] | null>('read_cached_audio',{contentHash:current.contentHash,sizeBytes:current.sizeBytes}));
      if(!data?.byteLength) {
        const url=await resolve(attempt===1);
        data=desktop?audioBytes(await invoke<ArrayBuffer | number[]>('load_playback_audio',{url,contentHash:current.contentHash,sizeBytes:current.sizeBytes})):await webBytes!(current);
      }
      if(!data?.byteLength)throw new Error('PLAYBACK_AUDIO_DOWNLOAD_FAILED');
      await verifyAudio(data instanceof ArrayBuffer?new Uint8Array(data):data,current);
      break;
    } catch(error) {
      const code=error instanceof Error?error.message:String(error);
      if(attempt===1||typeof source==='string'||!['PLAYBACK_AUDIO_DOWNLOAD_FAILED','PLAYBACK_AUDIO_INTEGRITY_FAILED','MUSIC_LINK_EXPIRED','MUSIC_DOWNLOAD_FAILED','MUSIC_CONTENT_CHANGED'].includes(code))throw error;
      // Refresh once for failed/expired or checksum-mismatched downloads, including Web audio.
      // Do not allocate a playback Blob or report ready until the retry has verified successfully.
    }
  }
  if(!data)throw new Error('PLAYBACK_AUDIO_DOWNLOAD_FAILED');
  const extension = (current.sourceUrl?new URL(current.sourceUrl).pathname:track.ossKey??track.name).split('.').at(-1)?.toLowerCase();
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
