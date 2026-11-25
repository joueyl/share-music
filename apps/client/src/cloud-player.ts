import { positionAt, hasRemoteAudio, type Playback, type RoomSnapshot, type TrackMetadata } from '@music-share/shared';
import type { PlaybackSource } from './playback-source';

export type AndroidStartupStage = 'snapshot' | 'link-ready' | 'link-failed' | 'retry-link' | 'local-ready' | 'room-committed' | 'room-active' | 'play-request';
export type AndroidStartupTrace = { id: number; startMs: number };
export type AndroidStartupEvent = AndroidStartupTrace & { stage: AndroidStartupStage; atMs: number; leadMs?: number };

export type PlaybackDiagnostic = { positionMs: number } & (
  | { kind: 'correction'; driftMs: number }
  | { kind: 'waiting' | 'playing' | 'reload' | 'stalled' }
  | { kind: 'media-error'; code: number }
  | { kind: 'play-rejected' }
  | ({ kind: 'startup' } & AndroidStartupEvent)
);

export type PlaybackMedia = Pick<HTMLAudioElement,
  'src' | 'currentTime' | 'readyState' | 'paused' | 'seeking' | 'buffered' | 'crossOrigin' |
  'load' | 'play' | 'pause' | 'removeAttribute' | 'onloadedmetadata' | 'oncanplay' | 'onseeked' |
  'onerror' | 'onwaiting' | 'onplaying'> & {
  loadNativeSource?(url: string, sizeBytes: number, initialSeek?: { positionMs: number; sampledAtMs: number }, cacheKey?: string, trace?: AndroidStartupTrace): void;
  logStartup?(event: AndroidStartupEvent): void;
  setStartupLogging?(enabled: boolean): void;
  stopBackground?(): void;
  readonly nativeDurationMs?: number;
  readonly nativeSampledAtMs?: number;
  readonly error: { code: number } | null;
};

/** A transition is ready only after the media has actually sought and buffered at its target. */
export class CloudPlayer {
  private room: RoomSnapshot | null = null;
  private offset = 0;
  private localUserId: string | null = null;
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
  private diagnostic?: (event: PlaybackDiagnostic) => void;
  private reportedWaiting = false;
  private renewNativeSource?: () => Promise<string | PlaybackSource>;
  private nativeStarted = false;
  private nativePreparedEpoch?: number;
  private nativeDrift?: { direction: number; since: number; position: number };
  private nativeCorrectionStartedAt?: number;
  private nativeSeekDurationMs = 0;

  private startupSequence = 0;
  private startup?: AndroidStartupTrace & { epoch: number; seen: Set<AndroidStartupStage> };

  private markStartup(stage: AndroidStartupStage, leadMs?: number) {
    const startup = this.startup;
    if (!startup || !this.diagnostic || startup.seen.has(stage)) return;
    startup.seen.add(stage);
    const event: AndroidStartupEvent = { id: startup.id, startMs: startup.startMs, stage, atMs: this.now(), leadMs };
    this.audio.logStartup?.(event);
    this.diagnostic({ kind: 'startup', positionMs: this.diagnosticPosition(), ...event });
  }

  private markRoomStart(room: RoomSnapshot, playback: Playback) {
    if (this.startup?.epoch !== playback.sourceEpoch || playback.playState !== 'playing') return;
    if (room.pending?.committed) {
      if (!this.startup.seen.has('room-active'))
        this.markStartup('room-committed', Math.round(playback.effectiveAtServerMs - this.now() - this.offset));
    } else if (!room.pending && !this.startup.seen.has('room-committed')) {
      this.markStartup('room-active');
    }
  }

  setDiagnostic(observer?: (event: PlaybackDiagnostic) => void) {
    this.diagnostic = observer;
    if (!observer) this.startup = undefined;
    this.audio.setStartupLogging?.(!!observer);
    this.reportedWaiting = false;
  }

  private diagnosticPosition() {
    return Math.round(this.audio.currentTime * 1000);
  }

  private playablePosition(positionMs: number) {
    const duration = this.audio.nativeDurationMs;
    return duration && duration > 0 ? Math.min(duration, positionMs) : positionMs;
  }

  private waitingForStart(p: Playback, serverNow: number) {
    if (!this.audio.loadNativeSource) return serverNow < p.effectiveAtServerMs;
    // After the transition is applied, effectiveAtServerMs anchors the leader's
    // sampled progress. It is not a new invitation to pause the follower.
    if (this.nativeStarted) return false;
    if (!this.room?.pending || (this.room.pending.committed && serverNow >= p.effectiveAtServerMs)) {
      this.nativeStarted = true;
      return false;
    }
    return true;
  }

  private isNativeLeader(playback: Playback) {
    return !!this.audio.loadNativeSource && this.localUserId !== null && playback.leaderId === this.localUserId;
  }

  nativeLeaderPosition(roomId: string, sourceEpoch: number): number | undefined {
    const room = this.room;
    if (!room || room.id !== roomId || room.pending || this.epoch !== sourceEpoch ||
        room.playback.sourceEpoch !== sourceEpoch || room.playback.playState !== 'playing' ||
        !this.isNativeLeader(room.playback) || !this.ready || this.audio.seeking || this.audio.error ||
        !this.audio.nativeSampledAtMs) return undefined;
    return Math.round(this.audio.currentTime * 1000);
  }

  private shouldCorrectNative(playback: Playback, drift: number, position: number, at: number, fresh: boolean) {
    if (this.isNativeLeader(playback) || this.now() < this.correctAfter || !fresh || this.audio.paused || this.audio.readyState < 3 || Math.abs(drift) <= 600) {
      this.nativeDrift = undefined;
      return false;
    }
    const direction = Math.sign(drift);
    const observed = this.nativeDrift;
    if (!observed || observed.direction !== direction) {
      this.nativeDrift = { direction, since: at, position };
      return false;
    }
    if (at - observed.since < 500) return false;
    // An unchanged decoder position may be waiting on data, not drifting.
    if (position - observed.position < 100) { this.nativeDrift = undefined; return false; }
    return true;
  }

  constructor(
    private audio: PlaybackMedia,
    private url: (roomId: string, trackId: string, track: TrackMetadata, refresh?: boolean) => Promise<string | PlaybackSource>,
    private send: (message: unknown) => Promise<void>,
    private emit: (name: string, value: unknown) => void,
    private now = () => Date.now(),
    private replaceAudio?: (previous: PlaybackMedia) => PlaybackMedia,
  ) {
    this.bindAudio();
  }
  private bindAudio() {
    const audio = this.audio;
    audio.onwaiting = () => {
      if (!this.diagnostic || !this.ready || audio.paused || audio.seeking || this.reportedWaiting) return;
      this.reportedWaiting = true;
      this.diagnostic({ kind: 'waiting', positionMs: this.diagnosticPosition() });
    };
    audio.onplaying = () => {
      if (!this.reportedWaiting) return;
      this.reportedWaiting = false;
      this.diagnostic?.({ kind: 'playing', positionMs: this.diagnosticPosition() });
    };
    audio.onloadedmetadata = audio.oncanplay = () => this.prepare();
    audio.onseeked = () => {
      const at = this.now();
      if (this.nativeCorrectionStartedAt !== undefined) {
        this.nativeSeekDurationMs = Math.min(1000, Math.max(0, at - this.nativeCorrectionStartedAt));
        this.nativeCorrectionStartedAt = undefined;
        this.correctAfter = at + 3000;
      } else {
        this.correctAfter = at + 1500;
      }
      this.prepare();
    };
    audio.onerror = () => {
      this.listeningSample=undefined;
      this.nativeDrift = undefined; this.nativeCorrectionStartedAt = undefined;
      this.diagnostic?.({ kind: 'media-error', code: audio.error?.code ?? 0, positionMs: this.diagnosticPosition() });
      const renew = this.renewNativeSource;
      if (audio.loadNativeSource && renew) {
        this.renewNativeSource = undefined;
        this.ready = false; this.loading = true;
        this.seekTarget = undefined;
        audio.removeAttribute('src'); audio.load();
        this.releaseSource?.(); this.releaseSource = undefined;
        this.markStartup('retry-link');
        this.startup?.seen.delete('link-ready');
        void this.attachSource(renew, ++this.generation);
        return;
      }
      // CORS enables waveform access. Some music providers can still play without analysis.
      if (audio.crossOrigin === 'anonymous' && audio.src && !audio.src.startsWith('blob:')) {
        this.ready = false;
        if (this.replaceAudio) {
          // A source node permanently owns its element. Use a fresh element for
          // non-CORS playback rather than silently routing opaque audio into it.
          const url = audio.src; audio.pause();
          audio.onloadedmetadata = audio.oncanplay = audio.onseeked = audio.onerror = audio.onwaiting = audio.onplaying = null;
          this.audio = this.replaceAudio(audio); this.bindAudio();
          this.audio.removeAttribute('crossorigin'); this.audio.src = url; this.audio.load();
        } else { audio.removeAttribute('crossorigin'); audio.load(); }
        return;
      }
      this.ready = false; this.loading = false; this.source = '';
      if (audio.loadNativeSource) audio.removeAttribute('src');
      this.emit('media-status', { status: 'error', detail: '当前音频无法播放，请重新选择歌曲', bufferedMs: 0, driftMs: 0, receiveBps: 0 });
      this.emit('server-message', { type: 'error', error: '音乐加载失败，请重试获取音乐链接' });
    };
  }

  clear() {
    this.startup = undefined;
    this.room = null; this.localUserId = null; this.epoch = -1; this.identity = ''; this.source = ''; ++this.generation;
    this.ready = false; this.loading = false;
    this.resetRecovery();
    this.listenedMs=0;this.listeningSample=undefined;
    this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load();
    this.releaseSource?.(); this.releaseSource = undefined;
    this.renewNativeSource = undefined;
  }

  async sync(room: RoomSnapshot, offset: number, localUserId: string | null = null) {
    this.room = room; this.offset = offset; this.localUserId = localUserId;
    const p = room.pending?.playback ?? room.playback;
    const track = room.playlist.find(t => t.id === p.sourceId);
    if (!track || !hasRemoteAudio(track)) { this.clear(); this.audio.stopBackground?.(); return; }
    const identity = `${room.id}/${track.id}`;
    if (this.epoch === p.sourceEpoch && this.identity === identity) { this.markRoomStart(room, p); return; }
    this.identity = identity; this.epoch = p.sourceEpoch; this.ready = false; this.reported = this.now();
    this.resetRecovery();
    this.listenedMs=0;this.listeningSample=undefined;
    this.audio.pause();
    // Seeking/pausing the same file must not discard its metadata and buffered data.
    const source = `${room.id}/${track.id}/${track.ossKey??track.contentHash}`;
    if (this.source === source) { this.prepare(); return; }
    this.startup = this.diagnostic && this.audio.logStartup
      ? { id: ++this.startupSequence, startMs: this.now(), epoch: p.sourceEpoch, seen: new Set() } : undefined;
    this.markStartup('snapshot');
    this.markRoomStart(room, p);
    this.source = source; this.loading = true;
    if (this.audio.src) { this.audio.removeAttribute('src'); this.audio.load(); }
    this.releaseSource?.(); this.releaseSource = undefined;
    this.renewNativeSource = this.audio.loadNativeSource ? () => this.url(room.id, track.id, track, true) : undefined;
    const generation = ++this.generation;
    await this.attachSource(() => this.url(room.id, track.id, track), generation);
  }

  resumeAndroidRoom() {
    if (!this.audio.loadNativeSource || !this.room) return;
    this.listeningSample = undefined;
    const pending = this.room.pending;
    if (!this.loading && !this.source && this.identity) {
      // A link request may have failed during the network handoff. Retry from
      // the fresh room snapshot, not the stale URL or offline playback state.
      this.identity = '';
      void this.sync(this.room, this.offset, this.localUserId);
      return;
    }
    if (this.ready && pending && !pending.committed)
      void this.send({ type: 'ready', roomId: this.room.id, transitionId: pending.id, sourceEpoch: this.epoch }).catch(() => {});
  }

  private async attachSource(resolve: () => Promise<string | PlaybackSource>, generation: number) {
    try {
      const result = await resolve();
      if (generation !== this.generation) { if (typeof result !== 'string') result.release(); return; }
      const url = typeof result === 'string' ? result : result.url;
      this.releaseSource = typeof result === 'string' ? undefined : result.release;
      if (this.audio.loadNativeSource) {
        if (typeof result === 'string' || !result.sizeBytes) throw new Error('PLAYBACK_AUDIO_METADATA_INVALID');
        const room = this.room, at = this.now();
        // A room already playing doesn't need a new prepare/ready round trip.
        // Let Android position directly from onPrepared instead of polling once to
        // learn that it can seek and then crossing the bridge again.
        const initial = room && !room.pending && room.playback.playState === 'playing'
          ? { positionMs: Math.max(0, Math.round(positionAt(room.playback, at + this.offset))), sampledAtMs: at }
          : undefined;
        this.nativePreparedEpoch = initial ? this.epoch : undefined;
        this.markStartup('link-ready');
        this.audio.loadNativeSource(url, result.sizeBytes, initial, result.nativeCacheKey, this.startup);
      } else {
        this.audio.crossOrigin = 'anonymous';
        this.audio.src = url; this.audio.load();
      }
      this.loading = false;
      this.prepare();
    } catch (error) {
      if (generation === this.generation) {
        this.markStartup('link-failed');
        this.loading = false; this.source = ''; this.renewNativeSource = undefined;
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
    const target = this.seekTarget ?? this.playablePosition(pending && !pending.committed ? p.positionMs : positionAt(p, this.now() + this.offset));
    const nativePositioned = !pending && this.nativePreparedEpoch === p.sourceEpoch;
    if (!nativePositioned && Math.abs(this.audio.currentTime * 1000 - target) > 250) {
      this.listeningSample=undefined;
      this.seekTarget = target;
      this.audio.currentTime = target / 1000;
      return; // Wait for seeked/canplay; assigning currentTime does not mean the seek finished.
    }
    if (this.audio.readyState < 3) return;
    this.ready = true;
    this.markStartup('local-ready');
    this.nativePreparedEpoch = undefined;
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
    this.reportedWaiting = false;
    this.nativeStarted = false; this.nativePreparedEpoch = undefined; this.nativeDrift = undefined;
    this.nativeCorrectionStartedAt = undefined; this.nativeSeekDurationMs = 0;
  }

  private checkPlaybackHealth() {
    const p = this.room!.pending?.playback ?? this.room!.playback;
    const at = this.now(), position = this.audio.currentTime * 1000;
    if (this.loading || !this.source || !this.audio.src || p.sourceEpoch !== this.epoch ||
        this.room!.pending && !this.room!.pending.committed || p.playState !== 'playing' || this.waitingForStart(p, at + this.offset)) {
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
    this.nativeDrift = undefined; this.nativeCorrectionStartedAt = undefined;
    this.ready = false; this.seekTarget = undefined;
    this.audio.pause();
    this.stalledSince = at;
    this.diagnostic?.({ kind: this.recovered ? 'stalled' : 'reload', positionMs: position });
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
    const at = this.now(), now = at + this.offset;
    if (this.waitingForStart(p, now)) { this.listeningSample=undefined;this.audio.pause(); return; }
    // Never restart a seek while the browser is still fetching/decoding its target.
    if (this.audio.seeking) {this.listeningSample=undefined;return;}
    const native = !!this.audio.loadNativeSource;
    const nativePlaying = native && p.playState === 'playing';
    const sampledAt = native ? this.audio.nativeSampledAtMs ?? 0 : at;
    const fresh = !native || (sampledAt > 0 && sampledAt <= at && at - sampledAt <= 500);
    const sampledAtServerMs = sampledAt + this.offset;
    const target = this.playablePosition(positionAt(p, nativePlaying && fresh ? sampledAtServerMs : now));
    const position = this.audio.currentTime * 1000, drift = position - target;
    if (nativePlaying ? this.shouldCorrectNative(p, drift, position, sampledAt, fresh) :
        Math.abs(drift) > (p.playState === 'playing' ? 600 : 250) && (p.playState !== 'playing' || at >= this.correctAfter)) {
      this.listeningSample=undefined;
      if (p.playState === 'playing' && !this.audio.paused) {
        this.diagnostic?.({ kind: 'correction', driftMs: Math.round(drift), positionMs: this.diagnosticPosition() });
      }
      if (p.playState !== 'playing') this.audio.pause();
      if (nativePlaying) {
        this.nativeDrift = undefined;
        this.nativeCorrectionStartedAt = at;
        this.audio.currentTime = this.playablePosition(positionAt(p, now + this.nativeSeekDurationMs)) / 1000;
      } else this.audio.currentTime = target / 1000;
      return;
    }
    if (p.playState !== 'playing') { this.listeningSample=undefined;this.audio.pause(); return; }
    if (this.audio.readyState < 3) {this.listeningSample=undefined;return;}
    if (this.audio.paused) {
      this.listeningSample=undefined;
      const audio = this.audio, generation = this.generation;
      this.markStartup('play-request');
      void audio.play().catch(error => {
        if (error?.name !== 'AbortError' && this.audio === audio && this.generation === generation) {
          this.diagnostic?.({ kind: 'play-rejected', positionMs: this.diagnosticPosition() });
        }
        this.emit('server-message', { type: 'error', error: '请点击页面以允许播放' });
      });
    }
    else if(fresh&&sampledAt!==this.listeningSample?.at) {
      const previous=this.listeningSample;
      if(previous){
        const elapsed=sampledAt-previous.at,advanced=position-previous.position;
        // Never count suspended timers, buffering, seeks or synchronization jumps.
        if(elapsed>0&&elapsed<=2500&&advanced>0&&advanced<=elapsed+250)this.listenedMs+=Math.min(elapsed,advanced);
      }
      this.listeningSample={at:sampledAt,position};
    }
    this.emit('media-status', { status: this.audio.paused ? 'buffering' : 'playing', detail: this.audio.loadNativeSource ? 'Android 原生播放 · WebSocket 同步' : '音乐直链 · WebSocket 同步', bufferedMs: this.bufferedMs(), driftMs: drift, receiveBps: 0 });
    if (!this.room.pending && fresh && (!native || sampledAtServerMs >= p.effectiveAtServerMs) &&
        at - this.reported > 1000 && !this.audio.paused) {
      this.reported = at;
      void this.send({ type: 'progress', roomId: this.room.id, sourceEpoch: this.epoch, positionMs: position, sampledAtServerMs, listenedMs:this.listenedMs }).catch(() => {});
    }
  }
}
