<script setup lang="ts">
import { Pause, Play, ListMusic, SlidersHorizontal, SkipBack, SkipForward, Square, Shuffle, Repeat, Repeat1 } from 'lucide-vue-next';
import { usePlayerControls } from '../../features/usePlayerControls';
import { modalDepth } from '../../useDialogFocus';
import { ui } from '../../ui';
import * as bridge from '../../bridge';
import AlbumArt from '../../components/AlbumArt.vue';
import SongFavoriteButton from '../../components/SongFavoriteButton.vue';
const {playbackMode,app,volume,seek,expanded,track,favoriteReference,blocked,maximum,progress,format,commit,control,togglePlayback}=usePlayerControls();
</script>
<template>
 <footer class="global-player apk-player" :class="{'apk-player-expanded':expanded}" aria-label="APK 同步播放器" @keydown.esc="expanded=false">
  <div class="apk-mini-player"><router-link class="apk-playing-summary" :inert="modalDepth>0" :to="app.room?`/room/${app.room.id}`:'/'"><AlbumArt :src="bridge.playingTrackCover(track)" /><span><strong>{{ track?.name??'还没有正在播放的音乐' }}</strong><small>{{ track?.artists??'选一个房间，开始一起听' }}</small></span></router-link><SongFavoriteButton :inert="modalDepth>0" :source="favoriteReference?.source" :song-id="favoriteReference?.id" :name="track?.name" /><button class="icon-button apk-play" :inert="modalDepth>0" :disabled="!track||!app.permission.skip||blocked" :aria-label="app.room?.playback.playState==='playing'?'暂停':'继续'" @click="togglePlayback()"><Pause v-if="app.room?.playback.playState==='playing'" :size="24" /><Play v-else :size="24" /></button><button class="icon-button queue-trigger" :inert="modalDepth>0&&(!ui.queue||modalDepth>1)" aria-label="打开共享播放列表" :aria-expanded="ui.queue" :disabled="!app.room" @click="ui.queue=!ui.queue"><ListMusic :size="24" /></button><button class="icon-button" :inert="modalDepth>0" aria-label="展开播放控制" :aria-expanded="expanded" @click="expanded=!expanded"><SlidersHorizontal :size="20" /></button></div>
  <div v-if="expanded" class="apk-expanded-controls" :inert="modalDepth>0">
   <div class="apk-transport"><button class="icon-button" :disabled="playbackMode.disabled.value" :aria-label="`播放模式：${playbackMode.label.value}`" @click="playbackMode.cycle"><Shuffle v-if="playbackMode.mode.value==='shuffle'" :size="22" /><Repeat1 v-else-if="playbackMode.mode.value==='single'" :size="22" /><Repeat v-else-if="playbackMode.mode.value==='loop'" :size="22" /><ListMusic v-else :size="22" /></button><button class="icon-button" aria-label="上一首" :disabled="!app.room||!app.permission.skip||blocked" @click="control('previous')"><SkipBack :size="22" /></button><button class="icon-button" aria-label="下一首" :disabled="!app.room||!app.permission.skip||blocked" @click="control('next')"><SkipForward :size="22" /></button><button class="icon-button" aria-label="停止" :disabled="!app.room||!app.permission.skip||!app.connected||!!app.pendingActions" @click="control('stop')"><Square :size="18" /></button></div>
   <label class="apk-progress"><span>{{ format(progress) }}</span><input type="range" aria-label="歌曲进度" min="0" :max="maximum" :value="progress" :disabled="!track||!app.permission.seek||blocked" @input="seek=Number(($event.target as HTMLInputElement).value)" @change="commit" @pointercancel="seek=null" /><span>{{ format(track?.durationMs??0) }}</span></label><label class="apk-progress"><span>本地音量</span><input v-model.number="volume" type="range" min="0" max="1" step=".01" aria-label="本地音量" @input="bridge.setVolume(volume).catch(app.error)" /></label>
  </div>
 </footer>
</template>
