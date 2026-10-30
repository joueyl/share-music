<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Headphones, Users, Link, X, Settings2 } from 'lucide-vue-next';
import { useApp } from '../store';
import { ui, openSearch } from '../ui';
import * as bridge from '../bridge';
import RoomChat from '../components/RoomChat.vue';
import SimilarRecommendations from '../components/SimilarRecommendations.vue';
import RoomWaveform from '../components/RoomWaveform.vue';
import TrackLyrics from '../components/TrackLyrics.vue';
import AlbumArt from '../components/AlbumArt.vue';
import turntable from '../assets/room-turntable.png';
const app=useApp(),route=useRoute(),router=useRouter(),leaving=ref(false),resolvedCover=ref('');
const track=computed(()=>app.room?.playlist.find(t=>t.id===app.room?.playback.sourceId));
const coverUrl=computed(()=>bridge.playingTrackCover(track.value)||resolvedCover.value);
const online=computed(()=>app.room?.members.filter(m=>m.online)??[]);
watch(()=>[app.room?.id,track.value?.id,track.value?.contentHash],async(_,__,onCleanup)=>{let active=true;onCleanup(()=>{active=false;});resolvedCover.value='';const roomId=app.room?.id,song=track.value;if(roomId&&song&&!bridge.playingTrackCover(song)){const cover=await bridge.loadTrackCover(roomId,song);if(active)resolvedCover.value=cover;}},{immediate:true});
onMounted(async()=>{try{if(app.room?.id!==route.params.id)await bridge.join(String(route.params.id));}catch(e){app.error(e);}});
async function exit(){if(leaving.value)return;leaving.value=true;try{await app.exitRoom();await router.push('/');}finally{leaving.value=false;}}
async function invite(){const code=app.room?.inviteCode;if(!code)return;try{await navigator.clipboard.writeText(code);app.notice='房间码已复制，请私下分享给朋友';}catch{app.notice=`房间码：${code}，请手动复制并私下分享`;}}
</script>
<template>
 <section v-if="app.room" class="tone-room page">
  <header class="room-titlebar"><div><h1>{{ app.room.name }}</h1></div><div class="room-title-actions"><span class="visibility-pill">{{ app.room.settings?.visibility==='invite'?'邀请房间':'公开房间' }}</span><button class="primary" @click="invite"><Link :size="16" />邀请好友</button><button v-if="app.host" class="icon-button" aria-label="房间设置" @click="ui.settings=true"><Settings2 :size="19" /></button><button class="icon-button" aria-label="离开房间" :disabled="leaving" @click="exit"><X :size="22" /></button></div></header>
  <div class="listening-layout"><div class="listening-main">
   <section class="listening-stage" aria-label="一起听主舞台"><RoomWaveform :key="app.room.id" :source-id="app.room.playback.sourceId" :playing="!!track&&app.connected&&app.room.playback.playState==='playing'" />
    <div class="stage-presence"><button class="presence-pill" @click="ui.members=true"><Headphones :size="16" />{{ online.length }} 人正在同频</button><span>此刻同一首歌，就是我们的距离。</span><button class="stage-avatars" aria-label="查看房间成员与权限" @click="ui.members=true"><span v-for="member in online.slice(0,4)" :key="member.id" class="portrait">{{ member.name.slice(0,1) }}</span><small v-if="online.length>4">+{{ online.length-4 }}</small></button></div>
    <div class="stage-turntable"><img :src="turntable" alt="同频黑胶唱机" width="449" height="403" /><AlbumArt v-if="coverUrl" class="turntable-label" :src="coverUrl" :alt="`${track?.name??''}专辑封面`" /></div>
    <div class="stage-song"><div class="stage-song-title"><h2>{{ track?.name??'等待第一首音乐' }}</h2><span v-if="track" class="source-badge">{{ track.lossless?'HQ':'原音' }}</span></div><p>{{ track?.artists??'添加一首收藏，开始共享' }}<template v-if="track?.album"> / {{ track.album }}</template></p><TrackLyrics class="stage-lyrics" /><p v-if="!track" class="stage-empty-lyric">让音乐，替我们说声你好。<button class="text-button" :disabled="!app.connected||!app.permission.enqueue" @click="openSearch">搜索想一起听的歌</button></p></div>
    <button class="stage-controller" @click="ui.members=true"><Users :size="16" />{{ app.room.members.find(m=>m.id===app.room?.hostId)?.name??'房主' }}正在控制播放</button><span v-if="app.room.pending || app.media.status !== 'playing'" class="stage-audio-status" role="status">{{ app.room.pending?'正在准备同步…':app.media.detail||'等待音乐开始' }}</span>
   </section>
   <SimilarRecommendations :key="app.room.id" />
  </div><RoomChat :key="app.room.id" /></div>
 </section>
 <div v-else class="empty-state"><h3 class="loading-state" role="status">正在加入房间…</h3><button class="secondary" @click="router.push('/')">返回房间列表</button></div>
</template>
