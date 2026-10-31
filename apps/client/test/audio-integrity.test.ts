import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { audioMd5, verifyAudio } from '../src/audio-integrity';

it('matches MD5 reference vectors, binary data and block boundaries',async()=>{
  for(const text of ['', 'a', 'abc', 'message digest', 'abcdefghijklmnopqrstuvwxyz']) {
    const bytes=new TextEncoder().encode(text);
    expect(await audioMd5(bytes)).toBe(createHash('md5').update(bytes).digest('hex'));
  }
  for(const length of [55,56,63,64,65,119,120,127,128,1000000,1024*1024+65]) {
    const bytes=Uint8Array.from({length},(_,i)=>i%256);
    expect(await audioMd5(bytes)).toBe(createHash('md5').update(bytes).digest('hex'));
    expect(await audioMd5(bytes.subarray(1))).toBe(createHash('md5').update(bytes.subarray(1)).digest('hex'));
  }
});
it('checks MD5 and legacy SHA-256 without accepting missing metadata or changed bytes',async()=>{
  const bytes=new TextEncoder().encode('test audio');
  for(const algorithm of ['md5','sha256']) {
    const track={sizeBytes:bytes.length,contentHash:createHash(algorithm).update(bytes).digest('hex')};
    await expect(verifyAudio(bytes,track)).resolves.toBeUndefined();
    await expect(verifyAudio(bytes.slice(1),track)).rejects.toThrow('PLAYBACK_AUDIO_INTEGRITY_FAILED');
    await expect(verifyAudio(new Uint8Array(bytes.length),track)).rejects.toThrow('PLAYBACK_AUDIO_INTEGRITY_FAILED');
  }
  for(const contentHash of ['', 'x'.repeat(32),'A'.repeat(32),'a'.repeat(40),'../bad'])
    await expect(verifyAudio(bytes,{sizeBytes:bytes.length,contentHash})).rejects.toThrow('PLAYBACK_AUDIO_METADATA_INVALID');
});
