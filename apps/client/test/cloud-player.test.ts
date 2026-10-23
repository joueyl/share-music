import { expect, it, vi } from 'vitest';
import type { Playback, RoomSnapshot } from '@music-share/shared';
import { CloudPlayer } from '../src/cloud-player';

class FakeAudio {
  src = ''; readyState = 0; seeking = false; paused = true;
  onloadedmetadata?: () => void; oncanplay?: () => void; onseeked?: () => void; onerror?: () => void;
  seeks: number[] = []; private position = 0;
  get currentTime() { return this.position; }
  set currentTime(value: number) { this.position = value; this.seeks.push(value); this.seeking = true; }
  pause = vi.fn(() => { this.paused = true; });
  play = vi.fn(async () => { this.paused = false; });
  load = vi.fn(() => { this.readyState = 0; });
  removeAttribute() { this.src = ''; }
  buffered() { this.readyState = 3; this.oncanplay?.(); }
  seeked() { this.seeking = false; this.readyState = 3; this.onseeked?.(); }
  advance(seconds: number) { this.position += seconds; }
}
function room(epoch = 1, positionMs = 0, playState = 'playing'): RoomSnapshot {
  const p = { sourceId: 'song', sourceEpoch: epoch, sourceType: 'file', positionMs, playState, effectiveAtServerMs: 103000 } as Playback;
  return { id: 'room', playlist: [{ id: 'song', ossKey: 'music/song.mp3', durationMs: 300000 }], playback: p,
    pending: { id: `transition-${epoch}`, playback: p, previous: p, committed: false, ready: [], preparedAt: 100000, deadlineAt: 105000, followTimeline: false } } as RoomSnapshot;
}
function setup() {
  let time = 100000;
  const audio = new FakeAudio(), url = vi.fn(async () => 'https://oss.test/song.mp3');
  const send = vi.fn(async (_message: unknown) => {}), emit = vi.fn();
  const player = new CloudPlayer(audio as unknown as HTMLAudioElement, url, send, emit, () => time);
  return { audio, url, send, player, setTime: (value: number) => { time = value; } };
}

it('waits for the requested seek position to buffer before reporting ready; ticks do not restart a pending seek', async () => {
  const { player, audio, send } = setup();
  await player.sync(room(1, 90000), 0);
  audio.buffered();
  expect(audio.seeks).toEqual([90]); expect(send).not.toHaveBeenCalled();
  for (let i = 0; i < 30; i++) { audio.oncanplay?.(); player.tick(); }
  expect(audio.seeks).toEqual([90]); expect(audio.play).not.toHaveBeenCalled();
  audio.seeked(); audio.oncanplay?.();
  expect(send).toHaveBeenCalledExactlyOnceWith({ type: 'ready', roomId: 'room', transitionId: 'transition-1', sourceEpoch: 1 });
});

it('reuses the audio resource across seek epochs and starts at the chosen position after commit', async () => {
  const { player, audio, send, url, setTime } = setup();
  await player.sync(room(), 0); audio.buffered(); send.mockClear();
  const seek = room(2, 90000); await player.sync(seek, 0);
  expect(url).toHaveBeenCalledTimes(1); expect(audio.load).toHaveBeenCalledTimes(1);
  expect(audio.seeks).toEqual([90]); expect(send).not.toHaveBeenCalled();
  audio.seeked(); expect(send).toHaveBeenCalledTimes(1);
  seek.pending!.committed = true; seek.pending!.playback.effectiveAtServerMs = 100200;
  await player.sync(seek, 0); player.tick(); expect(audio.play).not.toHaveBeenCalled();
  setTime(100200); player.tick(); expect(audio.currentTime).toBe(90); expect(audio.play).toHaveBeenCalledTimes(1);
});

it('also seeks while paused without starting playback', async () => {
  const { player, audio, setTime } = setup();
  const paused = room(1, 150000, 'paused');
  await player.sync(paused, 0); audio.buffered(); audio.seeked();
  paused.pending = null; await player.sync(paused, 0); setTime(110000); player.tick();
  expect(audio.currentTime).toBe(150); expect(audio.play).not.toHaveBeenCalled();
});

it('uses updated clock offsets on an unchanged epoch and timestamps progress samples', async () => {
  const { player, audio, send, setTime } = setup();
  const active = room(); active.pending = null; active.playback.effectiveAtServerMs = 200000;
  await player.sync(active, 100000); audio.buffered(); player.tick();
  expect(audio.play).toHaveBeenCalledTimes(1);
  setTime(101500); audio.advance(1.5); await player.sync(active, 100000); player.tick();
  expect(send).toHaveBeenLastCalledWith({ type: 'progress', roomId: 'room', sourceEpoch: 1, positionMs: 1500, sampledAtServerMs: 201500 });
  expect(audio.seeks).toEqual([]);
});

it('does not report a stale position while a drift correction is seeking', async () => {
  const { player, audio, send, setTime } = setup();
  const active = room(); active.pending = null; active.playback.effectiveAtServerMs = 100000;
  await player.sync(active, 0); audio.buffered();
  setTime(103000); player.tick(); player.tick();
  expect(audio.seeks).toEqual([3]); expect(send).not.toHaveBeenCalled();
  audio.seeked(); player.tick(); expect(send).toHaveBeenCalledTimes(1);
});

it('ignores a previous song URL resolving after switching songs or leaving', async () => {
  const audio = new FakeAudio(); const resolves: ((url: string) => void)[] = [];
  const player = new CloudPlayer(audio as unknown as HTMLAudioElement, () => new Promise(resolve => resolves.push(resolve)), vi.fn(), vi.fn());
  const first = player.sync(room(), 0);
  const next = room(2); next.playlist[0].ossKey = 'music/next.mp3';
  const second = player.sync(next, 0);
  resolves[0]('stale'); await first; expect(audio.src).toBe('');
  player.clear(); resolves[1]('also-stale'); await second; expect(audio.src).toBe('');
});
