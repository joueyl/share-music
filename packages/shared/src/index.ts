import { z } from 'zod';

export const MAX_MEMBERS = 8;
export const DEFAULT_BUFFER_MS = 3000;
export const MAX_BUFFER_MS = 5000;
export const RELAY_BUDGET_BPS = 3_500_000;
export const permissionsSchema = z.object({ skip: z.boolean(), stream: z.boolean(), seek: z.boolean(), enqueue: z.boolean() }).strict();
export type Permissions = z.infer<typeof permissionsSchema>;
export const DEFAULT_PERMISSIONS: Permissions = { skip: false, stream: false, seek: false, enqueue: true };
export const ALL_PERMISSIONS: Permissions = { skip: true, stream: true, seek: true, enqueue: true };
export type PermissionKey = keyof Permissions;
export type Quality = 'lossless' | 'source' | 'opus';
export const audioSpecSchema = z.object({ sampleRate: z.number().int().positive().max(192000), bits: z.number().int().positive().max(32), channels: z.number().int().min(1).max(8) }).strict();
export type AudioSpec = z.infer<typeof audioSpecSchema>;
export const trackSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(200), durationMs: z.number().int().min(1).max(86_400_000),
  sizeBytes: z.number().int().positive().max(10_000_000_000), spec: audioSpecSchema,
  lossless: z.boolean(), bitrateBps: z.number().int().positive().max(20_000_000), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type TrackMetadata = z.infer<typeof trackSchema>;
export type Track = TrackMetadata & { providerId: string; available: boolean };
export type Member = { id: string; name: string; joinedAt: number; online: boolean; overrides: Partial<Permissions>; permissions: Permissions };
export type Playback = {
  sourceId: string | null; sourceEpoch: number; sourceType: 'file' | 'live' | null;
  playState: 'stopped' | 'playing' | 'paused'; positionMs: number; effectiveAtServerMs: number;
  providerId: string | null; qualityMode: Quality; spec: AudioSpec | null; bitrateBps: number; instant: boolean;
};
export type PendingPlayback = { id: string; playback: Playback; previous: Playback; ready: string[]; preparedAt: number; deadlineAt: number; committed: boolean; followTimeline: boolean };
export type RoomSnapshot = {
  id: string; name: string; hostId: string; stateVersion: number; defaults: Permissions;
  members: Member[]; playlist: Track[]; playback: Playback; pending: PendingPlayback | null;
  requests: { id: string; memberId: string; spec: AudioSpec; bitrateBps: number }[]; serverNow: number;
};
const id = z.string().uuid();
const empty = z.object({}).strict();
const variants = [
  z.object({ type: z.literal('enqueue'), payload: trackSchema }),
  z.object({ type: z.literal('remove'), payload: z.object({ trackId: id }).strict() }),
  z.object({ type: z.literal('reorder'), payload: z.object({ trackIds: z.array(id).max(200) }).strict() }),
  z.object({ type: z.literal('clear'), payload: empty }),
  z.object({ type: z.literal('play'), payload: z.object({ trackId: id }).strict() }),
  z.object({ type: z.literal('instant'), payload: trackSchema }),
  z.object({ type: z.literal('next'), payload: empty }),
  z.object({ type: z.literal('previous'), payload: empty }),
  z.object({ type: z.literal('pause'), payload: empty }),
  z.object({ type: z.literal('resume'), payload: empty }),
  z.object({ type: z.literal('stop'), payload: empty }),
  z.object({ type: z.literal('stopLive'), payload: z.object({ sourceEpoch: z.number().int().nonnegative() }).strict() }),
  z.object({ type: z.literal('seek'), payload: z.object({ positionMs: z.number().int().nonnegative() }).strict() }),
  z.object({ type: z.literal('startLive'), payload: z.object({ spec: audioSpecSchema, bitrateBps: z.number().int().positive().max(20_000_000) }).strict() }),
  z.object({ type: z.literal('requestLive'), payload: z.object({ spec: audioSpecSchema, bitrateBps: z.number().int().positive().max(20_000_000) }).strict() }),
  z.object({ type: z.literal('approveLive'), payload: z.object({ requestId: id }).strict() }),
  z.object({ type: z.literal('rejectLive'), payload: z.object({ requestId: id }).strict() }),
  z.object({ type: z.literal('quality'), payload: z.object({ qualityMode: z.enum(['lossless', 'source', 'opus']) }).strict() }),
  z.object({ type: z.literal('defaults'), payload: permissionsSchema }),
  z.object({ type: z.literal('permission'), payload: z.object({ memberId: id, overrides: permissionsSchema.partial() }).strict() }),
] as const;
export const commandSchema = z.discriminatedUnion('type', variants);
export type Action = z.infer<typeof commandSchema>;
export const envelopeSchema = z.object({ commandId: id, roomId: id, expectedStateVersion: z.number().int().nonnegative(), action: commandSchema }).strict();
export type Command = z.infer<typeof envelopeSchema>;
export type ServerMessage =
  | { type: 'snapshot'; data: RoomSnapshot }
  | { type: 'result'; commandId: string; ok: boolean; error?: string; stateVersion?: number }
  | { type: 'clock'; requestId: string; clientSentAt: number; serverReceivedAt: number; serverSentAt: number }
  | { type: 'signal'; fromId: string; sourceEpoch: number; data: unknown }
  | { type: 'admission'; requestId: string; ok: boolean; error?: string; iceServers?: string[]; leaseId?: string }
  | { type: 'error'; error: string };
export function supportsLossless(spec: AudioSpec): boolean {
  return spec.channels === 2 && [44100, 48000, 88200, 96000].includes(spec.sampleRate) && [16, 24].includes(spec.bits);
}
export function positionAt(playback: Playback, now: number): number {
  return playback.positionMs + (playback.playState === 'playing' ? Math.max(0, now - playback.effectiveAtServerMs) : 0);
}
export function requiredBandwidth(bitrateBps: number, receivers: number): number {
  return Math.ceil(bitrateBps * receivers * 1.2);
}
