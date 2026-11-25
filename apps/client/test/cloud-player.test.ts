import { expect, it, vi } from 'vitest';
import type { Playback, RoomSnapshot } from '@music-share/shared';
import { CloudPlayer, type AndroidStartupEvent, type PlaybackMedia } from '../src/cloud-player';
import { loadPlaybackSource } from '../src/playback-source';

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

class FakeAndroidAudio extends FakeAudio {
  nativeSampledAtMs = 0;
  initialSeek?: { positionMs: number; sampledAtMs: number };
  nativeCacheKey?: string;
  logStartup = vi.fn<(event: AndroidStartupEvent) => void>();
  loadNativeSource(url: string, _size: number, initialSeek?: { positionMs: number; sampledAtMs: number }, cacheKey?: string) {
    this.src = url; this.initialSeek = initialSeek; this.nativeCacheKey = cacheKey; this.load();
  }
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

function setupAndroid() {
  let time = 100000;
  const audio = new FakeAndroidAudio();
  const send = vi.fn(async (_message: unknown) => {});
  const player = new CloudPlayer(audio as unknown as PlaybackMedia,
    async () => ({ url: 'https://m801.music.126.net/song.mp3', sizeBytes: 4, nativeCacheKey: 'a'.repeat(32), release: () => {} }),
    send, vi.fn(), () => time);
  function tick(at: number, positionMs: number, sampledAt = at) {
    time = at;
    audio.advance(positionMs / 1000 - audio.currentTime);
    audio.nativeSampledAtMs = sampledAt;
    player.tick();
  }
  return { audio, send, player, tick };
}

it('records Android source, local readiness and room commit once, only when diagnostic logging is enabled', async () => {
  const { player, audio, tick } = setupAndroid();
  await player.sync(room(), 0);
  expect(audio.logStartup).not.toHaveBeenCalled();
  player.clear();
  const observer = vi.fn(); player.setDiagnostic(observer);
  const active = room(); active.playback.effectiveAtServerMs = 100300;
  await player.sync(active, 0);
  audio.buffered();
  tick(100200, 0);
  active.pending!.committed = true;
  await player.sync(active, 0);
  await player.sync(active, 0);
  tick(100300, 0);
  expect(audio.logStartup.mock.calls.map(([event]) => event.stage)).toEqual([
    'snapshot', 'link-ready', 'local-ready', 'room-committed', 'play-request',
  ]);
  expect(observer).toHaveBeenCalledWith(expect.objectContaining({ kind: 'startup', stage: 'room-committed', leadMs: 100 }));
});

it('resends Android readiness after rejoining without replacing a prepared source', async () => {
  const { player, audio, send } = setupAndroid();
  await player.sync(room(), 0);
  audio.buffered();
  const ready = { type: 'ready', roomId: 'room', transitionId: 'transition-1', sourceEpoch: 1 };
  expect(send).toHaveBeenCalledWith(ready);
  send.mockClear();

  await player.sync(room(), 0);
  player.resumeAndroidRoom();

  expect(send).toHaveBeenCalledExactlyOnceWith(ready);
  expect(audio.load).toHaveBeenCalledOnce();
});

it('passes the active room position to native preparation without a second startup seek', async () => {
  const { player, audio, send, tick } = setupAndroid();
  const active = room(1, 40000);
  active.pending = null;
  active.playback.effectiveAtServerMs = 98000;
  await player.sync(active, 0);
  expect(audio.initialSeek).toEqual({ positionMs: 42000, sampledAtMs: 100000 });
  expect(audio.nativeCacheKey).toBe('a'.repeat(32));
  audio.advance(42.4); // Already positioned by onPrepared in the native player.
  audio.buffered();
  tick(100700, 42400);
  expect(audio.play).toHaveBeenCalledOnce();
  expect(audio.seeks).toEqual([]);
  expect(send).not.toHaveBeenCalled();
});

it('waits for the Android transition but does not pause when another member sends a newer progress anchor', async () => {
  const { player, audio, tick } = setupAndroid();
  const active = room();
  active.playback.effectiveAtServerMs = 100200;
  await player.sync(active, 0);
  audio.buffered();
  active.pending!.committed = true;
  await player.sync(active, 0);
  tick(100100, 0);
  expect(audio.play).not.toHaveBeenCalled();
  tick(100200, 0);
  expect(audio.play).toHaveBeenCalledOnce();
  audio.pause.mockClear();

  active.pending = null;
  active.playback = { ...active.playback, leaderId: 'peer', positionMs: 1000, effectiveAtServerMs: 101250 };
  await player.sync(active, 0);
  tick(101100, 950);
  expect(audio.pause).not.toHaveBeenCalled();
  expect(audio.seeks).toEqual([]);
});

it('reports Android playback using the decoder timestamp and skips stale samples', async () => {
  const { player, audio, send, tick } = setupAndroid();
  const active = room(); active.pending = null; active.playback.effectiveAtServerMs = 100200;
  await player.sync(active, 200);
  audio.buffered();
  tick(100000, 0);
  tick(101500, 500, 100500);
  expect(send).not.toHaveBeenCalled();
  tick(101600, 1300, 101300);
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ positionMs: 1300, sampledAtServerMs: 101500 }));
  expect(audio.seeks).toEqual([]);
});

it('uses the local Android leader position and still reports progress without seeking back', async () => {
  const { player, audio, send, tick } = setupAndroid();
  const active = room(); active.pending = null;
  active.playback = { ...active.playback, leaderId: 'local', effectiveAtServerMs: 100000 };
  await player.sync(active, 0, 'local');
  audio.buffered();
  tick(100000, 0); tick(101100, 2000); tick(101700, 2600);
  expect(audio.seeks).toEqual([]);
  expect(player.nativeLeaderPosition('room', 1)).toBe(2600);
  expect(player.nativeLeaderPosition('other-room', 1)).toBeUndefined();
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'progress', positionMs: 2000, sampledAtServerMs: 101100 }));

  // A seek command still positions at its requested target even when this user leads.
  const seek = room(2, 90000);
  seek.pending!.playback = { ...seek.pending!.playback, leaderId: 'local' };
  await player.sync(seek, 0, 'local');
  expect(audio.seeks).toEqual([90]);
  expect(player.nativeLeaderPosition('room', 1)).toBeUndefined();
});

it('follows the room clock again when leadership goes to another member', async () => {
  const { player, audio, tick } = setupAndroid();
  const active = room(); active.pending = null;
  active.playback = { ...active.playback, leaderId: 'local', effectiveAtServerMs: 100000 };
  await player.sync(active, 0, 'local');
  audio.buffered();
  tick(100000, 0); tick(101000, 2000); tick(101600, 2600);
  expect(audio.seeks).toEqual([]);
  active.playback = { ...active.playback, leaderId: 'peer' };
  await player.sync(active, 0, 'local');
  expect(player.nativeLeaderPosition('room', 1)).toBeUndefined();
  tick(101700, 2700); tick(102200, 3200);
  expect(audio.seeks).toEqual([2.2]);
});

it('ignores transient Android drift, then seeks only if a large offset persists while audio advances', async () => {
  const { player, audio, tick } = setupAndroid();
  const active = room(); active.pending = null; active.playback.effectiveAtServerMs = 100000;
  await player.sync(active, 0);
  audio.buffered();
  tick(100000, 0);
  tick(101000, 250); tick(101300, 1300);
  expect(audio.seeks).toEqual([]);
  tick(102000, 1000); tick(102450, 1450);
  expect(audio.seeks).toEqual([]);
  tick(102500, 1500);
  expect(audio.seeks).toEqual([2.5]);
});

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
  expect(send).toHaveBeenLastCalledWith({ type: 'progress', roomId: 'room', sourceEpoch: 1, positionMs: 1500, sampledAtServerMs: 201500,listenedMs:0 });
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

it('counts only continuous Audio playback and excludes buffering and automatic seek catch-up',async()=>{
 const {player,audio,send,setTime}=setup(),active=room();active.pending=null;active.playback.effectiveAtServerMs=100000;
 await player.sync(active,0);audio.buffered();player.tick();
 setTime(100100);audio.advance(.1);player.tick(); // First confirmed playing sample.
 for(let i=2;i<=12;i++){setTime(100000+i*100);audio.advance(.1);player.tick();}
 const reports=()=>send.mock.calls.map(([value])=>value as any).filter(value=>value.type==='progress');
 expect(reports().at(-1).listenedMs).toBeCloseTo(1000);
 audio.readyState=2;setTime(101300);player.tick(); // No ready Audio, reset measurement baseline.
 setTime(102500);audio.readyState=3;player.tick(); // Synchronization seeks to 2.5 seconds.
 expect(audio.seeking).toBe(true);audio.seeked();player.tick();
 for(let i=1;i<=12;i++){setTime(102500+i*100);audio.advance(.1);player.tick();}
 expect(reports().at(-1).listenedMs).toBeLessThan(2500); // Never adds the skipped buffering interval.
 expect(reports().at(-1).listenedMs).toBeGreaterThan(1000);
 player.clear();
});

it('does not count suspended timer gaps and resets measured time on a new playback epoch',async()=>{
 const {player,audio,send,setTime}=setup(),active=room();active.pending=null;active.playback.effectiveAtServerMs=100000;
 await player.sync(active,0);audio.buffered();player.tick();setTime(100100);audio.advance(.1);player.tick();
 setTime(110100);audio.advance(10);player.tick();
 expect((send.mock.calls.at(-1)![0] as any).listenedMs).toBe(0);
 const next=room(2,15000);next.pending=null;next.playback.effectiveAtServerMs=110100;
 await player.sync(next,0);audio.seeked();player.tick();setTime(111600);audio.advance(1.5);player.tick();
 expect((send.mock.calls.at(-1)![0] as any)).toMatchObject({type:'progress',sourceEpoch:2,listenedMs:0});
 player.clear();
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

it('silently renews an expired link before reporting ready without changing the queue or target seek',async()=>{
 const audio=new FakeAudio(),emit=vi.fn(),send=vi.fn(async()=>{}),active=room(1,90000);
 const bytes=new Uint8Array([255,251,144,0]),track={...active.playlist[0],contentHash:'a'.repeat(32),sizeBytes:4,name:'song.mp3'};
 active.playlist[0]=track;
 const before=structuredClone(active),link=vi.fn(async(refresh=false)=>({url:`https://m801.music.126.net/${refresh?'fresh':'expired'}.mp3`,contentHash:track.contentHash,sizeBytes:4}));
 let finish!:(bytes:ArrayBuffer)=>void;
 const download=vi.fn().mockRejectedValueOnce(new Error('MUSIC_LINK_EXPIRED')).mockImplementationOnce(()=>new Promise<ArrayBuffer>(resolve=>{finish=resolve;}));
 const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:renewed-song'),revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 const player=new CloudPlayer(audio as unknown as HTMLAudioElement,()=>loadPlaybackSource(link,false,track,download),send,emit,()=>100000);
 try {
  const loading=player.sync(active,0);
  for(let i=0;i<20&&!finish;i++)await Promise.resolve();
  expect(link.mock.calls).toEqual([[false],[true]]);
  expect(emit).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();expect(audio.src).toBe('');
  finish(bytes.buffer);await loading;
  expect(emit).not.toHaveBeenCalled();expect(active).toEqual(before);expect(audio.src).toBe('blob:renewed-song');
  audio.buffered();expect(audio.seeks).toEqual([90]);expect(send).not.toHaveBeenCalled();
  audio.seeked();expect(send).toHaveBeenCalledWith({type:'ready',roomId:'room',transitionId:'transition-1',sourceEpoch:1});
 } finally {player.clear();create.mockRestore();revoke.mockRestore();}
});

it('finishes a slow initial seek against a fixed target and starts before correcting again', async () => {
  const { player, audio, setTime } = setup();
  const active = room(1, 90000); active.pending = null; active.playback.effectiveAtServerMs = 100000;
  await player.sync(active, 0); audio.buffered();
  expect(audio.seeks).toEqual([90]);
  setTime(101000); audio.seeked(); player.tick();
  expect(audio.seeks).toEqual([90]); expect(audio.play).toHaveBeenCalledOnce();
  setTime(101100); audio.advance(.1); player.tick();
  expect(audio.seeks).toEqual([90]);
  // Later synchronization does not explicitly pause a playing element.
  setTime(102600); audio.advance(1.5); audio.pause.mockClear(); player.tick();
  expect(audio.seeks.at(-1)).toBe(92.6); expect(audio.pause).not.toHaveBeenCalled();
});

it('reloads a stalled decoder once per epoch, then reports failure rather than looping', async () => {
  const { player, audio, url, emit, setTime } = setup();
  const active = room(); active.pending = null; active.playback.effectiveAtServerMs = 100000;
  await player.sync(active, 0); audio.buffered(); player.tick();
  for (let i = 1; i <= 80; i++) { setTime(100000 + i * 100); player.tick(); }
  expect(audio.load).toHaveBeenCalledTimes(2); expect(url).toHaveBeenCalledOnce();
  expect(emit).toHaveBeenCalledWith('media-status', expect.objectContaining({ status: 'buffering', detail: '音频停滞，正在恢复播放' }));
  for (let i = 81; i <= 200; i++) { setTime(100000 + i * 100); player.tick(); }
  expect(audio.load).toHaveBeenCalledTimes(2);
  expect(emit.mock.calls.filter(([name, value]) => name === 'server-message' && value.type === 'error')).toHaveLength(1);
  player.clear(); setTime(130000); player.tick(); expect(audio.play).toHaveBeenCalledOnce();
});

it('does not recover normally advancing, paused, uncommitted or suspended playback', async () => {
  for (const mode of ['playing', 'paused', 'pending', 'suspended']) {
    const { player, audio, setTime } = setup();
    const active = room();
    if (mode !== 'pending') active.pending = null;
    active.playback.effectiveAtServerMs = 100000;
    if (mode === 'paused') active.playback.playState = 'paused';
    await player.sync(active, 0); audio.buffered(); player.tick();
    for (let i = 1; i <= 150; i++) {
      setTime(100000 + i * (mode === 'suspended' ? 10000 : 100));
      if (mode === 'playing') audio.advance(.1);
      player.tick();
    }
    expect(audio.load).toHaveBeenCalledOnce();
  }
});

it('resumes from the current room timeline after reload without redownloading or counting the gap', async () => {
  const { player, audio, url, send, setTime } = setup();
  const active = room(); active.pending = null; active.playback.effectiveAtServerMs = 100000;
  await player.sync(active, 0); audio.buffered(); player.tick();
  audio.readyState = 2;
  for (let i = 1; i <= 80; i++) { setTime(100000 + i * 100); player.tick(); }
  audio.seeking = false; audio.buffered(); audio.seeked(); player.tick();
  expect(audio.currentTime).toBe(8); expect(audio.paused).toBe(false);
  for (let i = 1; i <= 120; i++) { setTime(108000 + i * 100); audio.advance(.1); player.tick(); }
  expect(audio.load).toHaveBeenCalledTimes(2); expect(url).toHaveBeenCalledOnce();
  expect((send.mock.calls.at(-1)![0] as any).listenedMs).toBeLessThan(12000);
  const next = room(2); next.pending = null; next.playback.effectiveAtServerMs = 120000;
  await player.sync(next, 0); audio.seeked(); player.tick();
  for (let i = 1; i <= 80; i++) { setTime(120000 + i * 100); player.tick(); }
  expect(audio.load).toHaveBeenCalledTimes(3);
});
