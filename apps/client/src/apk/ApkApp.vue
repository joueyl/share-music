<script setup lang="ts">
import { computed,provide,ref,toRef,watch,onUnmounted } from 'vue';
import { useRoute,useRouter } from 'vue-router';
import { Headphones,Search,UserRound,X,ChevronDown,Share2,LogOut } from 'lucide-vue-next';
import { useApp } from '../store';
import { ui,openSearch,resetUi } from '../ui';
import { useAutoDismissNotice } from '../useAutoDismissNotice';
import { createPlaybackCacheHost } from '../playback-cache-host';
import { createRoomRouteTransition } from '../room-route-transition';
import { copyRoomInvite } from '../features/useRoomSession';
import CachedMusicPage from '../components/CachedMusicPage.vue';
import QueueDrawer from '../components/QueueDrawer.vue';
import MusicSearchDialog from '../components/MusicSearchDialog.vue';
import RoomSettingsDialog from '../components/RoomSettingsDialog.vue';
import RoomMembersDialog from '../components/RoomMembersDialog.vue';
import UploadedMusicDialog from '../components/UploadedMusicDialog.vue';
import LoginPage from './pages/LoginPage.vue';
import ApkPlayer from './components/ApkPlayer.vue';
import ApkNavigation from './components/ApkNavigation.vue';
import { apkRoomLayoutKey, createApkRoomLayout } from './room-layout';
import { enablePlaybackDiagnostic } from './playback-diagnostic';
import { APP_VERSION } from '../version-info';
const app=useApp(),route=useRoute(),router=useRouter(),accountOpen=ref(false),queueMounted=ref(ui.queue);
const inRoom=computed(()=>route.path.startsWith('/room/'));
const roomControls=computed(()=>inRoom.value&&!!app.room&&app.room.id===route.params.id);
const roomStatus=computed(()=>!roomControls.value?'joining':!app.connected?'offline':app.room?.pending||app.pendingActions?'syncing':'online');
const roomStatusText={joining:'正在加入房间…',offline:'一起听 · 已断线，等待恢复',syncing:'一起听 · 正在同步',online:'一起听 · 已连接'};
const roomLayout=createApkRoomLayout();
provide(apkRoomLayoutKey,roomLayout);
const playbackKey=computed(()=>JSON.stringify([app.user?.id,app.room?.id??(inRoom.value?route.params.id:null)]));
const playbackHost=computed(()=>createPlaybackCacheHost(playbackKey.value));
const cachedNames=computed(()=>['CachedMusicPage',playbackHost.value.name!]);
const transition=ref('page'),layer=createRoomRouteTransition();
const stopRoute=router.beforeEach((to,from)=>{transition.value=to.path.startsWith('/room/')?'room-slide-up':from.path.startsWith('/room/')?'room-slide-down':'page';accountOpen.value=false;});
onUnmounted(()=>{stopRoute();layer.dispose();enablePlaybackDiagnostic(false);});
useAutoDismissNotice(toRef(app,'notice'));
watch(()=>app.user?.id,()=>{resetUi();accountOpen.value=false;queueMounted.value=false;roomLayout.threeD.value=false;});
watch(()=>app.room?.id,()=>{ui.queue=ui.settings=ui.members=ui.library=false;queueMounted.value=false;roomLayout.chat.value=roomLayout.lyrics.value=false;});
watch([()=>app.user?.id,()=>app.room?.id],()=>enablePlaybackDiagnostic(false));
watch(()=>ui.queue,open=>{if(open)queueMounted.value=true;});
function queueClosed(){queueMounted.value=false;ui.queue=false;}
async function exit(){if(app.busy)return;try{await app.exitRoom();await router.push('/');}catch(e){app.error(e);}}
async function logout(){await app.logout();if(!app.user)await router.replace('/');}
function searchRooms(term:string){ui.roomKeywords=term;void router.push('/');}
function shareRoom(){
 const room=app.room;
 if(!roomControls.value||!room)return;
 return copyRoomInvite(room.inviteCode,message=>{if(roomControls.value&&app.room?.id===room.id)app.notice=message;});
}
</script>
<template>
 <MusicSearchDialog v-if="ui.search&&app.user" :room-id="app.room?.id" apk-source-menu @close="ui.search=false" @rooms="searchRooms" />
 <QueueDrawer v-if="queueMounted&&app.room" :open="ui.queue" swipe-dismiss @close="queueClosed" />
 <RoomSettingsDialog v-if="ui.settings&&app.host" animate-dismiss @close="ui.settings=false" />
 <RoomMembersDialog v-if="ui.members&&app.room" animate-dismiss @close="ui.members=false" />
 <UploadedMusicDialog v-if="ui.library&&app.room" :room-id="app.room.id" @close="ui.library=false" />
 <div class="shell apk-shell" :class="{'apk-auth':!app.user}">
  <LoginPage v-if="!app.user" />
  <template v-else>
   <header v-if="inRoom" class="apk-header apk-room-header">
    <button class="icon-button" aria-label="收起房间，返回发现" @click="router.push('/')"><ChevronDown :size="24" /></button>
    <div class="apk-room-header-title"><strong :title="roomControls?app.room?.name:undefined">{{ roomControls?app.room?.name:'一起听' }}</strong><small role="status" :data-state="roomStatus">{{ roomStatusText[roomStatus] }}</small></div>
    <button class="icon-button" aria-label="复制房间码" :disabled="!roomControls||!app.room?.inviteCode" @click="shareRoom"><Share2 :size="22" /></button>
   </header>
   <header v-else class="apk-header"><Headphones :size="28" /><strong>同频 TONE</strong><button class="icon-button" aria-label="搜索音乐" @click="openSearch"><Search :size="22" /></button><button class="icon-button" aria-label="账户菜单" :aria-expanded="accountOpen" @click="accountOpen=!accountOpen"><UserRound :size="24" /></button>
    <div v-if="accountOpen" class="apk-card apk-account-menu" @keydown.esc="accountOpen=false"><strong>{{ app.user.name }}</strong><small>v{{ APP_VERSION }} · APK</small><button v-if="app.room" class="text-button" @click="accountOpen=false;ui.library=true">共享音乐库</button><button v-if="app.room" class="text-button" :disabled="app.busy" @click="accountOpen=false;exit()">退出房间</button><button class="text-button" :disabled="app.busy" @click="logout"><LogOut :size="18" />退出登录</button></div>
   </header>
   <main class="apk-workspace">
    <template v-if="!inRoom">
     <p v-if="!app.connected" class="apk-message" role="status">连接已断开 · 等待重新同步，房间操作暂不可用</p>
     <p v-if="app.pendingActions" class="apk-message" role="status">正在同步操作…</p>
    </template>
    <router-view v-slot="{Component,route:current}"><Transition :name="transition" mode="out-in" @enter="layer.start" @leave="layer.start" @after-enter="layer.finish" @enter-cancelled="layer.finish" @after-leave="layer.finish" @leave-cancelled="layer.finish"><KeepAlive :key="app.user.id" :include="cachedNames" :max="2"><component v-if="current.path.startsWith('/room/')" :is="playbackHost" :key="current.path" :view="Component" /><CachedMusicPage v-else-if="current.path==='/playlists'" key="apk-music" :view="Component" /><div v-else :key="current.path" class="route-page"><component :is="Component" /></div></KeepAlive></Transition></router-view>
   </main>
   <ApkNavigation />
  </template>
 </div>
 <!-- Same bridge/CloudPlayer as desktop, never a second Audio engine. -->
 <ApkPlayer v-if="app.user" :room-controls="roomControls" />
 <div v-if="app.notice&&app.user" class="apk-toast" :class="{'apk-room-toast':inRoom}" role="alert">{{ app.notice }}<button class="icon-button" aria-label="关闭提示" @click="app.notice=''"><X :size="18" /></button></div>
</template>
