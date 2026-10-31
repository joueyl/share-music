<script setup lang="ts">
import { ref, toRef, watch, computed, onMounted } from 'vue';
import { useAutoDismissNotice } from './useAutoDismissNotice';
import { Headphones, Search, X, LogOut, History, Settings2, Minus, Square, ChevronDown, Link, Palette, Disc3 } from 'lucide-vue-next';
import { useRoute, useRouter } from 'vue-router';
import { useApp } from './store';
import { ui, openSearch, resetUi } from './ui';
import * as bridge from './bridge';
import AuthPage from './components/AuthPage.vue';
import SplashScreen from './components/SplashScreen.vue';
import GlobalPlayer from './components/GlobalPlayer.vue';
import QueueDrawer from './components/QueueDrawer.vue';
import MusicSearchDialog from './components/MusicSearchDialog.vue';
import UploadedMusicDialog from './components/UploadedMusicDialog.vue';
import RoomSettingsDialog from './components/RoomSettingsDialog.vue';
import RoomMembersDialog from './components/RoomMembersDialog.vue';
import VersionHistoryDialog from './components/VersionHistoryDialog.vue';
import ThemeCustomizerPopover from './components/ThemeCustomizerPopover.vue';
import { APP_VERSION } from './version-info';
import appLogo from './assets/logo.webp';

const versionOpen = ref(false), accountOpen = ref(false);
const splashDone = ref(false);
const isMaximized = ref(false);
const app = useApp(), router = useRouter(), route = useRoute();

const inRoom = computed(() => !!route.path.startsWith('/room/'));
const transitionName = ref('page');

router.beforeEach((to, from) => {
  if (to.path.startsWith('/room/')) {
    transitionName.value = 'room-slide-up';
  } else if (from.path.startsWith('/room/')) {
    transitionName.value = 'room-slide-down';
  } else {
    transitionName.value = 'page';
  }
});

useAutoDismissNotice(toRef(app, 'notice'));
watch(() => app.user?.id, () => { resetUi(); accountOpen.value = false; });
watch(() => app.room?.id, () => { ui.queue = ui.settings = ui.members = ui.library = false; });

watch(isMaximized, (val) => {
  if (val) {
    document.getElementById('app')?.classList.add('is-maximized');
  } else {
    document.getElementById('app')?.classList.remove('is-maximized');
  }
}, { immediate: true });

onMounted(async () => {
  if (bridge.desktop) {
    isMaximized.value = await bridge.isWindowMaximized();
    await bridge.onWindowResized(async () => {
      isMaximized.value = await bridge.isWindowMaximized();
    });
  }
});

async function toggleMaximize() {
  await bridge.windowToggleMaximize();
  if (bridge.desktop) {
    isMaximized.value = await bridge.isWindowMaximized();
  }
}

async function copyRoomInvite() {
  const code = app.room?.inviteCode;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    app.notice = '房间码已复制，请私下分享给朋友';
  } catch {
    app.notice = `房间码：${code}，请手动复制并私下分享`;
  }
}

async function exitCurrentRoom() {
  if (app.busy) return;
  try {
    await app.exitRoom();
    await router.push('/');
  } catch (e) {
    app.error(e);
  }
}

async function logout() {
  await app.logout();
  if (!app.user) await router.replace('/');
}

function searchRooms(term: string) {
  ui.roomKeywords = term;
  void router.push('/');
}

// 顶部栏窗口原生按住拖动 (禁止双击放大)
function onHeaderMouseDown(e: MouseEvent) {
  if (e.button !== 0) return;
  if (e.detail > 1) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const target = e.target as HTMLElement | null;
  if (target && target.closest('button, a, input, textarea, select, [role="button"], .window-controls, .account-container')) return;
  void bridge.startDragging();
}
</script>

<template>
  <SplashScreen v-if="!splashDone" @done="splashDone = true" />
  <VersionHistoryDialog v-if="versionOpen" @close="versionOpen = false" />
  <MusicSearchDialog v-if="ui.search && app.user" :room-id="app.room?.id" @close="ui.search = false" @rooms="searchRooms" />
  <UploadedMusicDialog v-if="ui.library && app.room" :room-id="app.room.id" @close="ui.library = false" />
  <QueueDrawer v-if="ui.queue && app.room" @close="ui.queue = false" />
  <RoomSettingsDialog v-if="ui.settings && app.host" @close="ui.settings = false" />
  <RoomMembersDialog v-if="ui.members && app.room" @close="ui.members = false" />

  <div class="shell" :class="{ 'auth-shell': !app.user, 'in-room-shell': inRoom, 'is-maximized': isMaximized }">
    <!-- 1. 发现/大厅 主导航栏 (浏览模式) -->
    <header
      v-if="app.user && !inRoom"
      class="sidebar tone-navigation browse-nav"
      aria-label="主导航"
      @mousedown="onHeaderMouseDown"
      @dblclick.stop.prevent=""
    >
      <router-link to="/" class="brand">
        <img class="brand-logo-img" :src="appLogo" alt="同频" />
        <span>同频<small>T O N E</small></span>
      </router-link>
      <nav class="tone-nav-links">
        <router-link to="/" class="nav-item">发现房间</router-link>
        <router-link :to="app.room ? `/room/${app.room.id}` : '/'" class="nav-item" :class="{ 'tone-inactive': !app.room }" @click="!app.room && (app.notice = '请先选择或创建一个房间')">一起听</router-link>
        <router-link to="/playlists" class="nav-item">我的音乐</router-link>
      </nav>
      <div class="tone-account">
        <button class="header-search" @click="openSearch">
          <Search :size="17" />
          <span>搜索歌曲、房间</span>
        </button>
        <button class="icon-button header-headphones" aria-label="返回正在收听" @click="app.room ? router.push(`/room/${app.room.id}`) : (app.notice = '请先加入房间')">
          <Headphones :size="20" />
        </button>
        <div class="account-container" @keydown.esc="accountOpen = false">
          <button class="portrait account-avatar" :aria-label="`${app.user.name}，账户菜单`" :aria-expanded="accountOpen" @click="accountOpen = !accountOpen">
            <span>{{ app.user.name.slice(0, 1) }}</span>
          </button>
          <div v-if="accountOpen" class="account-menu">
            <strong>{{ app.user.name }}</strong>
            <span class="account-status">
              <i class="dot" :class="{ online: app.connected }" />
              {{ app.connected ? '已连接' : '连接已断开' }}
            </span>
            <button @click="accountOpen = false; versionOpen = true">
              <History :size="16" />版本与更新 v{{ APP_VERSION }}
            </button>
            <button v-if="app.host" @click="accountOpen = false; ui.settings = true">
              <Settings2 :size="16" />房间设置
            </button>
            <button class="logout-button" :disabled="app.busy" aria-label="退出登录" @click="accountOpen = false; logout()">
              <LogOut :size="16" />退出登录
            </button>
          </div>
        </div>

        <!-- 原生 Windows 窗口控制按钮组 -->
        <div v-if="bridge.desktop" class="window-controls">
          <button class="win-btn win-min" title="最小化" @click.stop="bridge.windowMinimize">
            <Minus :size="13" />
          </button>
          <button class="win-btn win-max" title="最大化 / 还原" @click.stop="toggleMaximize">
            <Square :size="12" />
          </button>
          <button class="win-btn win-close" title="关闭 (最小化至托盘)" @click.stop="bridge.windowClose">
            <X :size="14" />
          </button>
        </div>
      </div>
    </header>

    <!-- 2. 一起听作战室 极简沉浸控制条 (全屏听歌模式 - 网易云极简风格) -->
    <header
      v-else-if="app.user && inRoom"
      class="tone-room-nav"
      aria-label="房间控制栏"
      @mousedown="onHeaderMouseDown"
      @dblclick.stop.prevent=""
    >
      <div class="room-nav-left">
        <button
          type="button"
          class="room-collapse-minimal"
          title="收起并返回发现大厅（音乐在后台继续播放）"
          @click.stop="router.push('/')"
        >
          <ChevronDown :size="24" />
        </button>
      </div>

      <div class="room-nav-right">
        <div class="room-mode-anchor">
          <button
            type="button"
            class="room-mode-btn"
            :class="{ active: ui.theme }"
            title="切换播放器模式与外观"
            @click.stop="ui.theme = !ui.theme"
          >
            <Disc3 :size="16" />
            <span>播放器模式</span>
          </button>
          <ThemeCustomizerPopover
            v-if="ui.theme"
            @close="ui.theme = false"
          />
        </div>
        <button
          v-if="app.host"
          type="button"
          class="room-icon-btn"
          title="房间设置"
          @click.stop="ui.settings = true"
        >
          <Settings2 :size="16" />
        </button>
        <button
          type="button"
          class="room-icon-btn room-exit-icon-btn"
          title="退出房间"
          :disabled="app.busy"
          @click.stop="exitCurrentRoom"
        >
          <LogOut :size="16" />
        </button>

        <!-- 原生 Windows 窗口控制按钮组 -->
        <div v-if="bridge.desktop" class="window-controls">
          <button class="win-btn win-min" title="最小化" @click.stop="bridge.windowMinimize">
            <Minus :size="13" />
          </button>
          <button class="win-btn win-max" title="最大化 / 还原" @click.stop="toggleMaximize">
            <Square :size="12" />
          </button>
          <button class="win-btn win-close" title="关闭 (最小化至托盘)" @click.stop="bridge.windowClose">
            <X :size="14" />
          </button>
        </div>
      </div>
    </header>

    <main class="main">
      <Transition name="toast">
        <div v-if="app.notice" :key="app.notice" class="toast" role="alert">
          {{ app.notice }}
          <button class="icon-button" aria-label="关闭提示" @click="app.notice = ''"><X :size="16" /></button>
        </div>
      </Transition>
      <Transition name="fade">
        <div v-if="app.pendingActions" class="operation-progress" role="status">
          <span class="loading-state">正在同步操作…</span>
        </div>
      </Transition>
      <AuthPage v-if="!app.user" @version="versionOpen = true" />
      <router-view v-else v-slot="{ Component, route }">
        <Transition :name="transitionName" mode="out-in" appear>
          <div :key="route.path" class="route-page" :class="{ 'in-room-page': inRoom }">
            <component :is="Component" />
          </div>
        </Transition>
      </router-view>
    </main>
    <GlobalPlayer v-if="app.user" />
  </div>
</template>

<style scoped>
.shell {
  position: relative;
  width: 100%;
  height: 100vh;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transform: translateZ(0);
  border-radius: 20px;
  background: linear-gradient(125deg, #ddeeff, #f2f1ed 60%, #fff2df);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08), 0 16px 48px rgba(0, 0, 0, 0.16);
  transition: border-radius 0.18s ease;
}

.shell.is-maximized {
  border-radius: 0;
  box-shadow: none;
}

.shell .tone-navigation,
.shell :deep(.tone-navigation) {
  border-top-left-radius: 20px;
  border-top-right-radius: 20px;
  top: 0;
}

.shell.is-maximized .tone-navigation,
.shell.is-maximized :deep(.tone-navigation) {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}

/* 专属极简作战室导航栏样式（网易云极简空灵风格） */
.shell.in-room-shell {
  background: radial-gradient(circle at 18% 18%, rgba(220, 235, 255, 0.9) 0%, transparent 55%),
              radial-gradient(circle at 82% 82%, rgba(255, 236, 215, 0.85) 0%, transparent 55%),
              linear-gradient(135deg, #e4ecf8 0%, #f1efe9 50%, #faeee3 100%);
}

.tone-room-nav {
  position: fixed;
  inset: 0 0 auto;
  height: 52px;
  width: 100%;
  padding: 0 20px 0 24px;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  background: transparent;
  z-index: 35;
  user-select: none;
  box-sizing: border-box;
  border-bottom: none;
}

.room-nav-left {
  display: flex;
  align-items: center;
}

.room-collapse-minimal {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  background: transparent;
  color: #4a5568;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-app-region: no-drag;
  padding: 0;
}

.room-collapse-minimal:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #1a202c;
  transform: translateY(1px);
}

.room-nav-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.room-mode-anchor {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.room-mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: #55657d;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-app-region: no-drag;
}

.room-mode-btn:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #16a34a;
}

.room-mode-btn.active {
  background: #f0fdf4;
  color: #16a34a;
  font-weight: 600;
}

.room-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  border-radius: 8px;
  color: #64748b;
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-app-region: no-drag;
  padding: 0;
}

.room-icon-btn:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.05);
  color: #1e293b;
}

.room-icon-btn.room-exit-icon-btn:hover:not(:disabled) {
  color: #e81123;
  background: rgba(232, 17, 35, 0.08);
}

.shell .main {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.shell.in-room-shell .main {
  padding-top: 52px;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

@media (max-width: 900px), (max-height: 639px) {
  .shell.in-room-shell .main { padding-bottom: calc(132px + env(safe-area-inset-bottom, 0px)); }
  .shell.in-room-shell .in-room-page { height: auto; min-height: 100%; }
}

@media (max-width: 600px) {
  .tone-room-nav { padding-inline: 12px; }
  .room-nav-right { gap: 4px; }
  .room-mode-btn { padding-inline: 6px; }
  .window-controls { margin-left: 0; padding-left: 2px; }
}

.shell :deep(.discovery-page) {
  overflow-y: hidden !important;
}

.brand-logo-img {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  object-fit: contain;
  display: block;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.window-controls {
  display: flex;
  align-items: center;
  margin-left: 10px;
  height: 32px;
  border-left: 1px solid rgba(0, 0, 0, 0.08);
  padding-left: 6px;
  -webkit-app-region: no-drag;
}

.win-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: #48484a;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  padding: 0;
  -webkit-app-region: no-drag;
}

.win-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #111;
}

.win-btn.win-close:hover {
  background: #e81123;
  color: #ffffff;
}
</style>
