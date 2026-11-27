<script setup lang="ts">
import { Pause, Play, SkipBack, SkipForward, Volume2, ListMusic, Repeat, Repeat1, Shuffle, Square, ChevronUp } from 'lucide-vue-next';
import SongFavoriteButton from './SongFavoriteButton.vue';
import { ui } from '../ui';
import { modalDepth } from '../useDialogFocus';
import * as bridge from '../bridge';
import AlbumArt from './AlbumArt.vue';
import { usePlayerControls } from '../features/usePlayerControls';
const { playbackMode,app,volume,seek,expanded,track,favoriteReference,blocked,maximum,progress,format,commit,control,togglePlayback } = usePlayerControls();
</script>
<template>
 <footer class="global-player" :class="{'mobile-expanded':expanded}" aria-label="全局同步播放器" @keydown.esc="expanded=false">
  <div class="global-player-inner">
   <router-link :to="app.room?`/room/${app.room.id}`:'/'" :inert="modalDepth>0" class="playing-summary"><AlbumArt :src="bridge.playingTrackCover(track)" /><span><strong>{{ track?.name??'还没有正在播放的音乐' }}</strong><small>{{ track?.artists??'选一个房间，开始一起听' }}<template v-if="track?.album"> · {{ track.album }}</template></small></span></router-link>
   <SongFavoriteButton :inert="modalDepth>0" class="favorite-control" :source="favoriteReference?.source" :song-id="favoriteReference?.id" :name="track?.name" />
   <div :inert="modalDepth>0" class="global-transport"><div class="transport-buttons"><button class="icon-button playback-mode-button" :disabled="playbackMode.disabled.value" :aria-label="`播放模式：${playbackMode.label.value}`" :title="`${playbackMode.label.value}，点击切换模式`" @click="playbackMode.cycle"><Shuffle v-if="playbackMode.mode.value==='shuffle'" :size="19" /><Repeat1 v-else-if="playbackMode.mode.value==='single'" :size="19" /><Repeat v-else-if="playbackMode.mode.value==='loop'" :size="19" /><ListMusic v-else :size="19" /></button><button class="icon-button" aria-label="上一首" :disabled="!app.room||!app.permission.skip||blocked" @click="control('previous')"><SkipBack :size="20" /></button><button class="global-play" :aria-label="app.room?.playback.playState==='playing'?'暂停':'继续'" :disabled="!track||!app.permission.skip||blocked" @click="togglePlayback()"><Pause v-if="app.room?.playback.playState==='playing'" :size="22" /><Play v-else :size="22" /></button><button class="icon-button" aria-label="下一首" :disabled="!app.room||!app.permission.skip||blocked" @click="control('next')"><SkipForward :size="20" /></button><button class="icon-button" aria-label="停止" :disabled="!app.room||!app.permission.skip||!app.connected||!!app.pendingActions" @click="control('stop')"><Square :size="16" /></button></div>
    <div class="global-progress"><span>{{ format(progress) }}</span><input type="range" min="0" :max="maximum" :value="progress" :style="{'--played':`${maximum?progress/maximum*100:0}%`}" step="1" aria-label="歌曲进度" :disabled="!track||!app.permission.seek||blocked" @input="seek=Number(($event.target as HTMLInputElement).value)" @change="commit" @pointercancel="seek=null" /><span>{{ format(track?.durationMs??0) }}</span></div>
   </div>
   <div class="global-player-tools"><Volume2 :size="20" /><input :inert="modalDepth>0" v-model.number="volume" type="range" min="0" max="1" step=".01" aria-label="本地音量" @input="bridge.setVolume(volume).catch(app.error)" /><button :inert="modalDepth>0&&(!ui.queue||modalDepth>1)" class="queue-trigger" :class="{active:ui.queue}" aria-label="打开共享播放列表" :disabled="!app.room" :aria-expanded="ui.queue" @click="ui.queue=!ui.queue"><ListMusic :size="23" /><span>{{ app.room?.playlist.length??0 }}</span></button><span class="source-badge">{{ track?.lossless?'无损':'原音' }}</span></div>
   <button :inert="modalDepth>0" type="button" class="mobile-player-expand" :aria-expanded="expanded" :aria-label="expanded?'收起播放控制':'展开播放控制'" @click="expanded=!expanded"><ChevronUp :size="20" /></button>
  </div>
 </footer>
</template>

<style scoped>
/* The player lives outside the inert shell, so it must round its own surface. */
.global-player{border-radius:0 0 var(--window-corner-radius,20px) var(--window-corner-radius,20px);transition:border-radius .18s ease}
.global-player.desktop-room-player{background-color:rgb(255 255 255 / 42%);border-top:0}
.global-player .favorite-control{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;min-width:44px;min-height:44px;flex-shrink:0}
@media(min-width:601px) and (max-width:900px){
 .global-player .playing-summary{width:clamp(125px,calc(100vw - 476px),190px)}
 .global-player .global-transport{width:280px}
 .global-player .transport-buttons{gap:12px}
}
@media(max-width:600px){
 .global-player .playing-summary{width:calc(100% - 206px)}
 .global-player .favorite-control{align-self:flex-start;margin-top:8px}
}
@media(prefers-reduced-motion:reduce){.global-player{transition:none}}
.mobile-player-expand{display:none}
@media(max-width:720px),(max-width:900px) and (pointer:coarse){
 .global-player{bottom:var(--mobile-tabbar);height:var(--mobile-player-height);padding:0;border-radius:0;background:#fffffff5;border-top:2px solid #e1e8f2;max-height:calc(100dvh - var(--mobile-tabbar));overflow:auto}
 .global-player .global-player-inner{display:grid;grid-template-columns:minmax(0,1fr) repeat(4,44px);grid-auto-rows:auto;align-items:center;gap:0;padding:6px 12px;min-height:70px}
 .global-player .playing-summary{grid-column:1;grid-row:1;width:auto;min-width:0;margin:0;gap:8px}
 .global-player .playing-summary .album-art{width:40px;height:40px;flex:0 0 40px;border-radius:10px}
 .global-player .playing-summary strong{font-size:13px;line-height:1.5}
 .global-player .playing-summary small{font-size:11px;line-height:1.5;margin-top:2px}
 .global-player .favorite-control{grid-column:2;grid-row:1;margin:0;align-self:center}
 .global-player .global-transport,.global-player .transport-buttons,.global-player .global-player-tools{display:contents}
 .global-player .transport-buttons>.icon-button,.global-player .global-progress,.global-player .global-player-tools>input,.global-player .global-player-tools>svg,.global-player .source-badge{display:none}
 .global-player .global-play{grid-column:3;grid-row:1;width:44px;height:44px;background:transparent;color:var(--accent);border-radius:12px}
 .global-player .global-play:disabled{color:#a5afbd}
 .global-player .queue-trigger{grid-column:4;grid-row:1;min-width:44px;min-height:44px;padding:0;flex-direction:row;justify-content:center;margin:0;color:#65748b}
 .global-player .queue-trigger.active{background:#e7effc;color:var(--accent)}
 .global-player .queue-trigger span{display:none}
 .mobile-player-expand{grid-column:5;grid-row:1;display:grid;place-items:center;width:44px;height:44px;background:transparent;color:#65748b;border-radius:12px;padding:0}
 .mobile-expanded .mobile-player-expand svg{transform:rotate(180deg)}
 .global-player.mobile-expanded .transport-buttons>.icon-button{display:flex;justify-content:center;width:44px;height:44px;min-width:44px;min-height:44px;grid-row:2;justify-self:center}
 .mobile-expanded .playback-mode-button{grid-column:1}
 .mobile-expanded [aria-label="上一首"]{grid-column:2}
 .mobile-expanded [aria-label="下一首"]{grid-column:4}
 .mobile-expanded [aria-label="停止"]{grid-column:5}
 .global-player.mobile-expanded .global-progress{position:static;display:flex;grid-column:1/-1;grid-row:3;margin:4px 0;gap:10px;font-size:11px;min-height:36px}
 .global-player .global-progress input::-webkit-slider-runnable-track{background:linear-gradient(to right,var(--accent) var(--played,0%),#d8dfe7 var(--played,0%))}
 .global-player .global-progress input::-webkit-slider-thumb{background:var(--accent)}
 .global-player .global-progress input::-moz-range-thumb{background:var(--accent)}
 .global-player .global-progress input::-moz-range-track{background:linear-gradient(to right,var(--accent) var(--played,0%),#d8dfe7 var(--played,0%))}
 .global-player.mobile-expanded .global-progress input{height:32px;min-height:32px;accent-color:var(--accent)}
 .global-player.mobile-expanded .global-player-tools>svg{display:block;grid-row:4;grid-column:1;justify-self:end;margin-right:12px}
 .global-player.mobile-expanded .global-player-tools>input{display:block;grid-row:4;grid-column:2/-1;width:100%;height:36px;min-height:36px;margin:0;accent-color:var(--accent)}
}
</style>
