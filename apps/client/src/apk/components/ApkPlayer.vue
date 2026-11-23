<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from 'vue';
import { Pause, Play, ListMusic, SlidersHorizontal, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, AlignLeft, Users, MessageCircle } from 'lucide-vue-next';
import { usePlayerControls } from '../../features/usePlayerControls';
import { modalDepth } from '../../useDialogFocus';
import { openSearch, ui } from '../../ui';
import { stageTheme } from '../../stage-theme';
import * as bridge from '../../bridge';
import AlbumArt from '../../components/AlbumArt.vue';
import SongFavoriteButton from '../../components/SongFavoriteButton.vue';
import ApkRoomPreferences from './ApkRoomPreferences.vue';
import { apkRoomLayoutKey } from '../room-layout';
const props=defineProps<{roomControls?:boolean}>();
const layout=inject(apkRoomLayoutKey,null);
const preferences=ref(false);
const {playbackMode,app,volume,seek,track,favoriteReference,blocked,maximum,progress,format,commit,control,togglePlayback}=usePlayerControls();
const playing=computed(()=>app.room?.playback.playState==='playing');
const lyricsOn=computed(()=>!!layout?.lyrics.value||stageTheme.mode==='lumiere');
const canStop=computed(()=>!!app.room&&app.connected&&app.permission.skip&&!app.pendingActions);
const controlStatus=computed(()=>!app.connected?'已断线':blocked.value?'正在同步':app.permission.seek&&app.permission.skip?'同步播放':'部分控制受限');
watch([()=>props.roomControls,()=>app.room?.id],()=>{preferences.value=false;seek.value=null;});
function toggleLyrics(){
 if(!layout)return;
 if(stageTheme.mode==='lumiere'){stageTheme.mode='turntable';layout.lyrics.value=false;}
 else layout.lyrics.value=!layout.lyrics.value;
}
function toggleChat(){if(layout)layout.chat.value=!layout.chat.value;}
function setVolume(value:number){volume.value=value;void bridge.setVolume(value).catch(app.error);}
async function openRoomDialog(which:'settings'|'library'|'search'){
 const roomId=app.room?.id;
 preferences.value=false;
 await nextTick();
 if(!props.roomControls||!roomId||roomId!==app.room?.id)return;
 if(which==='search')openSearch();
 else if(which==='library'||app.host)ui[which]=true;
}
</script>
<template>
 <ApkRoomPreferences v-if="preferences&&roomControls" :volume="volume" :can-edit="app.host" :can-stop="canStop" @close="preferences=false" @edit="openRoomDialog('settings')" @library="openRoomDialog('library')" @search="openRoomDialog('search')" @stop="control('stop')" @volume-input="setVolume" />
 <footer class="global-player apk-player" :class="{'apk-room-player':roomControls}" aria-label="APK 同步播放器">
  <div v-if="roomControls" class="apk-room-controls">
   <div class="apk-room-song" :inert="modalDepth>0">
    <div class="apk-room-track">
     <h1 :title="track?.name">{{ track?.name??'等待第一首音乐' }}</h1>
     <p :title="track?.album">{{ track?.artists??'添加一首歌，开始一起听' }}<template v-if="track?.album"> · {{ track.album }}</template></p>
    </div>
    <SongFavoriteButton :source="favoriteReference?.source" :song-id="favoriteReference?.id" :name="track?.name" />
    <button class="icon-button apk-room-chat-trigger" :aria-label="layout?.chat.value?'收起聊天':'打开聊天'" :aria-expanded="layout?.chat.value??false" @click="toggleChat"><MessageCircle :size="22" /></button>
   </div>
   <div class="apk-room-timeline" :inert="modalDepth>0">
    <input type="range" aria-label="歌曲进度" min="0" :max="maximum" :value="progress" :style="{'--apk-seek-fill':`${maximum?100*progress/maximum:0}%`}" :disabled="!track||!app.permission.seek||blocked" @input="seek=Number(($event.target as HTMLInputElement).value)" @change="commit" @pointercancel="seek=null" />
    <div class="apk-room-time"><span>{{ format(progress) }}</span><span>{{ controlStatus }}</span><span>{{ format(track?.durationMs??0) }}</span></div>
   </div>
   <div class="apk-room-transport">
    <button class="icon-button" :inert="modalDepth>0" :disabled="playbackMode.disabled.value" :aria-label="`播放模式：${playbackMode.label.value}`" @click="playbackMode.cycle"><Shuffle v-if="playbackMode.mode.value==='shuffle'" :size="22" /><Repeat1 v-else-if="playbackMode.mode.value==='single'" :size="22" /><Repeat v-else-if="playbackMode.mode.value==='loop'" :size="22" /><ListMusic v-else :size="22" /></button>
    <button class="icon-button" :inert="modalDepth>0" :disabled="!app.room||!app.permission.skip||blocked" aria-label="上一首" @click="control('previous')"><SkipBack :size="23" /></button>
    <button class="icon-button apk-room-play" :inert="modalDepth>0" :disabled="!track||!app.permission.skip||blocked" :aria-label="playing?'暂停':'继续'" @click="togglePlayback()"><Pause v-if="playing" :size="26" fill="currentColor" /><Play v-else :size="26" fill="currentColor" /></button>
    <button class="icon-button" :inert="modalDepth>0" :disabled="!app.room||!app.permission.skip||blocked" aria-label="下一首" @click="control('next')"><SkipForward :size="23" /></button>
    <button class="icon-button queue-trigger" :inert="modalDepth>0" aria-label="打开共享播放列表" :aria-expanded="ui.queue" :disabled="!app.room" @click="ui.queue=!ui.queue"><ListMusic :size="24" /></button>
   </div>
   <div class="apk-room-actions" :inert="modalDepth>0">
    <button class="text-button" :aria-pressed="lyricsOn" @click="toggleLyrics"><AlignLeft :size="18" />歌词</button>
    <button class="text-button" @click="ui.members=true"><Users :size="18" />成员</button>
    <button class="text-button" @click="preferences=true"><SlidersHorizontal :size="18" />设置</button>
   </div>
  </div>
  <div v-else class="apk-mini-player">
   <component :is="app.room?'router-link':'div'" class="apk-playing-summary" :inert="modalDepth>0" :to="app.room?`/room/${app.room.id}`:undefined" :aria-label="app.room&&!track?'返回一起听':undefined">
    <AlbumArt :src="bridge.playingTrackCover(track)" />
    <strong v-if="track" :title="track.name">{{ track.name }}</strong>
   </component>
   <button class="icon-button apk-play" :inert="modalDepth>0" :disabled="!track||!app.permission.skip||blocked" :aria-label="playing?'暂停':'播放'" @click="togglePlayback()"><Pause v-if="playing" :size="24" /><Play v-else :size="24" /></button>
   <button class="icon-button queue-trigger" :inert="modalDepth>0" aria-label="打开共享播放列表" :aria-expanded="ui.queue" :disabled="!app.room" @click="ui.queue=!ui.queue"><ListMusic :size="24" /></button>
  </div>
 </footer>
</template>
