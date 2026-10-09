import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { envelopeSchema, supportsLossless, positionAt, requiredBandwidth } from '../src';
it('rejects arbitrary file paths and malformed controls', () => { const command = { commandId: randomUUID(), roomId: randomUUID(), expectedStateVersion: 0, action: { type: 'seek', payload: { positionMs: -1 } } }; expect(envelopeSchema.safeParse(command).success).toBe(false); command.action.payload.positionMs = 100; expect(envelopeSchema.safeParse({ ...command, path: '/secret' }).success).toBe(false); expect(envelopeSchema.safeParse(command).success).toBe(true); });
it('computes CD bitrate and validates strict lossless formats', () => { expect(requiredBandwidth(1411200, 7)).toBe(11854080); expect(supportsLossless({ sampleRate: 48000, bits: 24, channels: 2 })).toBe(true); expect(supportsLossless({ sampleRate: 192000, bits: 24, channels: 2 })).toBe(false); });
