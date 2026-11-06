import { expect, it } from 'vitest';
import { verifyAudio } from '../src/audio-integrity';
it('treats old digests and new IDs as opaque cache keys without hashing bytes',async()=>{
 const bytes=new Uint8Array([1,2,3,4]);
 for(const contentHash of ['a'.repeat(32),'b'.repeat(64)]) {
  await expect(verifyAudio(bytes,{contentHash,sizeBytes:4})).resolves.toBeUndefined();
  await expect(verifyAudio(new Uint8Array(4),{contentHash,sizeBytes:4})).resolves.toBeUndefined();
  await expect(verifyAudio(bytes.slice(1),{contentHash,sizeBytes:4})).rejects.toThrow('PLAYBACK_AUDIO_INTEGRITY_FAILED');
 }
 for(const contentHash of ['', '../bad','A'.repeat(32)])
  await expect(verifyAudio(bytes,{contentHash,sizeBytes:4})).rejects.toThrow('PLAYBACK_AUDIO_METADATA_INVALID');
});
