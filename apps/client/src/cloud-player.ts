import { positionAt, hasRemoteAudio, type RoomSnapshot, type TrackMetadata } from '@music-share/shared';
import type { PlaybackSource } from './playback-source';

/** A transition is ready only after the media has actually sought and buffered at its target. */
export class CloudPlayer {
  private room: RoomSnapshot | null = null;
  private offset = 0;
  private epoch = -1;
  private identity = '';
  private source = '';
  private generation = 0;
  private loading = false;
  private ready = false;
  private reported = 0;
  private listenedMs = 0;
  private listeningSample?: {at:number;position:number};
  private releaseSource: (() => void) | undefined;
  private seekTarget?: number;
  private correctAfter = 0;
  private healthSample?: { at: number; position: number };
  private stalledSince?: number;
  private recovered = false;

  constructor(
    private audio: HTMLAudioElement,
    private url: (roomId: string, trackId: string, track: TrackMetadata) => Promise<string | PlaybackSource>,
    private send: (message: unknown) => Promise<void>,
    private emit: (name: string, value: unknown) => void,
    private now = () => Date.now(),
    private replaceAudio?: (previous: HTMLAudioElement) => HTMLAudioElement,
  ) {
    this.bindAudio();
  }
  private bindAudio() {
    const audio = this.audio;
    audio.onloadedmetadata = audio.oncanplay = () => this.prepare();
    audio.onseeked = () => {
      this.correctAfter = this.now() + 1500;
      this.prepare();
    };
    audio.onerror = () => {
      this.listeningSample=undefined;
      // CORS enables waveform access. Some music providers can still play without analysis.
      if (audio.crossOrigin === 'anonymous' && audio.src && !audio.src.startsWith('blob:')) {
        this.ready = false;
        if (this.replaceAudio) {
          // A source node permanently owns its element. Use a fresh element for
          // non-CORS playback rather than silently routing opaque audio into it.
          const url = audio.src; audio.pause();
          audio.onloadedmetadata = audio.oncanplay = audio.onseeked = audio.onerror = null;
          this.audio = this.replaceAudio(audio); this.bindAudio();
          this.audio.removeAttribute('crossorigin'); this.audio.src = url; this.audio.load();
        } else { audio.removeAttribute('crossorigin'); audio.load(); }
        return;
      }
      this.ready = false; this.loading = false; this.source = '';
      this.emit('media-status', { status: 'error', detail: '当前音频无法播放，请重新选择歌曲', bufferedMs: 0, driftMs: 0, receiveBps: 0 });
      this.emit('server-message', { type: 'error', error: '音乐加载失败，请重试获取音乐链接' });
    };
  }

  clear() {
    this.room = null; this.epoch = -1; this.identity = ''; this.source = ''; ++this.generation;
    this.ready = false; this.loading = false;
    this.resetRecovery();
    this.listenedMs=0;this.listeningSample=undefined;
    this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load();
    this.releaseSource?.(); this.releaseSource = undefined;
  }

  async sync(room: RoomSnapshot, offset: number) {
    this.room = room; this.offset = offset;
    const p = room.pending?.playback ?? room.playback;
    const track = room.playlist.find(t => t.id === p.sourceId);
    if (!track || !hasRemoteAudio(track)) { this.clear(); return; }
    const identity = `${room.id}/${track.id}`;
    if (this.epoch === p.sourceEpoch && this.identity === identity) return;
    this.identity = identity; this.epoch = p.sourceEpoch; this.ready = false; this.reported = this.now();
    this.resetRecovery();
    this.listenedMs=0;this.listeningSample=undefined;
    this.audio.pause();
    // Seeking/pausing the same file must not discard its metadata and buffered data.
    const source = `${room.id}/${track.id}/${track.ossKey??track.contentHash}`;
    if (this.source === source) { this.prepare(); return; }
    this.source = source; this.loading = true;
    if (this.audio.src) { this.audio.removeAttribute('src'); this.audio.load(); }
    this.releaseSource?.(); this.releaseSource = undefined;
    const generation = ++this.generation;
    try {
      const result = await this.url(room.id, track.id, track);
      if (generation !== this.generation) { if (typeof result !== 'string') result.release(); return; }
      const url = typeof result === 'string' ? result : result.url;
      this.releaseSource = typeof result === 'string' ? undefined : result.release;
      this.audio.crossOrigin = 'anonymous';
      this.audio.src = url; this.audio.load(); this.loading = false;
      this.prepare();
    } catch (error) {
      if (generation === this.generation) {
        this.loading = false; this.source = '';
        this.emit('media-status', { status: 'error', detail: '音乐加载失败，请重新选择歌曲', bufferedMs: 0, driftMs: 0, receiveBps: 0 });
        this.emit('server-message', { type: 'error', error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  private prepare() {
    if (!this.room || this.loading || this.ready || this.audio.readyState < 1 || this.audio.seeking) return;
    const pending = this.room.pending;
    const p = pending?.playback ?? this.room.playback;
    // A seek must finish against its original target, not chase a moving clock
    // forever when decoding/seek completion takes longer than the drift limit.
    const target = this.seekTarget ?? (pending && !pending.committed ? p.positionMs : positionAt(p, this.now() + this.offset));
    if (Math.abs(this.audio.currentTime * 1000 - target) > 250) {
      this.listeningSample=undefined;
      this.seekTarget = target;
      this.audio.currentTime = target / 1000;
      return; // Wait for seeked/canplay; assigning currentTime does not mean the seek finished.
    }
    if (this.audio.readyState < 3) return;
    this.ready = true;
    this.seekTarget = undefined;
    if (pending && !pending.committed) void this.send({ type: 'ready', roomId: this.room.id, transitionId: pending.id, sourceEpoch: this.epoch }).catch(() => {});
  }

  private bufferedMs() {
    const ranges = this.audio.buffered;
    if (!ranges) return 0;
    for (let i = 0; i < ranges.length; i++) {
      if (ranges.start(i) <= this.audio.currentTime && ranges.end(i) >= this.audio.currentTime)
        return Math.max(0, (ranges.end(i) - this.audio.currentTime) * 1000);
    }
    return 0;
  }

  private resetRecovery() {
    this.seekTarget = undefined; this.correctAfter = 0;
    this.healthSample = undefined; this.stalledSince = undefined; this.recovered = false;
  }

  private checkPlaybackHealth() {
    const p = this.room!.pending?.playback ?? this.room!.playback;
    const at = this.now(), position = this.audio.currentTime * 1000;
    if (this.loading || !this.source || !this.audio.src || p.sourceEpoch !== this.epoch ||
        this.room!.pending && !this.room!.pending.committed || p.playState !== 'playing' || at + this.offset < p.effectiveAtServerMs) {
      this.healthSample = undefined; this.stalledSince = undefined; return;
    }
    const previous = this.healthSample;
    const elapsed = previous ? at - previous.at : 0;
    const advanced = previous ? position - previous.position : 0;
    // Seeks and suspended timer gaps are not proof that the decoder is playing.
    if (!previous || elapsed <= 0 || elapsed > 2500 ||
        !this.audio.paused && !this.audio.seeking && this.audio.readyState >= 3 && advanced > 0 && advanced <= elapsed + 250) {
      this.stalledSince = at;
    }
    this.healthSample = { at, position };
    if (at - (this.stalledSince ?? at) < 8000) return;
    this.listeningSample = undefined;
    this.ready = false; this.seekTarget = undefined;
    this.audio.pause();
    this.stalledSince = at;
    if (!this.recovered) {
      // Reuse the verified Blob and the sole Audio; no new download or room command.
      this.recovered = true; this.audio.load();
      this.emit('media-status', { status: 'buffering', detail: '音频停滞，正在恢复播放', bufferedMs: 0, driftMs: 0, receiveBps: 0 });
    } else {
      this.source = '';
      this.emit('media-status', { status: 'error', detail: '音频恢复失败，请暂停后重新播放', bufferedMs: 0, driftMs: 0, receiveBps: 0 });
      this.emit('server-message', { type: 'error', error: '音频恢复失败，请暂停后重新播放；若仍无声请检查系统输出设备' });
    }
  }

  tick() {
    if (!this.room) return;
    this.checkPlaybackHealth();
    if (!this.source) return;
    this.prepare();
    if (!this.ready || this.room.pending && !this.room.pending.committed) {this.listeningSample=undefined;return;}
    const p = this.room.pending?.playback ?? this.room.playback;
    if (p.sourceEpoch !== this.epoch) {this.listeningSample=undefined;return;}
    const now = this.now() + this.offset;
    const target = positionAt(p, now);
    if (now < p.effectiveAtServerMs) { this.listeningSample=undefined;this.audio.pause(); return; }
    // Never restart a seek while the browser is still fetching/decoding its target.
    if (this.audio.seeking) {this.listeningSample=undefined;return;}
    const drift = this.audio.currentTime * 1000 - target;
    if (Math.abs(drift) > (p.playState === 'playing' ? 600 : 250) && (p.playState !== 'playing' || this.now() >= this.correctAfter)) {
      this.listeningSample=undefined;
      if (p.playState !== 'playing') this.audio.pause();
      this.audio.currentTime = target / 1000; return;
    }
    if (p.playState !== 'playing') { this.listeningSample=undefined;this.audio.pause(); return; }
    if (this.audio.readyState < 3) {this.listeningSample=undefined;return;}
    if (this.audio.paused) {this.listeningSample=undefined;void this.audio.play().catch(() => this.emit('server-message', { type: 'error', error: '请点击页面以允许播放' }));}
    else {
      const at=this.now(),position=this.audio.currentTime*1000,previous=this.listeningSample;
      if(previous){
        const elapsed=at-previous.at,advanced=position-previous.position;
        // Never count suspended timers, buffering, seeks or synchronization jumps.
        if(elapsed>0&&elapsed<=2500&&advanced>0&&advanced<=elapsed+250)this.listenedMs+=Math.min(elapsed,advanced);
      }
      this.listeningSample={at,position};
    }
    this.emit('media-status', { status: this.audio.paused ? 'buffering' : 'playing', detail: '音乐直链 · WebSocket 同步', bufferedMs: this.bufferedMs(), driftMs: drift, receiveBps: 0 });
    if (!this.room.pending && this.now() - this.reported > 1000 && !this.audio.paused) {
      this.reported = this.now();
      void this.send({ type: 'progress', roomId: this.room.id, sourceEpoch: this.epoch, positionMs: this.audio.currentTime * 1000, sampledAtServerMs: now, listenedMs:this.listenedMs }).catch(() => {});
    }
  }
}
