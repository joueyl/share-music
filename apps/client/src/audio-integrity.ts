/** Validate bounds and transfer size only. contentHash is an opaque cache key. */
export async function verifyAudio(bytes: Uint8Array, track: {contentHash:string;sizeBytes:number}): Promise<void> {
  if(!Number.isSafeInteger(track.sizeBytes)||track.sizeBytes<1||track.sizeBytes>100*1024*1024 ||
    !/^(?:[a-f0-9]{32}|[a-f0-9]{64})$/.test(track.contentHash))throw new Error('PLAYBACK_AUDIO_METADATA_INVALID');
  if(bytes.byteLength!==track.sizeBytes)throw new Error('PLAYBACK_AUDIO_INTEGRITY_FAILED');
}
