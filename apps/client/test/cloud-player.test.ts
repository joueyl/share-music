import { expect, it, vi } from 'vitest';
import type { Playback, RoomSnapshot } from '@music-share/shared';
import { CloudPlayer } from '../src/cloud-player';

class FakeAudio {
  crossOrigin: string | null = null;
  src = ''; readyState = 0; seeking = false; paused = true;
  onloadedmetadata?: () => void; oncanplay?: () => void; onseeked?: () => void; onerror?: () => void;
  seeks: number[] = []; private position = 0;
  get currentTime() { return this.position; }
  set currentTime(value: number) { this.position = value; this.seeks.push(value); this.seeking = true; }
  pause = vi.fn(() => { this.paused = true; });
  play = vi.fn(async () => { this.paused = false; });
  load = vi.fn(() => { this.readyState = 0; });
  removeAttribute(name: string) { if (name === 'crossorigin') this.crossOrigin = null; else if (name === 'src') this.src = ''; }
  buffered() { this.readyState = 3; this.oncanplay?.(); }
  seeked() { this.seeking = false; this.readyState = 3; this.onseeked?.(); }
  advance(seconds: number) { this.position += seconds; }
}

it('requests CORS-readable audio and falls back to ordinary playback once when analysis is blocked', async () => {
  const { player, audio } = setup();
  await player.sync(room(), 0);
  expect(audio.crossOrigin).toBe('anonymous');
  const url = audio.src;
  audio.onerror?.();
  expect(audio.crossOrigin).toBeNull(); expect(audio.src).toBe(url); expect(audio.load).toHaveBeenCalledTimes(2);
  audio.buffered();
});

it('replaces an analyser-bound element for non-CORS fallback and retains playback synchronization', async () => {
  const previous = new FakeAudio(), next = new FakeAudio(), replace = vi.fn(() => next as unknown as HTMLAudioElement), emit = vi.fn();
  const player = new CloudPlayer(previous as unknown as HTMLAudioElement, async () => 'https://oss.test/song.mp3', vi.fn(), emit, () => 100000, replace);
  const active = room(); active.pending = null; active.playback.effectiveAtServerMs = 100000;
  await player.sync(active, 0); previous.onerror?.();
  expect(replace).toHaveBeenCalledExactlyOnceWith(previous); expect(previous.pause).toHaveBeenCalled();
  expect(next.src).toBe('https://oss.test/song.mp3'); expect(next.crossOrigin).toBeNull();
  next.buffered(); player.tick(); expect(next.play).toHaveBeenCalledOnce();
  next.onerror?.(); expect(emit).toHaveBeenCalledWith('server-message', expect.objectContaining({type:'error'}));
  expect(replace).toHaveBeenCalledOnce();
});

it('revokes a local audio Blob on leaving and ignores/revokes a stale download', async () => {
  const audio = new FakeAudio(), release = vi.fn(), staleRelease = vi.fn();
  let finish!: (source: {url:string;release:()=>void}) => void;
  const load = vi.fn().mockResolvedValueOnce({url:'blob:first',release}).mockImplementationOnce(() => new Promise(resolve => {finish=resolve;}));
  const player = new CloudPlayer(audio as unknown as HTMLAudioElement, load, vi.fn(), vi.fn());
  await player.sync(room(),0); expect(audio.src).toBe('blob:first'); expect(audio.crossOrigin).toBe('anonymous');
  const next = room(2); next.playlist[0].ossKey = 'music/second'; const pending = player.sync(next,0);
  expect(release).toHaveBeenCalledOnce(); player.clear();
  finish({url:'blob:stale',release:staleRelease}); await pending;
  expect(staleRelease).toHaveBeenCalledOnce(); expect(audio.src).toBe('');
});
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
  return { audio, url, send, emit, player, setTime: (value: number) => { time = value; } };
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
it('reports download failure as an audio error and permits a later explicit transition to reload', async () => {
 const audio = new FakeAudio(), emit = vi.fn(), load = vi.fn().mockRejectedValueOnce(new Error('MUSIC_CONTENT_CHANGED')).mockResolvedValue('blob:next');
 const player = new CloudPlayer(audio as unknown as HTMLAudioElement, load, vi.fn(), emit);
 await player.sync(room(),0);
 expect(emit).toHaveBeenCalledWith('media-status',expect.objectContaining({status:'error'}));
 expect(emit).toHaveBeenCalledWith('server-message',{type:'error',error:'MUSIC_CONTENT_CHANGED'});
 await player.sync(room(2),0);expect(load).toHaveBeenCalledTimes(2);expect(audio.src).toBe('blob:next');
});
it('reports real buffered time instead of a fixed zero', async () => {
 const {player,audio,emit,setTime} = setup(); const active=room();active.pending=null;active.playback.effectiveAtServerMs=100000;
 await player.sync(active,0);audio.buffered();
 Object.defineProperty(audio,'buffered',{value:{length:1,start:()=>0,end:()=>12}});
 setTime(100000);player.tick();
 expect(emit).toHaveBeenCalledWith('media-status',expect.objectContaining({bufferedMs:12000}));
});
it('loads a different room even when its source epoch equals the previous room', async () => {
 const {player,url} = setup();await player.sync(room(),0);
 const next=room();next.id='another-room';await player.sync(next,0);
 expect(url).toHaveBeenCalledTimes(2);
});
it('does not retry a failed download on every same-epoch room snapshot', async () => {
 const load=vi.fn().mockRejectedValue(new Error('MUSIC_DOWNLOAD_FAILED'));
 const player=new CloudPlayer(new FakeAudio() as unknown as HTMLAudioElement,load,vi.fn(),vi.fn());
 await player.sync(room(),0);await player.sync(room(),0);player.tick();
 expect(load).toHaveBeenCalledOnce();
});
