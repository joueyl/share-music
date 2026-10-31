import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { envelopeSchema, supportsLossless, positionAt, requiredBandwidth, trackSchema } from '../src';
it('accepts provider MD5 without inventing MP3 specifications and retains SHA metadata compatibility',()=>{
 const track={id:randomUUID(),name:'song',durationMs:120000,sizeBytes:4,lossless:false,bitrateBps:128000,contentHash:'a'.repeat(32)};
 expect(trackSchema.parse(track).spec).toBeUndefined();
 expect(trackSchema.safeParse({...track,contentHash:'a'.repeat(64)}).success).toBe(true);
 for(const hash of ['', 'a'.repeat(31), 'a'.repeat(40), 'A'.repeat(32), '../file'])
  expect(trackSchema.safeParse({...track,contentHash:hash}).success).toBe(false);
});
it('rejects arbitrary file paths and malformed controls', () => { const command = { commandId: randomUUID(), roomId: randomUUID(), expectedStateVersion: 0, action: { type: 'seek', payload: { positionMs: -1 } } }; expect(envelopeSchema.safeParse(command).success).toBe(false); command.action.payload.positionMs = 100; expect(envelopeSchema.safeParse({ ...command, path: '/secret' }).success).toBe(false); expect(envelopeSchema.safeParse(command).success).toBe(true); });
it('computes CD bitrate and validates strict lossless formats', () => { expect(requiredBandwidth(1411200, 7)).toBe(11854080); expect(supportsLossless({ sampleRate: 48000, bits: 24, channels: 2 })).toBe(true); expect(supportsLossless({ sampleRate: 192000, bits: 24, channels: 2 })).toBe(false); });
