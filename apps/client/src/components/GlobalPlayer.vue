<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Pause, Play, SkipBack, SkipForward, Volume2, ListMusic, Check, Headphones, Repeat, Square, Heart } from 'lucide-vue-next';
import { useApp } from '../store';
import { ui } from '../ui';
import * as bridge from '../bridge';
import AlbumArt from './AlbumArt.vue';
const app=useApp(), volume=ref(1), seek=ref<number|null>(null);
const track=computed(()=>app.room?.playlist.find(t=>t.id===app.room?.playback.sourceId));
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
   <router-link :to="app.room?`/room/${app.room.id}`:'/'" class="playing-summary"><AlbumArt :src="bridge.playingTrackCover(track)" /><span><strong>{{ track?.name??'还没有正在播放的音乐' }}</strong><small>{{ track?.artists??'选一个房间，开始一起听' }}<template v-if="track?.album"> · {{ track.album }}</template></small></span></router-link>
   <button class="icon-button favorite-control" aria-label="收藏歌曲暂未开放" title="当前服务端暂不支持收藏" disabled><Heart :size="21" /></button>
   <span class="sync-badge" :class="{waiting:!app.connected||!!app.room?.pending}" role="status"><Check v-if="app.connected&&!app.room?.pending" :size="16" /><Headphones v-else :size="16" />{{ !app.room?'尚未加入房间':!app.connected?'连接已断开':app.room.pending?'正在准备同步':app.media.status==='playing'?'本机正在同步':'房间时间轴同步' }}</span>
   <div class="global-transport"><div class="transport-buttons"><button class="icon-button" disabled aria-label="循环播放暂未开放" title="当前按队列顺序播放"><Repeat :size="19" /></button><button class="icon-button" aria-label="上一首" :disabled="!app.room||!app.permission.skip||blocked" @click="app.act({type:'previous',payload:{}})"><SkipBack :size="20" /></button><button class="global-play" :aria-label="app.room?.playback.playState==='playing'?'暂停':'继续'" :disabled="!track||!app.permission.skip||blocked" @click="app.act({type:app.room?.playback.playState==='playing'?'pause':'resume',payload:{}})"><Pause v-if="app.room?.playback.playState==='playing'" :size="22" /><Play v-else :size="22" /></button><button class="icon-button" aria-label="下一首" :disabled="!app.room||!app.permission.skip||blocked" @click="app.act({type:'next',payload:{}})"><SkipForward :size="20" /></button><button class="icon-button" aria-label="停止" :disabled="!app.room||!app.permission.skip||!app.connected" @click="app.act({type:'stop',payload:{}})"><Square :size="16" /></button></div>
    <div class="global-progress"><span>{{ format(progress) }}</span><input type="range" min="0" :max="maximum" :value="progress" :style="{'--played':`${maximum?progress/maximum*100:0}%`}" step="1" aria-label="歌曲进度" :disabled="!track||!app.permission.seek||blocked" @input="seek=Number(($event.target as HTMLInputElement).value)" @change="commit" @pointercancel="seek=null" /><span>{{ format(track?.durationMs??0) }}</span></div>
   </div>
   <div class="global-player-tools"><Volume2 :size="20" /><input v-model.number="volume" type="range" min="0" max="1" step=".01" aria-label="本地音量" @input="bridge.setVolume(volume).catch(app.error)" /><button class="queue-trigger" :class="{active:ui.queue}" aria-label="打开共享播放列表" :disabled="!app.room" :aria-expanded="ui.queue" @click="ui.queue=true"><ListMusic :size="23" /><span>{{ app.room?.playlist.length??0 }}</span></button><span class="source-badge">{{ track?.lossless?'无损':'原音' }}</span></div>
  </div>
 </footer>
</template>
