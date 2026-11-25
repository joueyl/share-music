import { invoke } from '@tauri-apps/api/core';
import type { PlaybackDiagnostic } from '../cloud-player';

type NativeState = {
  roomId: string; sourceEpoch: number; sampledAtMs: number; positionMs: number;
  prepared: boolean; playing: boolean; seeking: boolean; buffering: boolean; errorCode: number;
};
type MediaStatus = { status: 'idle' | 'playing' | 'buffering' | 'error'; detail: string; bufferedMs: number; driftMs: number; receiveBps: number };

/** WebView observes the Android player; it no longer drives its lifecycle or timing. */
export class AndroidPlayback {
  private state?: NativeState;
  private pending = false;
  private revision = 0;
  private signature = '';
  private observer?: (event: PlaybackDiagnostic) => void;

  constructor(private report: (status: MediaStatus) => void) {}

  setDiagnostic(observer?: (event: PlaybackDiagnostic) => void) {
    this.observer = observer;
    void this.run('startup-logging', { enabled: !!observer }).catch(() => {});
  }

  setVolume(volume: number) {
    return this.run('volume', { volume }).catch(() => {});
  }

  reset() {
    ++this.revision;
    this.state = undefined;
    this.signature = '';
    // Room lifecycle is tied to the native socket. Never issue a late reset
    // from a suspended UI, which could clear a native session that has recovered.
  }

  position(roomId: string, epoch: number) {
    const s = this.state;
    if (s?.roomId === roomId && s.sourceEpoch === epoch && s.prepared && !s.seeking && !s.errorCode
        && Date.now() - s.sampledAtMs <= 500) return s.positionMs;
  }

  poll() {
    if (this.pending || document.visibilityState !== 'visible') return;
    this.pending = true;
    const revision = this.revision;
    void this.run('state').then(s => {
      if (revision !== this.revision) return;
      const prior = this.state;
      this.state = s;
      if (s.roomId && s.errorCode && prior?.errorCode !== s.errorCode) {
        this.observer?.({ kind: 'media-error', code: s.errorCode, positionMs: s.positionMs });
      }
      const status = !s.roomId ? 'idle' : s.errorCode ? 'error' :
        s.playing && !s.buffering ? 'playing' : 'buffering';
      if (this.signature === status) return;
      this.signature = status;
      this.report({ status, detail: status === 'error' ? 'Android ????????' : 'Android ???? ? ????',
        bufferedMs: 0, driftMs: 0, receiveBps: 0 });
    }).catch(() => {}).finally(() => { this.pending = false; });
  }

  private run(action: string, fields: Record<string, unknown> = {}) {
    return invoke<NativeState>('plugin:android-playback|operate', { operation: { action, ...fields } });
  }
}
