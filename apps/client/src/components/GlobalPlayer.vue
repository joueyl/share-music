<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Pause, Play, SkipBack, SkipForward, Volume2, ListMusic, Repeat, Repeat1, Shuffle, Square } from 'lucide-vue-next';
import { useApp } from '../store';
import SongFavoriteButton from './SongFavoriteButton.vue';
import { ui } from '../ui';
import { usePlaybackMode } from '../usePlaybackMode';
import { modalDepth } from '../useDialogFocus';
import * as bridge from '../bridge';
import AlbumArt from './AlbumArt.vue';
const playbackMode=usePlaybackMode();
const app=useApp(), volume=ref(1), seek=ref<number|null>(null);
const track=computed(()=>app.room?.playlist.find(t=>t.id===app.room?.playback.sourceId));
const favoriteReference=computed(()=>bridge.favoriteTrackReference(track.value));
const blocked=computed(()=>!app.connected||!!app.room?.pending);
const maximum=computed(()=>Math.max(0,(track.value?.durationMs??1)-1));
const progress=computed(()=>seek.value??Math.min(app.room?.pending?.playback.positionMs??app.progress,maximum.value));
const format=(ms:number)=>`${Math.floor(ms/60000).toString().padStart(2,'0')}:${Math.floor(ms/1000%60).toString().padStart(2,'0')}`;
watch(()=>app.room?.playback.sourceEpoch,()=>{seek.value=null;});
async function commit(event:Event){const positionMs=Math.min(maximum.value,Math.max(0,Math.round(seek.value??Number((event.target as HTMLInputElement).value))));if(!blocked.value&&track.value&&app.permission.seek)await app.act({type:'seek',payload:{positionMs}});seek.value=null;}
</script>
<template>
 <footer class="global-player" aria-label="全局同步播放器">
  <div class="global-player-inner">
   <router-link :to="app.room?`/room/${app.room.id}`:'/'" :inert="modalDepth>0" class="playing-summary"><AlbumArt :src="bridge.playingTrackCover(track)" /><span><strong>{{ track?.name??'还没有正在播放的音乐' }}</strong><small>{{ track?.artists??'选一个房间，开始一起听' }}<template v-if="track?.album"> · {{ track.album }}</template></small></span></router-link>
   <SongFavoriteButton :inert="modalDepth>0" class="favorite-control" :source="favoriteReference?.source" :song-id="favoriteReference?.id" :name="track?.name" />
   <div :inert="modalDepth>0" class="global-transport"><div class="transport-buttons"><button class="icon-button playback-mode-button" :disabled="playbackMode.disabled.value" :aria-label="`播放模式：${playbackMode.label.value}`" :title="`${playbackMode.label.value}，点击切换模式`" @click="playbackMode.cycle"><Shuffle v-if="playbackMode.mode.value==='shuffle'" :size="19" /><Repeat1 v-else-if="playbackMode.mode.value==='single'" :size="19" /><Repeat v-else-if="playbackMode.mode.value==='loop'" :size="19" /><ListMusic v-else :size="19" /></button><button class="icon-button" aria-label="上一首" :disabled="!app.room||!app.permission.skip||blocked" @click="app.act({type:'previous',payload:{}})"><SkipBack :size="20" /></button><button class="global-play" :aria-label="app.room?.playback.playState==='playing'?'暂停':'继续'" :disabled="!track||!app.permission.skip||blocked" @click="app.act({type:app.room?.playback.playState==='playing'?'pause':'resume',payload:{}})"><Pause v-if="app.room?.playback.playState==='playing'" :size="22" /><Play v-else :size="22" /></button><button class="icon-button" aria-label="下一首" :disabled="!app.room||!app.permission.skip||blocked" @click="app.act({type:'next',payload:{}})"><SkipForward :size="20" /></button><button class="icon-button" aria-label="停止" :disabled="!app.room||!app.permission.skip||!app.connected" @click="app.act({type:'stop',payload:{}})"><Square :size="16" /></button></div>
    <div class="global-progress"><span>{{ format(progress) }}</span><input type="range" min="0" :max="maximum" :value="progress" :style="{'--played':`${maximum?progress/maximum*100:0}%`}" step="1" aria-label="歌曲进度" :disabled="!track||!app.permission.seek||blocked" @input="seek=Number(($event.target as HTMLInputElement).value)" @change="commit" @pointercancel="seek=null" /><span>{{ format(track?.durationMs??0) }}</span></div>
   </div>
   <div class="global-player-tools"><Volume2 :size="20" /><input :inert="modalDepth>0" v-model.number="volume" type="range" min="0" max="1" step=".01" aria-label="本地音量" @input="bridge.setVolume(volume).catch(app.error)" /><button :inert="modalDepth>0&&(!ui.queue||modalDepth>1)" class="queue-trigger" :class="{active:ui.queue}" aria-label="打开共享播放列表" :disabled="!app.room" :aria-expanded="ui.queue" @click="ui.queue=!ui.queue"><ListMusic :size="23" /><span>{{ app.room?.playlist.length??0 }}</span></button><span class="source-badge">{{ track?.lossless?'无损':'原音' }}</span></div>
  </div>
 </footer>
</template>

<style scoped>
/* The player lives outside the inert shell, so it must round its own surface. */
.global-player{border-radius:0 0 var(--window-corner-radius,20px) var(--window-corner-radius,20px);transition:border-radius .18s ease}
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
</style>
