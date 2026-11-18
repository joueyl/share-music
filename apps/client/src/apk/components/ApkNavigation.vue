<script setup lang="ts">
import { Compass, Headphones, Music2 } from 'lucide-vue-next';
import { useRoute,useRouter } from 'vue-router';
import { useApp } from '../../store';
const app=useApp(),route=useRoute(),router=useRouter();
function listen(){if(app.room)void router.push(`/room/${app.room.id}`);else app.notice='请先选择或创建一个房间';}
</script>
<template><nav class="apk-navigation" aria-label="APK 主导航"><router-link to="/" :aria-current="route.path==='/'?'page':undefined"><Compass :size="24" /><span>发现</span></router-link><button :aria-current="route.path.startsWith('/room/')?'page':undefined" @click="listen"><Headphones :size="24" /><span>一起听</span></button><router-link to="/playlists" :aria-current="route.path==='/playlists'?'page':undefined"><Music2 :size="24" /><span>我的音乐</span></router-link></nav></template>
