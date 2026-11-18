<script setup lang="ts">
import { ref,onMounted,onUnmounted } from 'vue';
import { Users, Plus, MessageCircle, X } from 'lucide-vue-next';
import { useRoomSession } from '../../features/useRoomSession';
import { useCachedActivity } from '../../useCachedActivity';
import { stageTheme } from '../../stage-theme';
import { ui, openSearch } from '../../ui';
import TrackLyrics from '../../components/TrackLyrics.vue';
import TurntableStage from '../../components/TurntableStage.vue';
import IpodStage from '../../components/IpodStage.vue';
import RoomChat from '../../components/RoomChat.vue';
import SimilarRecommendations from '../../components/SimilarRecommendations.vue';
const {app,track,coverUrl,sortedOnline}=useRoomSession();
const active=useCachedActivity(),chatOpen=ref(false),wide=ref(false);
let detach=()=>{};
onMounted(()=>{const media=matchMedia('(min-width:760px) and (min-height:600px)');const sync=()=>{wide.value=media.matches;};sync();media.addEventListener('change',sync);detach=()=>media.removeEventListener('change',sync);});
onUnmounted(()=>detach());
</script>
<template>
 <section v-if="app.room" class="apk-listen">
  <div class="apk-listen-main">
   <header class="apk-presence"><button class="secondary" aria-label="查看房间成员与权限" @click="ui.members=true"><Users :size="18" /><span>{{ sortedOnline.length }} 人正在同频</span></button><button type="button" class="icon-button apk-chat-toggle" aria-label="打开聊天" :aria-expanded="chatOpen" @click="chatOpen=!chatOpen"><MessageCircle :size="22" /></button><label class="apk-stage-choice"><span class="sr-only">播放器外观</span><select v-model="stageTheme.mode" aria-label="播放器外观"><option value="turntable">唱片</option><option value="ipod">iPod</option><option value="lumiere">歌词</option></select></label></header>
   <div class="apk-listen-stage" :class="{'lyrics-only':stageTheme.mode==='lumiere'}">
    <div v-if="stageTheme.mode!=='lumiere'" class="apk-model"><TurntableStage v-if="stageTheme.mode==='turntable'" :track="track" :cover-url="coverUrl" /><IpodStage v-else :track="track" :cover-url="coverUrl" /></div>
    <div class="apk-current-song"><h1 :title="track?.name">{{ track?.name??'等待第一首音乐' }}</h1><p>{{ track?.artists??'添加一首收藏，开始共享' }}<template v-if="track?.album"> · {{ track.album }}</template></p></div>
    <TrackLyrics class="apk-lyrics" :variant="stageTheme.mode==='lumiere'?'lumiere':'default'" />
   </div>
   <button class="primary full" :disabled="!app.connected||!app.permission.enqueue" @click="openSearch"><Plus :size="20" />搜索想一起听的歌</button>
   <SimilarRecommendations />
  </div>
  <!-- A single RoomChat instance survives chat open/close; no duplicated drafts. -->
  <aside class="apk-chat-area" :class="{'is-open':chatOpen}" v-show="active"><RoomChat v-show="wide||chatOpen" :active="active&&(wide||chatOpen)"><template #actions><button class="icon-button" aria-label="收起聊天" @click="chatOpen=false"><X :size="20" /></button></template></RoomChat></aside>
 </section>
 <section v-else class="apk-card apk-state" role="status">正在加入房间…</section>
</template>
