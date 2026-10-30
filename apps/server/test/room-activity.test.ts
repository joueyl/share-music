import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { RoomEngine } from '../src/engine';
import type { Action, ChatMessage, TrackMetadata } from '../../../packages/shared/src';

function setup() {
  let now = 100000;
  const messages: ChatMessage[] = [];
  const engine = new RoomEngine(undefined, undefined, () => now, undefined, message => messages.push(message));
  const host = { id: randomUUID(), name: '小明' }, member = { id: randomUUID(), name: '小红' };
  const roomId = engine.create('测试', host.id).id;
  engine.join(roomId, host); engine.join(roomId, member);
  const track: TrackMetadata = { id: randomUUID(), name: '<晚风>', durationMs: 180000, sizeBytes: 1000, spec: { sampleRate: 48000, bits: 24, channels: 2 }, lossless: true, bitrateBps: 900000, contentHash: 'a'.repeat(64) };
  const cmd = (action: Action, userId = host.id) => engine.command(userId, { roomId, commandId: randomUUID(), expectedStateVersion: engine.snapshot(roomId).stateVersion, action });
  const settle = () => {
    const p = engine.snapshot(roomId).pending!;
    for (const m of [host, member]) engine.ready(roomId, m.id, p.id, p.playback.sourceEpoch);
    engine.tick(); now += 6000; engine.tick();
  };
  return { engine, messages, host, member, roomId, track, cmd, settle };
}

it('records authoritative actor, song, playback actions and seek target, not background progress', () => {
  const s = setup();
  s.cmd({ type: 'enqueue', payload: s.track }, s.member.id);
  expect(s.messages[0]).toMatchObject({ kind: 'activity', userId: s.member.id, userName: '小红', text: '将《<晚风>》加入了播放列表', sentAt: 100000, roomId: s.roomId });
  s.cmd({ type: 'play', payload: { trackId: s.track.id } }); s.settle();
  s.cmd({ type: 'seek', payload: { positionMs: 90500 } }); s.settle();
  s.cmd({ type: 'pause', payload: {} }); s.settle();
  s.cmd({ type: 'resume', payload: {} }); s.settle();
  expect(s.messages.map(m => m.text)).toEqual(['将《<晚风>》加入了播放列表', '点播了《<晚风>》', '将《<晚风>》的播放进度调整到 01:30', '暂停了《<晚风>》', '继续播放《<晚风>》']);
  s.engine.reportProgress(s.roomId, s.host.id, s.engine.snapshot(s.roomId).playback.sourceEpoch, 100000);
  s.engine.tick(); expect(s.messages).toHaveLength(5);
  s.cmd({ type: 'next', payload: {} }); s.settle();
  expect(s.messages.at(-1)?.text).toBe('切换到下一首 《<晚风>》');
  s.cmd({ type: 'stop', payload: {} });
  s.cmd({ type: 'remove', payload: { trackId: s.track.id } });
  expect(s.messages.at(-1)?.text).toBe('将《<晚风>》移出了播放列表');
});

it('does not log forbidden, conflicting, invalid commands or duplicate successful retries', () => {
  const s = setup();
  const command = { roomId: s.roomId, commandId: randomUUID(), expectedStateVersion: s.engine.snapshot(s.roomId).stateVersion, action: { type: 'enqueue' as const, payload: s.track } };
  s.engine.command(s.host.id, command); s.engine.command(s.host.id, command);
  expect(s.messages).toHaveLength(1);
  expect(() => s.cmd({ type: 'play', payload: { trackId: s.track.id } }, s.member.id)).toThrow('FORBIDDEN');
  expect(() => s.engine.command(s.host.id, { ...command, commandId: randomUUID() })).toThrow('STATE_CONFLICT');
  expect(() => s.cmd({ type: 'play', payload: { trackId: randomUUID() } })).toThrow('TRACK_NOT_FOUND');
  expect(s.messages).toHaveLength(1);
});
