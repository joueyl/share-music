import { positionAt, type RoomSnapshot } from '@music-share/shared';

/** A transition is ready only after the media has actually sought and buffered at its target. */
export class CloudPlayer {
  private room: RoomSnapshot | null = null;
  private offset = 0;
  private epoch = -1;
  private source = '';
  private generation = 0;
  private loading = false;
  private ready = false;
  private reported = 0;

  constructor(
    private audio: HTMLAudioElement,
    private url: (roomId: string, trackId: string) => Promise<string>,
    private send: (message: unknown) => Promise<void>,
    private emit: (name: string, value: unknown) => void,
    private now = () => Date.now(),
  ) {
    audio.onloadedmetadata = audio.oncanplay = audio.onseeked = () => this.prepare();
    audio.onerror = () => this.emit('server-message', { type: 'error', error: '音乐加载失败，请检查 OSS 或格式' });
  }

  clear() {
    this.room = null; this.epoch = -1; this.source = ''; ++this.generation;
    this.ready = false; this.loading = false;
    this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load();
  }

  async sync(room: RoomSnapshot, offset: number) {
    this.room = room; this.offset = offset;
    const p = room.pending?.playback ?? room.playback;
    const track = room.playlist.find(t => t.id === p.sourceId);
    if (!track?.ossKey) { this.clear(); return; }
    if (this.epoch === p.sourceEpoch) return;
    this.epoch = p.sourceEpoch; this.ready = false; this.reported = this.now();
    this.audio.pause();
    // Seeking/pausing the same file must not discard its metadata and buffered data.
    const source = `${room.id}/${track.ossKey}`;
    if (this.source === source) { this.prepare(); return; }
    this.source = source; this.loading = true;
    const generation = ++this.generation;
    try {
      const url = await this.url(room.id, track.id);
      if (generation !== this.generation) return;
      this.audio.src = url; this.audio.load(); this.loading = false;
      this.prepare();
    } catch (error) {
      if (generation === this.generation) this.emit('server-message', { type: 'error', error: String(error) });
    }
  }

  private prepare() {
    if (!this.room || this.loading || this.ready || this.audio.readyState < 1 || this.audio.seeking) return;
    const pending = this.room.pending;
    const p = pending?.playback ?? this.room.playback;
    const target = pending && !pending.committed ? p.positionMs : positionAt(p, this.now() + this.offset);
    if (Math.abs(this.audio.currentTime * 1000 - target) > 250) {
      this.audio.currentTime = target / 1000;
      return; // Wait for seeked/canplay; assigning currentTime does not mean the seek finished.
    }
    if (this.audio.readyState < 3) return;
    this.ready = true;
    if (pending && !pending.committed) void this.send({ type: 'ready', roomId: this.room.id, transitionId: pending.id, sourceEpoch: this.epoch }).catch(() => {});
  }

  tick() {
    if (!this.room) return;
    this.prepare();
    if (!this.ready || this.room.pending && !this.room.pending.committed) return;
    const p = this.room.pending?.playback ?? this.room.playback;
    if (p.sourceEpoch !== this.epoch) return;
    const now = this.now() + this.offset;
    const target = positionAt(p, now);
    if (now < p.effectiveAtServerMs) { this.audio.pause(); return; }
    // Never restart a seek while the browser is still fetching/decoding its target.
    if (this.audio.seeking) return;
    const drift = this.audio.currentTime * 1000 - target;
    if (Math.abs(drift) > (p.playState === 'playing' ? 600 : 250)) {
      this.audio.pause(); this.audio.currentTime = target / 1000; return;
    }
    if (p.playState !== 'playing') { this.audio.pause(); return; }
    if (this.audio.readyState < 3) return;
    if (this.audio.paused) void this.audio.play().catch(() => this.emit('server-message', { type: 'error', error: '请点击页面以允许播放' }));
    this.emit('media-status', { status: this.audio.paused ? 'buffering' : 'playing', detail: 'OSS · WebSocket 同步', bufferedMs: 0, driftMs: drift, receiveBps: 0 });
    if (!this.room.pending && this.now() - this.reported > 1000 && !this.audio.paused) {
      this.reported = this.now();
      void this.send({ type: 'progress', roomId: this.room.id, sourceEpoch: this.epoch, positionMs: this.audio.currentTime * 1000, sampledAtServerMs: now }).catch(() => {});
    }
  }
}
