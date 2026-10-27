<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { Radio, Music2, ArrowRight, X, ShieldCheck, LogOut, LoaderCircle, History } from 'lucide-vue-next';
import { useRouter } from 'vue-router';
import { useApp } from './store';
import { canRememberLogin, clearSavedLogin } from './saved-login';
import VersionHistoryDialog from './components/VersionHistoryDialog.vue';
import { APP_VERSION } from './version-info';
const versionOpen=ref(false);
const app = useApp(), router = useRouter();
const name = ref(''), password = ref(''), register = ref(false);
const remember = ref(false), rememberAvailable = ref(false), starting = ref(true);
watch(() => app.user, () => { password.value = ''; });
async function logout() { await app.logout(); if (!app.user) await router.replace('/'); }
onMounted(async () => {
  try {
    await app.initialize();
    rememberAvailable.value = await canRememberLogin();
    if (rememberAvailable.value) {
      const saved = await app.restoreLogin();
      if (saved) {
        name.value = saved.name; remember.value = true;
      }
    }
  } catch (e) { app.error(e); }
  finally { starting.value = false; }
});
async function changeRemember() {
  if (!remember.value) try { await clearSavedLogin(); } catch (e) { app.error(e); }
}
</script>
<template>
  <VersionHistoryDialog v-if="versionOpen" @close="versionOpen=false" />
  <div class="shell">
    <aside class="sidebar" aria-label="主导航">
      <router-link to="/" class="brand"><div class="brand-mark"><Radio :size="24" /></div><span>共鸣<small>MUSIC SHARE</small></span></router-link>
      <div class="nav-caption">你的音乐空间</div>
      <router-link to="/" class="nav-item"><Radio :size="18" />发现房间</router-link>
      <router-link v-if="app.user" to="/playlists" class="nav-item"><Music2 :size="18" />我的歌单</router-link>
      <router-link v-if="app.room" :to="`/room/${app.room.id}`" class="nav-item"><Music2 :size="18" />正在收听<span class="tiny-dot" /></router-link>
      <div class="sidebar-bottom"><div class="status-line"><span class="dot" :class="{ online: app.connected }" />{{ app.connected ? '控制服务已连接' : '控制服务未连接' }}</div><p>让不同地方的人<br>听见同一个瞬间。</p><div v-if="app.user" class="identity"><span class="avatar">{{ app.user.name.slice(0, 1) }}</span><span>{{ app.user.name }}<small>桌面音乐空间</small></span></div><button v-if="app.user" class="text-button logout-button" :disabled="app.busy" aria-label="退出登录" @click="logout"><LogOut :size="16" />退出登录</button></div>
      <button class="text-button version-button" :aria-label="`当前版本 v${APP_VERSION}，查看更新日志`" :title="`v${APP_VERSION} · 更新日志`" @click="versionOpen=true"><History :size="17" /><span>v{{ APP_VERSION }}<small>版本与更新日志</small></span></button>
    </aside>
    <main class="main">
      <Transition name="toast"><div v-if="app.notice" :key="app.notice" class="toast" role="alert">{{ app.notice }}<button class="icon-button" aria-label="关闭提示" @click="app.notice = ''"><X :size="16" /></button></div></Transition>
      <Transition name="fade"><div v-if="app.pendingActions" class="operation-progress" role="status"><span class="loading-state">正在同步操作…</span></div></Transition>
      <template v-if="!app.user">
        <div class="login-layout motion-enter"><div class="login-copy"><span class="eyebrow">LISTEN TOGETHER</span><h1>音乐在这里，<br><em>我们也在。</em></h1><p>把本地收藏带进房间，<br>和朋友一起听，不错过同一个节拍。</p><div class="quality-note"><ShieldCheck :size="18" /> 无损优先 · 同步播放 · 自主权限</div></div>
        <form class="login-card" @submit.prevent="!starting && app.login(name, password, register, remember)"><h2>{{ register ? '创建账号' : '进入你的音乐空间' }}</h2><p class="muted">登录账号，和朋友一起听歌</p><label>用户名<input v-model="name" :disabled="starting || app.busy" autocomplete="username" minlength="2" maxlength="40" required /></label><label>密码<input v-model="password" :disabled="starting || app.busy" type="password" :autocomplete="register ? 'new-password' : 'current-password'" minlength="10" maxlength="128" required placeholder="至少 10 个字符" /></label><label v-if="rememberAvailable" class="remember-login"><input v-model="remember" type="checkbox" :disabled="starting || app.busy" @change="changeRemember" /><span>记住密码并自动登录<small>仅在个人设备上启用，退出登录会清除已保存密码</small></span></label><button class="primary full" :aria-busy="starting || app.busy" :disabled="starting || app.busy"><LoaderCircle v-if="starting || app.busy" class="spinning" :size="18" />{{ starting || app.busy ? '连接中…' : register ? '创建并进入' : '登录' }}<ArrowRight v-if="!starting && !app.busy" :size="18" /></button><button type="button" class="text-button full" :disabled="starting || app.busy" @click="register = !register">{{ register ? '已有账号，去登录' : '首次使用？创建账号' }}</button><p v-if="!app.native" class="native-note">{{ app.nativeReason }}</p></form></div>
      </template>
      <router-view v-else v-slot="{ Component, route }"><Transition name="page" mode="out-in" appear><div :key="route.path" class="route-page"><component :is="Component" /></div></Transition></router-view>
    </main>
  </div>
</template>
