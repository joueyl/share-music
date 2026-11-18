<script setup lang="ts">
import { Compass, Headphones, Music2 } from 'lucide-vue-next';
import { useRoute, useRouter } from 'vue-router';
import { useApp } from '../store';

const app = useApp(), route = useRoute(), router = useRouter();
function listen() {
  if (app.room) void router.push(`/room/${app.room.id}`);
  else app.notice = '请先选择或创建一个房间';
}
</script>

<template>
  <!-- Inside the existing shell: shared dialogs also lock this navigation. -->
  <nav class="mobile-navigation" aria-label="移动端主导航">
    <router-link to="/" :class="{ selected: route.path === '/' }" :aria-current="route.path === '/' ? 'page' : undefined"><Compass :size="24" /><span>发现</span></router-link>
    <button type="button" :class="{ selected: route.path.startsWith('/room/') }" :aria-current="route.path.startsWith('/room/') ? 'page' : undefined" @click="listen"><Headphones :size="24" /><span>一起听</span></button>
    <router-link to="/playlists" :class="{ selected: route.path === '/playlists' }" :aria-current="route.path === '/playlists' ? 'page' : undefined"><Music2 :size="24" /><span>我的音乐</span></router-link>
  </nav>
</template>

<style scoped>
.mobile-navigation{display:none}
@media(max-width:720px),(max-width:900px) and (pointer:coarse){
 .mobile-navigation{position:fixed;inset:auto 0 0;right:var(--modal-scrollbar-gap,0px);height:var(--mobile-tabbar);display:flex;align-items:flex-start;padding:6px max(16px,env(safe-area-inset-right,0px)) env(safe-area-inset-bottom,0px) max(16px,env(safe-area-inset-left,0px));background:#fff;z-index:34;border-radius:0 0 var(--window-corner-radius,20px) var(--window-corner-radius,20px)}
 .mobile-navigation>a,.mobile-navigation>button{flex:1;min-width:0;min-height:56px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:4px;background:transparent;border:0;border-radius:16px;text-decoration:none;color:#8795ab;font-size:12px;line-height:1.5}
 .mobile-navigation svg{box-sizing:content-box;padding:4px 16px;border-radius:24px}
 .mobile-navigation .selected{color:var(--accent);font-weight:600}
 .mobile-navigation .selected svg{background:#e7effc}
 .mobile-navigation :focus-visible{outline:2px solid var(--accent);outline-offset:-3px}
}
</style>
