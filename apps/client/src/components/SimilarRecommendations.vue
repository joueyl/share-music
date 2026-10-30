<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { Plus, Check, RefreshCw, LoaderCircle } from 'lucide-vue-next';
import { useApp } from '../store';
import * as bridge from '../bridge';
import AlbumArt from './AlbumArt.vue';

const app=useApp(),songs=ref<bridge.MusicSearchItem[]>([]),loading=ref(false),status=ref(''),adding=ref(''),added=ref(new Set<string>());
const track=computed(()=>app.room?.playlist.find(t=>t.id===app.room?.playback.sourceId));
const recommendations=computed(()=>songs.value.filter(song=>!app.room?.playlist.some(t=>t.neteaseId===song.id)).slice(0,3));
const canAdd=computed(()=>app.connected&&app.permission.enqueue&&!adding.value);
const requestIds=new Map<string,string>();
let generation=0,controller:AbortController|undefined,alive=true;
const errors:Record<string,string>={NETEASE_LOGIN_REQUIRED:'音乐服务未登录，请联系管理员',NETEASE_UNAVAILABLE:'推荐暂时无法加载，请重试',NETEASE_METHOD_NOT_ALLOWED:'请更新服务端以启用相似推荐'};
async function load(){
  const version=++generation;controller?.abort();controller=new AbortController();
  const signal=controller.signal,roomId=app.room?.id,current=track.value;
  songs.value=[];status.value='';added.value=new Set();loading.value=false;
  if(!roomId||!current){status.value='播放一首歌，发现更多相似旋律';return;}
  if(!app.connected){status.value='连接恢复后加载相似推荐';return;}
  loading.value=true;
  try{
    const id=current.neteaseId??(await bridge.trackMetadata(roomId,current.id)).neteaseId;
    if(!alive||version!==generation)return;
    if(!id){status.value='这首歌曲暂无可用的相似推荐';return;}
    const result=await bridge.similarMusic(id,signal);
    if(alive&&version===generation&&!signal.aborted)songs.value=result;
  }catch(e){if(alive&&version===generation&&!signal.aborted){const code=e instanceof Error?e.message:String(e);status.value=errors[code]??'推荐暂时无法加载，请重试';}}
  finally{if(alive&&version===generation)loading.value=false;}
}
watch(()=>`${app.room?.id??''}:${track.value?.id??''}:${track.value?.neteaseId??''}:${app.connected}`,()=>{void load();},{immediate:true});
onUnmounted(()=>{alive=false;generation++;controller?.abort();});
async function add(song:bridge.MusicSearchItem){
  if(!canAdd.value||!app.room||added.value.has(song.id))return;
  const roomId=app.room.id,key=`${roomId}:${song.id}`,version=generation;
  const requestId=requestIds.get(key)??crypto.randomUUID();requestIds.set(key,requestId);adding.value=song.id;
  try{
    await bridge.addSearchedMusic(roomId,song.id,requestId,song.coverUrl);requestIds.delete(key);
    if(alive&&app.room?.id===roomId&&version===generation){added.value=new Set([...added.value,song.id]);app.notice=`已将《${song.name}》加入播放列表`;}
  }catch(e){if(alive&&app.room?.id===roomId&&version===generation)app.error(e);}
  finally{if(alive)adding.value='';}
}
</script>
<template>
 <section class="up-next similar-recommendations" aria-labelledby="similar-title" :aria-busy="loading">
  <header><h3 id="similar-title">相似推荐</h3><span>{{ track?`根据《${track.name}》推荐`:'发现与你同频的音乐' }}</span><button :disabled="loading||!track||!app.connected" aria-label="刷新相似推荐" @click="load"><RefreshCw :size="14" :class="{spinning:loading}" />刷新</button></header>
  <p v-if="loading" class="similar-status loading-state" role="status">正在寻找相似的旋律…</p>
  <p v-else-if="status||!recommendations.length" class="similar-status" role="status">{{ status||'暂无更多相似歌曲，试试其他音乐' }}</p>
  <div v-else class="next-track-grid"><button v-for="song in recommendations" :key="song.id" :disabled="!canAdd||added.has(song.id)" :aria-busy="adding===song.id" :aria-label="`${added.has(song.id)?'已添加':'加入播放列表'} ${song.name}`" @click="add(song)"><AlbumArt :src="song.coverUrl" :alt="`${song.name}封面`" /><span><strong>{{ song.name }}</strong><small>{{ song.artists||'未知歌手' }}</small></span><LoaderCircle v-if="adding===song.id" :size="15" class="spinning" /><Check v-else-if="added.has(song.id)" :size="15" /><Plus v-else :size="15" /></button></div>
 </section>
</template>
<style scoped>
.similar-recommendations header>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.similar-recommendations header>button{flex-shrink:0}
.similar-status{font-size:11px;line-height:1.8;color:var(--muted);margin:10px 0 4px}
.next-track-grid>button>svg{flex-shrink:0;margin-left:auto;color:var(--accent)}
.next-track-grid>button:disabled{cursor:default}
.similar-recommendations{flex-shrink:0}
</style>
