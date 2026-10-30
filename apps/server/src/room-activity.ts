import type { Action, RoomSnapshot } from '../../../packages/shared/src';

const time = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
};

/** Only accepted user commands become activity; progress/ready/ticks are not user actions. */
export function roomActivityText(action: Action, before: RoomSnapshot, after: RoomSnapshot): string | null {
  const title = (id: string | null) => `《${before.playlist.find(t => t.id === id)?.name ?? after.playlist.find(t => t.id === id)?.name ?? '未知歌曲'}》`;
  const current = title(before.playback.sourceId);
  switch (action.type) {
    case 'enqueue': return `将《${action.payload.name}》加入了播放列表`;
    case 'instant': return `将《${action.payload.name}》加入了播放列表并发起播放`;
    case 'play': return `点播了${title(action.payload.trackId)}`;
    case 'next': case 'previous': {
      const target = after.pending?.playback.sourceId;
      return `切换到${action.type === 'next' ? '下一首' : '上一首'}${target ? ` ${title(target)}` : '（暂无可播放歌曲）'}`;
    }
    case 'pause': return `暂停了${current}`;
    case 'resume': return `继续播放${current}`;
    case 'seek': return `将${current}的播放进度调整到 ${time(action.payload.positionMs)}`;
    case 'stop': return `停止了播放${before.playback.sourceId ? ` ${current}` : ''}`;
    case 'remove': return `将${title(action.payload.trackId)}移出了播放列表`;
    case 'clear': return '清空了播放列表';
    case 'reorder': return '调整了播放列表顺序';
    case 'quality': return `将音质切换为${{ lossless: '无损', source: '原音', opus: '节流模式' }[action.payload.qualityMode]}`;
    default: return null;
  }
}
