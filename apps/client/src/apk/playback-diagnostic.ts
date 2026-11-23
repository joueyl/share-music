import { ref } from 'vue';
import { setApkPlaybackDiagnostic } from '../bridge';
import type { PlaybackDiagnostic } from '../cloud-player';

export const playbackDiagnosticEnabled = ref(false);
export const playbackDiagnosticEntries = ref<{ id: number; at: string; event: PlaybackDiagnostic }[]>([]);
let sequence = 0;

export function enablePlaybackDiagnostic(enabled: boolean) {
  playbackDiagnosticEnabled.value = enabled;
  playbackDiagnosticEntries.value = [];
  setApkPlaybackDiagnostic(enabled ? event => {
    const previous = playbackDiagnosticEntries.value[0]?.event;
    // A blocked play() can reject on consecutive ticks at the same position.
    if (event.kind === 'play-rejected' && previous?.kind === event.kind && previous.positionMs === event.positionMs) return;
    playbackDiagnosticEntries.value = [
      { id: ++sequence, at: new Date().toLocaleTimeString(), event },
      ...playbackDiagnosticEntries.value.slice(0, 7),
    ];
  } : undefined);
}

export function describePlaybackDiagnostic(event: PlaybackDiagnostic): string {
  const position = (event.positionMs / 1000).toFixed(1);
  switch (event.kind) {
    case 'correction': return `${position} 秒 · 同步跳转（偏差 ${event.driftMs} 毫秒）`;
    case 'waiting': return `${position} 秒 · 播放等待数据`;
    case 'playing': return `${position} 秒 · 恢复播放`;
    case 'reload': return `${position} 秒 · 播放停滞，重新加载`;
    case 'stalled': return `${position} 秒 · 重新加载后仍停滞`;
    case 'media-error': return `${position} 秒 · 播放器错误（代码 ${event.code}）`;
    case 'play-rejected': return `${position} 秒 · 播放器未能开始播放`;
  }
}
