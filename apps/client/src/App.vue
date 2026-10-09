<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { Radio, Music2, ArrowRight, X, ShieldCheck, LogOut } from 'lucide-vue-next';
import { useRouter } from 'vue-router';
import { useApp } from './store';
const app = useApp(), router = useRouter();
const server = ref('http://127.0.0.1:3000'), name = ref(''), password = ref(''), register = ref(false);
watch(() => app.user, () => { password.value = ''; });
async function logout() { await app.logout(); if (!app.user) await router.replace('/'); }
onMounted(() => app.initialize().catch(app.error));
</script>
<template>
  <div class="shell">
    <aside class="sidebar">
      <router-link to="/" class="brand"><div class="brand-mark"><Radio :size="24" /></div><span>共鸣<small>MUSIC SHARE</small></span></router-link>
      <div class="nav-caption">你的音乐空间</div>
      <router-link to="/" class="nav-item"><Radio :size="18" />发现房间</router-link>
      <router-link v-if="app.room" :to="`/room/${app.room.id}`" class="nav-item"><Music2 :size="18" />正在收听<span class="tiny-dot" /></router-link>
      <div class="sidebar-bottom"><div class="status-line"><span class="dot" :class="{ online: app.connected }" />{{ app.connected ? '控制服务已连接' : '控制服务未连接' }}</div><p>让不同地方的人<br>听见同一个瞬间。</p><div v-if="app.user" class="identity"><span class="avatar">{{ app.user.name.slice(0, 1) }}</span><span>{{ app.user.name }}<small>桌面音乐空间</small></span></div><button v-if="app.user" class="text-button logout-button" :disabled="app.busy" aria-label="退出登录" @click="logout"><LogOut :size="16" />退出登录</button></div>
    </aside>
    <main class="main">
      <div v-if="app.notice" class="toast" role="alert">{{ app.notice }}<button class="icon-button" aria-label="关闭提示" @click="app.notice = ''"><X :size="16" /></button></div>
      <template v-if="!app.user">
        <div class="login-layout"><div class="login-copy"><span class="eyebrow">LISTEN TOGETHER</span><h1>音乐在这里，<br><em>我们也在。</em></h1><p>把本地收藏带进房间，<br>和朋友一起听，不错过同一个节拍。</p><div class="quality-note"><ShieldCheck :size="18" /> 无损优先 · 同步播放 · 自主权限</div></div>
        <form class="login-card" @submit.prevent="app.login(server, name, password, register)"><h2>{{ register ? '创建账号' : '进入你的音乐空间' }}</h2><p class="muted">连接自己的共鸣服务器</p><label>服务器地址<input v-model="server" type="url" required placeholder="https://music.example.com" /></label><label>用户名<input v-model="name" autocomplete="username" minlength="2" maxlength="40" required /></label><label>密码<input v-model="password" type="password" :autocomplete="register ? 'new-password' : 'current-password'" minlength="10" maxlength="128" required placeholder="至少 10 个字符" /></label><button class="primary full" :disabled="app.busy">{{ app.busy ? '连接中…' : register ? '创建并进入' : '登录' }}<ArrowRight :size="18" /></button><button type="button" class="text-button full" @click="register = !register">{{ register ? '已有账号，去登录' : '首次使用？创建账号' }}</button><p v-if="!app.native" class="native-note">{{ app.nativeReason }}</p></form></div>
      </template>
      <router-view v-else />
    </main>
  </div>
</template>
