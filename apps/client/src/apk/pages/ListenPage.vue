<script setup lang="ts">
import { computed,inject,nextTick,ref,onMounted,onUnmounted } from 'vue';
import { X } from 'lucide-vue-next';
import { useRoomSession } from '../../features/useRoomSession';
import { useCachedActivity } from '../../useCachedActivity';
import { stageTheme } from '../../stage-theme';
import { ui } from '../../ui';
import TrackLyrics from '../../components/TrackLyrics.vue';
import TurntableStage from '../../components/TurntableStage.vue';
import IpodStage from '../../components/IpodStage.vue';
import RoomChat from '../../components/RoomChat.vue';
import ApkVinylArtwork from '../components/ApkVinylArtwork.vue';
import { apkRoomLayoutKey } from '../room-layout';
const {app,route,track,coverUrl,sortedOnline}=useRoomSession();
const pageRoomId=route.params.id;
const active=useCachedActivity(),wide=ref(false),landscape=ref(false);
const {chat:chatOpen,lyrics,threeD}=inject(apkRoomLayoutKey)!;
const paired=computed(()=>wide.value||landscape.value);
const vinylMode=computed(()=>stageTheme.mode==='turntable'&&!threeD.value);
const playing=computed(()=>app.room?.playback.playState==='playing');
const showArt=computed(()=>stageTheme.mode!=='lumiere'&&!lyrics.value);
const showLyrics=computed(()=>stageTheme.mode==='lumiere'||lyrics.value||paired.value);
const vinylToggle=ref<HTMLButtonElement|null>(null),lyricPanel=ref<HTMLElement|null>(null);
function closeChat(){
 chatOpen.value=false;
 if(active.value&&!wide.value&&!ui.members)document.querySelector<HTMLButtonElement>('.apk-room-chat-trigger')?.focus({preventScroll:true});
}
async function switchVinylLyrics(show:boolean){
 lyrics.value=show;
 await nextTick();
 (show?lyricPanel.value:vinylToggle.value)?.focus({preventScroll:true});
}
function returnFromLyrics(event:MouseEvent){
 if(!vinylMode.value||!lyrics.value||event.defaultPrevented)return;
 const target=event.target as Element|null;
 if(target?.closest('button,a,input,select,textarea,[contenteditable]'))return;
 const panel=event.currentTarget as HTMLElement;
 const selection=window.getSelection();
 if(selection&&!selection.isCollapsed&&(panel.contains(selection.anchorNode)||panel.contains(selection.focusNode)))return;
 void switchVinylLyrics(false);
}
let detach=()=>{};
onMounted(()=>{
 const wideMedia=matchMedia('(min-width:760px) and (min-height:600px)');
 const landscapeMedia=matchMedia('(orientation:landscape) and (min-width:600px) and (max-height:599px)');
 const sync=()=>{wide.value=wideMedia.matches;landscape.value=landscapeMedia.matches;};
 sync();wideMedia.addEventListener('change',sync);landscapeMedia.addEventListener('change',sync);
 detach=()=>{wideMedia.removeEventListener('change',sync);landscapeMedia.removeEventListener('change',sync);};
});
onUnmounted(()=>detach());
</script>
<template>
 <section v-if="app.room&&app.room.id===pageRoomId" class="apk-listen">
  <div class="apk-listen-main">
   <div class="apk-listen-stage" :class="{'is-paired':paired,'lyrics-only':!showArt}">
    <Transition :name="vinylMode?'apk-vinyl-reveal':'apk-stage-fade'">
    <div v-if="showArt" class="apk-room-artwork">
     <div v-if="stageTheme.mode==='ipod'||threeD" class="apk-model">
      <IpodStage v-if="stageTheme.mode==='ipod'" :track="track" :cover-url="coverUrl" />
      <TurntableStage v-else :track="track" :cover-url="coverUrl" />
     </div>
     <button v-else ref="vinylToggle" type="button" class="apk-vinyl" aria-label="显示歌词" @click="switchVinylLyrics(true)">
      <ApkVinylArtwork :cover="coverUrl" :playing="playing" :active="active" />
     </button>
    </div>
    </Transition>
    <Transition name="apk-stage-fade">
    <div v-show="showLyrics" ref="lyricPanel" class="apk-room-lyrics" tabindex="-1" :inert="!showLyrics" @click="returnFromLyrics">
     <TrackLyrics class="apk-lyrics" :visible="showLyrics" :variant="stageTheme.mode==='lumiere'?'lumiere':'default'" :class="{'is-playing':playing&&active&&showLyrics}" />
     <p v-if="!track" class="apk-hint" role="status">播放歌曲后，这里会显示同步歌词。</p>
    </div>
    </Transition>
   </div>
   <button class="apk-room-presence" aria-label="查看房间成员与权限" @click="ui.members=true"><span aria-hidden="true" :class="{online:app.connected}"></span>{{ sortedOnline.length }} 人正在同频</button>
  </div>
  <!-- A single RoomChat instance survives chat open/close; no duplicated drafts. -->
  <aside class="apk-chat-area" v-show="active">
   <Transition name="apk-chat-panel" :css="!wide">
    <RoomChat v-show="wide||chatOpen" :inert="!active||(!wide&&!chatOpen)" :active="active&&(wide||chatOpen)" keep-keyboard @keydown.esc="!wide&&!ui.members&&closeChat()">
     <template #actions><button v-if="!wide" class="icon-button" aria-label="收起聊天" @click="closeChat"><X :size="20" /></button></template>
    </RoomChat>
   </Transition>
  </aside>
 </section>
 <section v-else class="apk-card apk-state" role="status">正在加入房间…</section>
</template>
