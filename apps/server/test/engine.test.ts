import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { RoomEngine, DomainError, type RoomRecord } from '../src/engine';
import { type Action, type Command, type TrackMetadata, DEFAULT_PERMISSIONS } from '../../../packages/shared/src';
describe('authoritative room engine', () => {
 let now: number, engine: RoomEngine, roomId: string, host: { id: string; name: string }, member: { id: string; name: string }, saved: RoomRecord[];
 const spec = { sampleRate: 48000, bits: 24, channels: 2 };
 function track(): TrackMetadata { return { id: randomUUID(), name: 'test.flac', durationMs: 120000, sizeBytes: 2000000, spec, lossless: true, bitrateBps: 900000, contentHash: 'a'.repeat(64) }; }
 function cmd(user: string, action: Action, id = randomUUID(), version = engine.snapshot(roomId).stateVersion) { return engine.command(user, { commandId: id, roomId, expectedStateVersion: version, action }); }
 function start(t: TrackMetadata) { cmd(host.id, { type: 'enqueue', payload: t }); cmd(host.id, { type: 'play', payload: { trackId: t.id } }); readyAll(); }
 function readyAll() { const p = engine.snapshot(roomId).pending!; for (const m of engine.snapshot(roomId).members.filter(m => m.online)) engine.ready(roomId, m.id, p.id, p.playback.sourceEpoch); engine.tick(); now = Math.max(now + 3000, p.playback.effectiveAtServerMs); engine.tick(); }
 beforeEach(() => { now = 100000; saved = []; engine = new RoomEngine(r => saved.push(r), () => {}, () => now); host = { id: randomUUID(), name: 'host' }; member = { id: randomUUID(), name: 'member' }; roomId = engine.create('room', host.id).id; engine.join(roomId, host); engine.join(roomId, member); });
 it('defaults allow enqueue but reject forged skip/seek/stream controls', () => {
  const t = track(); cmd(member.id, { type: 'enqueue', payload: t });
  for (const action of [{ type: 'play', payload: { trackId: t.id } }, { type: 'seek', payload: { positionMs: 0 } }, { type: 'startLive', payload: { spec, bitrateBps: 2304000 } }] as Action[]) expect(() => cmd(member.id, action)).toThrow('FORBIDDEN');
  expect(engine.snapshot(roomId).playlist[0].providerId).toBe(member.id);
 });
 it('enforces the eight-online-member limit and allows reconnect', () => { for (let i = 0; i < 6; i++) engine.join(roomId, { id: randomUUID(), name: `m${i}` }); expect(() => engine.join(roomId, { id: randomUUID(), name: 'extra' })).toThrow('ROOM_FULL'); engine.leave(roomId, member.id); engine.join(roomId, member); expect(engine.snapshot(roomId).members.filter(m => m.online)).toHaveLength(8); });
 it('deduplicates retries and rejects command-id reuse and stale versions', () => {
  const command: Command = { roomId, commandId: randomUUID(), expectedStateVersion: engine.snapshot(roomId).stateVersion, action: { type: 'enqueue', payload: track() } };
  const version = engine.command(member.id, command); expect(engine.command(member.id, command)).toBe(version); expect(engine.snapshot(roomId).playlist).toHaveLength(1);
  expect(() => engine.command(member.id, { ...command, action: { type: 'enqueue', payload: track() } })).toThrow('COMMAND_ID_REUSED');
  expect(() => cmd(member.id, { type: 'enqueue', payload: track() }, randomUUID(), 0)).toThrow('STATE_CONFLICT');
 });
 it('prepares before switching and commits at a shared time', () => { const t = track(); cmd(host.id, { type: 'enqueue', payload: t }); cmd(host.id, { type: 'play', payload: { trackId: t.id } }); expect(engine.snapshot(roomId).playback.sourceId).toBeNull(); const pending = engine.snapshot(roomId).pending!; engine.ready(roomId, member.id, pending.id, pending.playback.sourceEpoch); engine.tick(); expect(engine.snapshot(roomId).pending!.committed).toBe(false); now += 5000; engine.tick(); expect(engine.snapshot(roomId).pending!.committed).toBe(true); now += 200; engine.tick(); expect(engine.snapshot(roomId).playback.sourceId).toBe(t.id); });
 it('rejects overlapping playback transitions without changing state', () => { const t = track(); cmd(host.id, { type: 'enqueue', payload: t }); cmd(host.id, { type: 'play', payload: { trackId: t.id } }); const before = engine.snapshot(roomId); expect(() => cmd(host.id, { type: 'next', payload: {} })).toThrow('PLAYBACK_TRANSITION_PENDING'); expect(engine.snapshot(roomId)).toEqual(before); });
 it('member override wins and only host can grant it', () => { cmd(host.id, { type: 'permission', payload: { memberId: member.id, overrides: { skip: true, enqueue: false } } }); const permissions = engine.snapshot(roomId).members.find(m => m.id === member.id)!.permissions; expect(permissions.skip).toBe(true); expect(permissions.enqueue).toBe(false); expect(() => cmd(member.id, { type: 'defaults', payload: DEFAULT_PERMISSIONS })).toThrow('HOST_ONLY'); expect(saved.at(-1)!.overrides[member.id].skip).toBe(true); });
 it('revocation terminates an instant live source and rejects live seek/pause', () => { cmd(host.id, { type: 'permission', payload: { memberId: member.id, overrides: { skip: true, stream: true, seek: true } } }); cmd(member.id, { type: 'startLive', payload: { spec, bitrateBps: 2304000 } }); readyAll(); expect(() => cmd(member.id, { type: 'seek', payload: { positionMs: 1 } })).toThrow('FILE_ONLY'); expect(() => cmd(member.id, { type: 'pause', payload: {} })).toThrow('FILE_ONLY'); cmd(host.id, { type: 'permission', payload: { memberId: member.id, overrides: { stream: false } } }); expect(engine.snapshot(roomId).playback.playState).toBe('stopped'); });
 it('enqueue authorization permits automatic file supply without stream permission', () => { const t = track(); cmd(member.id, { type: 'enqueue', payload: t }); cmd(host.id, { type: 'play', payload: { trackId: t.id } }); readyAll(); expect(engine.snapshot(roomId).playback.providerId).toBe(member.id); expect(engine.snapshot(roomId).playback.instant).toBe(false); });
 it('file seek retains paused state and rejects positions outside duration', () => { const t = track(); start(t); cmd(host.id, { type: 'pause', payload: {} }); readyAll(); expect(engine.snapshot(roomId).playback.playState).toBe('paused'); cmd(host.id, { type: 'seek', payload: { positionMs: 50000 } }); readyAll(); expect(engine.snapshot(roomId).playback.positionMs).toBe(50000); expect(engine.snapshot(roomId).playback.playState).toBe('paused'); expect(() => cmd(host.id, { type: 'seek', payload: { positionMs: t.durationMs } })).toThrow('SEEK_OUT_OF_RANGE'); });
 it('quality changes are explicit and cannot label lossy originals lossless', () => { const t = { ...track(), lossless: false }; start(t); expect(engine.snapshot(roomId).playback.qualityMode).toBe('source'); expect(() => cmd(host.id, { type: 'quality', payload: { qualityMode: 'lossless' } })).toThrow('SOURCE_IS_LOSSY'); cmd(host.id, { type: 'quality', payload: { qualityMode: 'opus' } }); readyAll(); expect(engine.snapshot(roomId).playback.bitrateBps).toBe(230400); });
 it('host transfer waits sixty seconds and persists the replacement', () => { engine.leave(roomId, host.id); now += 59999; engine.tick(); expect(engine.snapshot(roomId).hostId).toBe(host.id); now++; engine.tick(); expect(engine.snapshot(roomId).hostId).toBe(member.id); expect(saved.at(-1)!.hostId).toBe(member.id); });
 it('offline sources are skipped, online buffered-file exhaustion cannot force skips', () => { const first = track(), next = track(); start(first); cmd(member.id, { type: 'enqueue', payload: next }); engine.exhausted(roomId, member.id, engine.snapshot(roomId).playback.sourceEpoch); expect(engine.snapshot(roomId).pending).toBeNull(); engine.leave(roomId, host.id); expect(engine.snapshot(roomId).playback.sourceId).toBe(first.id); engine.exhausted(roomId, member.id, engine.snapshot(roomId).playback.sourceEpoch); expect(engine.snapshot(roomId).pending!.playback.sourceId).toBe(next.id); });
 it('playlist withdrawal affects only the selected unplayed item', () => { const a = track(), b = track(); cmd(member.id, { type: 'enqueue', payload: a }); cmd(member.id, { type: 'enqueue', payload: b }); cmd(member.id, { type: 'remove', payload: { trackId: a.id } }); expect(engine.snapshot(roomId).playlist.map(t => t.id)).toEqual([b.id]); });
 it('restart restores configuration and overrides but never guesses old playback', () => { const t = track(); start(t); cmd(host.id, { type: 'permission', payload: { memberId: member.id, overrides: { seek: true } } }); const records = [saved.at(-1)!]; const restored = new RoomEngine(); restored.restore(records); restored.restoreOverrides(records); restored.join(roomId, member); expect(restored.snapshot(roomId).playback.playState).toBe('stopped'); expect(restored.snapshot(roomId).members[0].permissions.seek).toBe(true); });
 it('pause follows the original timeline when readiness times out', () => { const t = track(); start(t); now += 1000; cmd(host.id, { type: 'pause', payload: {} }); const pending = engine.snapshot(roomId).pending!; now = pending.deadlineAt; engine.tick(); const committed = engine.snapshot(roomId).pending!; expect(committed.playback.positionMs).toBe(6200); now = committed.playback.effectiveAtServerMs; engine.tick(); expect(engine.snapshot(roomId).playback.positionMs).toBe(6200); });
 it('natural EOF stops instead of looping the last file', () => { const t = track(); start(t); now += t.durationMs; engine.tick(); expect(engine.snapshot(roomId).playback.playState).toBe('stopped'); expect(engine.snapshot(roomId).pending).toBeNull(); });

 it('an approved provider can stop their live stream without skip permission', () => {
  cmd(host.id, { type: 'permission', payload: { memberId: member.id, overrides: { stream: true } } });
  cmd(member.id, { type: 'requestLive', payload: { spec, bitrateBps: 2304000 } });
  cmd(host.id, { type: 'approveLive', payload: { requestId: engine.snapshot(roomId).requests[0].id } }); readyAll();
  const epoch = engine.snapshot(roomId).playback.sourceEpoch;
  const other = { id: randomUUID(), name: 'other' }; engine.join(roomId, other);
  expect(() => cmd(other.id, { type: 'stopLive', payload: { sourceEpoch: epoch } })).toThrow('FORBIDDEN');
  cmd(member.id, { type: 'stopLive', payload: { sourceEpoch: epoch } }); expect(engine.snapshot(roomId).playback.playState).toBe('stopped');
 });
 it('stopping live resumes an available queued file and rejects stale stop requests', () => {
  const t = track(); cmd(host.id, { type: 'enqueue', payload: t });
  cmd(host.id, { type: 'startLive', payload: { spec, bitrateBps: 2304000 } }); readyAll();
  const epoch = engine.snapshot(roomId).playback.sourceEpoch;
  cmd(host.id, { type: 'stopLive', payload: { sourceEpoch: epoch } }); expect(engine.snapshot(roomId).pending!.playback.sourceId).toBe(t.id); readyAll();
  expect(() => cmd(host.id, { type: 'stopLive', payload: { sourceEpoch: epoch } })).toThrow('STALE_SOURCE');
 });
 it('cancels prepared live without stopping the previous file or reusing epochs', () => {
  const t = track(); start(t);
  cmd(host.id, { type: 'startLive', payload: { spec, bitrateBps: 2304000 } });
  const epoch = engine.snapshot(roomId).pending!.playback.sourceEpoch;
  cmd(host.id, { type: 'stopLive', payload: { sourceEpoch: epoch } }); expect(engine.snapshot(roomId).pending).toBeNull(); expect(engine.snapshot(roomId).playback.sourceId).toBe(t.id);
  cmd(host.id, { type: 'startLive', payload: { spec, bitrateBps: 2304000 } }); expect(engine.snapshot(roomId).pending!.playback.sourceEpoch).toBeGreaterThan(epoch);
 });

});
