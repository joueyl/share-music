import { invoke } from '@tauri-apps/api/core';
import type { PlaybackMedia } from '../cloud-player';

type NativeState = {
  prepared: boolean; playing: boolean; seeking: boolean; buffering: boolean;
  positionMs: number; durationMs: number; errorCode: number; sampledAtMs: number;
};
type Operation =
  | { action: 'load'; url: string; sizeBytes: number; volume: number; initialMs?: number; initialAtMs?: number }
  | { action: 'seek'; positionMs: number }
  | { action: 'volume'; volume: number }
  | { action: 'clear' | 'state' | 'play' | 'pause' | 'background-stop' };

/** The shared room clock drives a native player instead of an HTML element in packaged Android. */
export class AndroidPlayback implements PlaybackMedia {
  src = '';
  crossOrigin: string | null = null;
  readyState = 0;
  paused = true;
  seeking = false;
  error: { code: number } | null = null;
  nativeDurationMs = 0;
  nativeSampledAtMs = 0;
  // Android's MediaDataSource does not expose a time-based buffered range.
  readonly buffered = {
    length: 0,
    start: (_index: number) => { throw new RangeError(); },
    end: (_index: number) => { throw new RangeError(); },
  };
  onloadedmetadata: PlaybackMedia['onloadedmetadata'] = null;
  oncanplay: PlaybackMedia['oncanplay'] = null;
  onseeked: PlaybackMedia['onseeked'] = null;
  onerror: PlaybackMedia['onerror'] = null;
  onwaiting: PlaybackMedia['onwaiting'] = null;
  onplaying: PlaybackMedia['onplaying'] = null;
  private positionMs = 0;
  private sizeBytes = 0;
  private volume = 1;
  private revision = 0;
  private pending = 0;
  private serial = 0;
  private queue = Promise.resolve();
  private wanted = false;
  private waiting = false;

  get currentTime() { return this.positionMs / 1000; }
  set currentTime(value: number) {
    if (!this.src || this.readyState < 1 || this.seeking) return;
    this.seeking = true; this.readyState = 1;
    void this.dispatch({ action: 'seek', positionMs: Math.max(0, Math.round(value * 1000)) });
  }

  loadNativeSource(url: string, sizeBytes: number, initialSeek?: { positionMs: number; sampledAtMs: number }) {
    this.src = url; this.sizeBytes = sizeBytes; this.load(initialSeek);
  }

  load(initialSeek?: { positionMs: number; sampledAtMs: number }) {
    if (!this.src) return;
    this.reset();
    void this.dispatch({ action: 'load', url: this.src, sizeBytes: this.sizeBytes, volume: this.volume,
      ...(initialSeek ? { initialMs: initialSeek.positionMs, initialAtMs: initialSeek.sampledAtMs } : {}) });
  }

  stopBackground() {
    void this.dispatch({ action: 'background-stop' });
  }

  removeAttribute(name: string) {
    if (name !== 'src' || !this.src) return;
    this.src = ''; this.sizeBytes = 0; this.reset();
    void this.dispatch({ action: 'clear' });
  }

  pause() {
    if (!this.src || (!this.wanted && this.paused)) return;
    this.wanted = false; this.paused = true;
    void this.dispatch({ action: 'pause' });
  }

  async play() {
    if (!this.src || this.wanted || this.readyState < 3 || this.seeking) return;
    this.wanted = true;
    await this.dispatch({ action: 'play' });
  }

  async setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.src) await this.dispatch({ action: 'volume', volume: this.volume });
  }

  poll() {
    if (this.src && !this.pending && !this.error) void this.dispatch({ action: 'state' });
  }

  private reset() {
    ++this.revision;
    this.positionMs = 0; this.readyState = 0; this.error = null;
    this.nativeDurationMs = 0;
    this.nativeSampledAtMs = 0;
    this.paused = true; this.seeking = false; this.wanted = false; this.waiting = false;
  }

  private dispatch(operation: Operation) {
    const revision = this.revision, serial = ++this.serial;
    ++this.pending;
    const task = this.queue.then(async () => {
      if (revision !== this.revision && operation.action !== 'clear') return;
      try {
        const result = await invoke<NativeState>('plugin:android-playback|operate', { operation });
        if (revision === this.revision && serial === this.serial && this.src) this.update(result);
      } catch {
        if (revision === this.revision && this.src) this.fail(0);
      }
    }).finally(() => { --this.pending; });
    this.queue = task;
    return task;
  }

  private fire(type: 'loadedmetadata' | 'canplay' | 'seeked' | 'error' | 'waiting' | 'playing') {
    const handler = this[`on${type}`];
    if (handler) Reflect.apply(handler, this, [new Event(type)]);
  }

  private fail(code: number) {
    if (this.error) return;
    this.error = { code }; this.readyState = 0;
    this.paused = true; this.seeking = false; this.wanted = false;
    this.fire('error');
  }

  private update(state: NativeState) {
    if (state.errorCode) { this.fail(state.errorCode); return; }
    const previousReady = this.readyState, wasSeeking = this.seeking, revision = this.revision;
    const wasWaiting = this.waiting;
    this.positionMs = state.positionMs;
    this.nativeSampledAtMs = state.sampledAtMs;
    this.nativeDurationMs = state.durationMs;
    this.seeking = state.seeking;
    this.paused = !state.playing;
    this.waiting = state.buffering && state.playing;
    this.readyState = !state.prepared ? 0 : state.seeking ? 1 : state.buffering ? 2 : 3;
    if (wasSeeking && !this.seeking) this.fire('seeked');
    if (revision !== this.revision || this.seeking) return;
    if (this.waiting && !wasWaiting) this.fire('waiting');
    if (wasWaiting && !this.waiting && state.playing) this.fire('playing');
    if (previousReady < 1 && this.readyState >= 1) this.fire('loadedmetadata');
    if (previousReady < 3 && this.readyState >= 3 && !this.seeking) this.fire('canplay');
  }
}
