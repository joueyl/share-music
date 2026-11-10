<script setup lang="ts">
import { computed,onMounted,onUnmounted,ref,watch } from 'vue';
import { Heart,Plus,LoaderCircle } from 'lucide-vue-next';
import { useSongFavorites } from '../song-favorites';
import { useApp } from '../store';
import * as bridge from '../bridge';
import AlbumArt from './AlbumArt.vue';
import SongFavoriteButton from './SongFavoriteButton.vue';
const favorites=useSongFavorites(),app=useApp(),adding=ref(''),message=ref('');
let alive=true,generation=0;const requests=new Map<string,string>();
onMounted(()=>{void favorites.read();});onUnmounted(()=>{alive=false;generation++;});
watch(()=>app.user?.id,()=>{generation++;adding.value='';message.value='';requests.clear();void favorites.read();});
watch(()=>app.room?.id,()=>{generation++;adding.value='';message.value='';requests.clear();});
const reason=computed(()=>!app.room?'加入房间后可添加歌曲':!app.connected?'连接已断开':!app.permission.enqueue?'当前没有播放列表控制权限':app.room.pending||app.pendingActions||app.busy?'房间正在处理操作':''),canAdd=computed(()=>!reason.value&&!adding.value);
async function add(song:bridge.FavoriteSong){
 if(!canAdd.value||!app.room)return;if(app.room.playlist.length>=200){message.value='房间最多 200 首，请先整理播放队列';return;}
 const gen=generation,roomId=app.room.id,key=roomId+':'+song.source+':'+song.id,requestId=requests.get(key)??crypto.randomUUID();requests.set(key,requestId);adding.value=song.source+':'+song.id;message.value='';
 try{
  const [result]=await bridge.addSearchedMusicBatch(roomId,[{songId:song.id,requestId,coverUrl:song.coverUrl}],song.source);
  if(!alive||gen!==generation)return;
  if(!result.ok)throw new Error(result.error);requests.delete(key);message.value=`已加入：${song.name}`;
 }catch(e){if(alive&&gen===generation)message.value=e instanceof Error?e.message:String(e);}
 finally{if(alive&&gen===generation)adding.value='';}
}
const format=(ms:number)=>`${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
</script>
<template><section class="favorite-songs" aria-label="已收藏的单曲" :aria-busy="favorites.loading">
 <div class="favorite-songs-heading"><span>{{ favorites.songs.length }} 首单曲</span><button class="text-button" :disabled="favorites.loading||!!favorites.pending" @click="favorites.read(true)">刷新收藏</button></div>
 <p v-if="reason" class="favorite-songs-hint">{{ reason }}；收藏不会改变当前播放。</p>
 <p v-if="message" role="status" class="favorite-songs-hint">{{ message }}</p>
 <div v-if="favorites.loading" class="favorite-songs-state" role="status"><LoaderCircle class="spinning" :size="24" />正在读取收藏单曲…</div>
 <div v-else-if="favorites.error" class="favorite-songs-state" role="status"><p>{{ favorites.error }}</p><button class="secondary" @click="favorites.read(true)">重试读取单曲</button></div>
 <div v-else-if="favorites.ready&&!favorites.songs.length" class="favorite-songs-state"><Heart :size="32" /><h3>还没有收藏的单曲</h3><p>在歌单、播放队列或播放器中点爱心收藏歌曲。</p></div>
 <div v-else class="favorite-songs-scroll" tabindex="0" aria-label="收藏单曲列表">
  <article v-for="song in favorites.songs" :key="song.source+':'+song.id" class="favorite-song-row"><AlbumArt :src="song.coverUrl" :alt="`${song.name}封面`" /><div class="favorite-song-info"><strong :title="song.name">{{ song.name }}</strong><small :title="`${song.artists} · ${song.album}`">{{ song.source==='qq'?'QQ':'网易云' }} · {{ song.artists||'未知歌手' }}<template v-if="song.album"> · {{ song.album }}</template></small></div><time>{{ format(song.durationMs) }}</time><SongFavoriteButton :source="song.source" :song-id="song.id" :name="song.name" /><button class="icon-button" :aria-label="`加入队列 ${song.name}`" :disabled="!canAdd" :title="reason||'加入待播，不打断当前播放'" @click="add(song)"><LoaderCircle v-if="adding===song.source+':'+song.id" class="spinning" :size="17" /><Plus v-else :size="18" /></button></article>
 </div>
</section></template>
<style scoped>
.favorite-songs{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0}.favorite-songs-heading{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--muted);flex-shrink:0}.favorite-songs-heading button{font-size:12px;min-height:36px}.favorite-songs-hint{font-size:11px;line-height:1.6;color:var(--muted);margin:4px 0 8px;overflow-wrap:anywhere;flex-shrink:0}.favorite-songs-state{display:flex;flex:1;min-height:150px;align-items:center;justify-content:center;flex-direction:column;gap:12px;text-align:center;color:var(--muted);font-size:12px;padding:24px 12px}.favorite-songs-state h3{margin:0;font-size:16px;color:var(--text)}.favorite-songs-state p{margin:0;line-height:1.8}.favorite-songs-scroll{padding-bottom:8px;overflow:auto;min-height:0;flex:1;scrollbar-gutter:stable;overscroll-behavior:contain}.favorite-song-row{display:flex;align-items:center;gap:10px;min-height:64px;padding:8px 4px;border-bottom:1px solid var(--border)}.favorite-song-row .album-art{width:40px;height:40px;border-radius:10px;flex-shrink:0}.favorite-song-info{flex:1;min-width:0}.favorite-song-info strong,.favorite-song-info small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.favorite-song-info strong{font-size:13px;font-weight:500}.favorite-song-info small{font-size:11px;color:var(--muted);margin-top:4px}.favorite-song-row time{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}.favorite-song-row>.icon-button{width:36px;height:36px;flex-shrink:0}.favorite-songs :deep(.song-favorite){width:36px;height:36px}@media(max-width:600px){.favorite-song-row{gap:6px}.favorite-song-row time{display:none}.favorite-song-row>.icon-button,.favorite-songs :deep(.song-favorite){width:44px;height:44px}.favorite-song-info strong{font-size:12px}}@media(max-height:500px){.favorite-songs{min-height:180px;flex-shrink:0}}
</style>
