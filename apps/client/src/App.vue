<script setup lang="ts">
import { ref, toRef, watch } from 'vue';
import { useAutoDismissNotice } from './useAutoDismissNotice';
import { Headphones, Search, X, LogOut, History, Settings2 } from 'lucide-vue-next';
import { useRouter } from 'vue-router';
import { useApp } from './store';
import { ui, openSearch, resetUi } from './ui';
import AuthPage from './components/AuthPage.vue';
import GlobalPlayer from './components/GlobalPlayer.vue';
import QueueDrawer from './components/QueueDrawer.vue';
import MusicSearchDialog from './components/MusicSearchDialog.vue';
import UploadedMusicDialog from './components/UploadedMusicDialog.vue';
import RoomSettingsDialog from './components/RoomSettingsDialog.vue';
import RoomMembersDialog from './components/RoomMembersDialog.vue';
import VersionHistoryDialog from './components/VersionHistoryDialog.vue';
import { APP_VERSION } from './version-info';
const versionOpen=ref(false), accountOpen=ref(false);
const app=useApp(),router=useRouter();
useAutoDismissNotice(toRef(app,'notice'));
watch(()=>app.user?.id,()=>{resetUi();accountOpen.value=false;});
watch(()=>app.room?.id,()=>{ui.queue=ui.settings=ui.members=ui.library=false;});
async function logout(){await app.logout();if(!app.user)await router.replace('/');}
function searchRooms(term:string){ui.roomKeywords=term;void router.push('/');}
</script>
<template>
 <VersionHistoryDialog v-if="versionOpen" @close="versionOpen=false" />
 <MusicSearchDialog v-if="ui.search&&app.user" :room-id="app.room?.id" @close="ui.search=false" @rooms="searchRooms" />
 <UploadedMusicDialog v-if="ui.library&&app.room" :room-id="app.room.id" @close="ui.library=false" />
 <QueueDrawer v-if="ui.queue&&app.room" @close="ui.queue=false" />
 <RoomSettingsDialog v-if="ui.settings&&app.host" @close="ui.settings=false" />
 <RoomMembersDialog v-if="ui.members&&app.room" @close="ui.members=false" />
 <div class="shell" :class="{'auth-shell':!app.user}">
  <header v-if="app.user" class="sidebar tone-navigation" aria-label="主导航">
   <router-link to="/" class="brand"><span class="brand-mark"><Headphones :size="20" /></span><span>同频<small>T O N E</small></span></router-link>
   <nav class="tone-nav-links"><router-link to="/" class="nav-item">发现房间</router-link><router-link :to="app.room?`/room/${app.room.id}`:'/'" class="nav-item" :class="{'tone-inactive':!app.room}" @click="!app.room&&(app.notice='请先选择或创建一个房间')">一起听</router-link><router-link to="/playlists" class="nav-item">我的音乐</router-link></nav>
   <div class="tone-account"><button class="header-search" @click="openSearch"><Search :size="17" /><span>搜索歌曲、房间</span></button><button class="icon-button header-headphones" aria-label="返回正在收听" @click="app.room?router.push(`/room/${app.room.id}`):(app.notice='请先加入房间')"><Headphones :size="20" /></button><div class="account-container" @keydown.esc="accountOpen=false"><button class="portrait account-avatar" :aria-label="`${app.user.name}，账户菜单`" :aria-expanded="accountOpen" @click="accountOpen=!accountOpen"><span>{{ app.user.name.slice(0,1) }}</span></button><div v-if="accountOpen" class="account-menu"><strong>{{ app.user.name }}</strong><span class="account-status"><i class="dot" :class="{online:app.connected}" />{{ app.connected?'已连接':'连接已断开' }}</span><button @click="accountOpen=false;versionOpen=true"><History :size="16" />版本与更新 v{{ APP_VERSION }}</button><button v-if="app.host" @click="accountOpen=false;ui.settings=true"><Settings2 :size="16" />房间设置</button><button class="logout-button" :disabled="app.busy" aria-label="退出登录" @click="accountOpen=false;logout()"><LogOut :size="16" />退出登录</button></div></div></div>
  </header>
  <main class="main">
   <Transition name="toast"><div v-if="app.notice" :key="app.notice" class="toast" role="alert">{{ app.notice }}<button class="icon-button" aria-label="关闭提示" @click="app.notice=''"><X :size="16" /></button></div></Transition>
   <Transition name="fade"><div v-if="app.pendingActions" class="operation-progress" role="status"><span class="loading-state">正在同步操作…</span></div></Transition>
   <AuthPage v-if="!app.user" @version="versionOpen=true" />
   <router-view v-else v-slot="{Component,route}"><Transition name="page" mode="out-in" appear><div :key="route.path" class="route-page"><component :is="Component" /></div></Transition></router-view>
  </main>
  <GlobalPlayer v-if="app.user" />
 </div>
</template>
