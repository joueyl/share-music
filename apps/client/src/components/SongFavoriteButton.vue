<script setup lang="ts">
import { watch } from 'vue';
import { Heart,LoaderCircle } from 'lucide-vue-next';
import type { FavoriteSong } from '@music-share/shared';
import { useSongFavorites } from '../song-favorites';
import { useApp } from '../store';
const props=defineProps<{source?:FavoriteSong['source'];songId?:string;name?:string}>(),favorites=useSongFavorites(),app=useApp();
watch(()=>[props.source,props.songId,app.user?.id],()=>{if(props.source&&props.songId&&app.user)void favorites.read();},{immediate:true});
async function toggle(){
 if(!props.source||!props.songId||favorites.pending||favorites.loading||!app.user)return;
 try{await favorites.set(props.source,props.songId,!favorites.has(props.source,props.songId));}catch(e){app.error(e);}
}
</script>
<template><button type="button" class="icon-button song-favorite" :disabled="!source||!songId||!app.user||!!favorites.pending||favorites.loading" :aria-label="source&&songId?`${favorites.has(source,songId)?'取消收藏':'收藏'} ${name||'歌曲'}`:'此歌曲暂无可收藏的音源 ID'" :aria-pressed="!!source&&!!songId&&favorites.has(source,songId)" :title="favorites.error||(!source||!songId?'此歌曲暂无可收藏的音源 ID':'收藏到当前同频账号')" @click.stop.prevent="toggle"><LoaderCircle v-if="favorites.pending===source+':'+songId" :size="17" class="spinning" /><Heart v-else :size="18" :fill="source&&songId&&favorites.has(source,songId)?'currentColor':'none'" /></button></template>
<style scoped>.song-favorite{width:36px;height:36px;flex-shrink:0;background:transparent}.song-favorite[aria-pressed=true]{color:var(--accent)}@media(pointer:coarse){.song-favorite{width:44px;height:44px}}</style>
