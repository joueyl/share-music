<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { Play, Plus, LoaderCircle } from 'lucide-vue-next';
import { useApp } from '../store';
import { ui, openSearch } from '../ui';
import AlbumArt from '../components/AlbumArt.vue';
import * as bridge from '../bridge';
// No dedicated collection master exists in the current design; reuse its search/card system.
const app=useApp(),link=ref(''),opened=ref<bridge.MusicPlaylist|null>(null);
const songs=ref<bridge.MusicSearchItem[]>([]),selected=ref(new Set<string>()),busy=ref(false),loading=ref(false),message=ref(''),hasMoreSongs=ref(false);
const requestIds=new Map<string,string>();
const songOffset=ref(0),showImport=ref(false);
let alive=true,generation=0;onUnmounted(()=>{alive=false;generation++;});
const available=computed(()=>!!app.room&&app.connected&&app.permission.enqueue&&!busy.value&&!loading.value);
const allSelected=computed(()=>!!songs.value.length&&songs.value.every(s=>selected.value.has(s.id)));
function toggle(id:string){const next=new Set(selected.value);next.has(id)?next.delete(id):next.add(id);selected.value=next;}
function toggleAll(){selected.value=allSelected.value?new Set():new Set(songs.value.map(s=>s.id));}
function report(e:unknown){const code=e instanceof Error?e.message:String(e);return ({PLAYLIST_LINK_IS_ALBUM:'这是专辑链接，当前仅支持导入歌单，请复制歌单分享链接',PLAYLIST_LINK_ENDPOINT_UNAVAILABLE:'短链接解析接口不存在（HTTP 404），请更新服务端或检查反向代理路由',PLAYLIST_LINK_INVALID:'短链接未指向有效的网易云歌单',PLAYLIST_LINK_RESOLVE_FAILED:'短链接解析失败，请重试或使用完整歌单链接',PLAYLIST_LINK_REDIRECT_LIMIT:'短链接重定向过多，请使用完整歌单链接'} as Record<string,string>)[code]??code;}
async function readSongs(playlist:bridge.MusicPlaylist,gen:number){
 const page=await bridge.playlistSongs(playlist.id,songOffset.value);if(!alive||gen!==generation)return;
 const fresh=page.filter(s=>!songs.value.some(x=>x.id===s.id));songs.value=[...songs.value,...fresh];songOffset.value+=page.length;
 selected.value=new Set([...selected.value,...fresh.map(s=>s.id)]);hasMoreSongs.value=page.length===50&&songOffset.value<playlist.trackCount;
}
async function load(){
 if(loading.value||busy.value)return;
 const gen=++generation;loading.value=true;message.value='';opened.value=null;songs.value=[];selected.value=new Set();hasMoreSongs.value=false;songOffset.value=0;
 try{
  const parsed=await bridge.resolvePlaylistLink(link.value);if(!alive||gen!==generation)return;
  const detail=await bridge.playlistDetail(parsed.id);if(!alive||gen!==generation)return;
  opened.value=detail;showImport.value=false;
  await readSongs(detail,gen);
 }catch(e){if(alive&&gen===generation)message.value=report(e);}
 finally{if(alive&&gen===generation)loading.value=false;}
}
async function loadMoreSongs(){
 if(loading.value||busy.value||!opened.value||!hasMoreSongs.value)return;
 const gen=++generation;loading.value=true;message.value='';
 try{await readSongs(opened.value,gen);}
 catch(e){if(alive&&gen===generation)message.value=report(e);}
 finally{if(alive&&gen===generation)loading.value=false;}
}
async function add(play=false){
 if(!available.value||!app.room||!selected.value.size||(play&&!app.permission.skip))return;
 const roomId=app.room.id,items=songs.value.filter(s=>selected.value.has(s.id));
 if(items.length>200-app.room.playlist.length){message.value=`房间最多 200 首，还可加入 ${200-app.room.playlist.length} 首，请减少勾选`;return;}
 busy.value=true;let success=0,fail=0,first=true;const errors:string[]=[];
 try{
  for(const song of items){
   if(!alive||app.room?.id!==roomId||!app.connected)break;
   message.value=`正在处理 ${success+fail+1}/${items.length}：${song.name}`;
   try{
    const key=roomId+':'+song.id,id=requestIds.get(key)??crypto.randomUUID();requestIds.set(key,id);
    const track=await bridge.addSearchedMusic(roomId,song.id,id,song.coverUrl);success++;
    requestIds.delete(key);
    selected.value=new Set([...selected.value].filter(id=>id!==song.id));
    if(play&&first&&alive&&app.room?.id===roomId){first=false;try{await bridge.playMusic(roomId,track.id,crypto.randomUUID());}catch(e){errors.push(`已加入，但立即播放失败：${report(e)}`);}}
   }catch(e){fail++;errors.push(`${song.name}：${report(e)}`);}
  }
  if(alive)message.value=`已加入 ${success} 首，失败 ${fail} 首${success+fail<items.length?'，其余已停止':''}。${errors.slice(0,3).join('；')}`;
 }finally{if(alive)busy.value=false;}
}
</script>
<template>

 <section class="page library-page tone-library" :aria-busy="busy||loading"><header class="library-topbar"><div class="page-heading"><h1>我的音乐</h1></div>
  <div class="collection-tabs"><button class="selected">网易云歌单</button><button :disabled="!app.room" :title="app.room?'浏览共享音乐库':'加入房间后可浏览音乐库并添加歌曲'" @click="ui.library=true">共享音乐库</button><button @click="openSearch">搜索音乐</button><button v-if="opened" :aria-expanded="showImport" @click="showImport=!showImport">{{ showImport?'收起导入':'更换歌单' }}</button></div></header>
  <form v-if="!opened||showImport" class="music-search-form collection-import" @submit.prevent="load()"><input v-model="link" aria-label="网易云歌单链接" placeholder="粘贴歌单链接、手机分享短链接或 ID…" maxlength="2048" :disabled="busy||loading" /><button class="primary" :disabled="busy||loading||!link.trim()"><LoaderCircle v-if="loading" :size="16" class="spinning" />读取歌单</button></form>
  <p v-if="!app.room" class="aside-note">可先浏览歌单；加入房间后才能添加和播放。</p>
  <p v-if="message" class="library-message" :class="{'loading-state':busy}" role="status">{{ message }}</p>
  <p v-if="loading" class="empty-state compact loading-state" role="status">正在加载歌单与歌曲…</p>
  <template v-if="opened">
   <div class="library-selection-toolbar"><div class="section-title"><h2 class="opened-playlist-title"><strong :title="opened.name">{{ opened.name }}</strong> <span>{{ songs.length }}/{{ opened.trackCount }}</span></h2><small class="playlist-id">歌单 ID：{{ opened.id }}</small></div>
   <div class="library-actions"><label><input type="checkbox" :checked="allSelected" :disabled="busy||loading" @change="toggleAll" />全选已加载歌曲（{{ selected.size }}）</label><button class="secondary" :aria-busy="busy" :disabled="!available||!selected.size" @click="add(false)"><LoaderCircle v-if="busy" :size="16" class="spinning" /><Plus v-else :size="16" />{{ busy ? '处理中…' : '加入播放列表' }}</button><button class="primary" :aria-busy="busy" :disabled="!available||!selected.size||!app.permission.skip||!!app.room?.pending" @click="add(true)"><LoaderCircle v-if="busy" :size="16" class="spinning" /><Play v-else :size="16" />{{ busy ? '处理中…' : '立即播放' }}</button></div></div>
   <div class="track-list" tabindex="0" aria-label="歌单歌曲列表"><label v-for="song in songs" :key="song.id" class="music-search-row"><input type="checkbox" :checked="selected.has(song.id)" :disabled="busy||loading" :aria-label="`选择 ${song.name}`" @change="toggle(song.id)" /><AlbumArt class="music-search-cover" :src="song.coverUrl" :alt="`${song.album||song.name}专辑封面`" /><div class="music-search-info"><strong>{{ song.name }}</strong><small>{{ song.artists }} · {{ song.album }}</small></div></label>
   <button v-if="hasMoreSongs" class="secondary library-load-more" :disabled="busy||loading" @click="loadMoreSongs">加载更多歌曲（默认勾选）</button></div>
   <p v-if="!songs.length&&!loading" class="empty-state">暂无可读取的歌曲</p>
   <details class="library-help"><summary>批量添加说明</summary><p class="muted small">默认多选当前已加载歌曲。立即播放会将所选歌曲加入队列，并播放第一首成功导入的歌曲。失败项保留勾选，可重试；仅导入当前账号可获取的完整音源。</p></details>
  </template>
  <div v-else-if="!loading" class="empty-state library-placeholder"><h3>导入喜欢的歌单</h3><p>填写歌单链接或 ID，仅展示这个歌单的歌曲</p></div>
 </section>
</template>

<style scoped>
.library-topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:12px}
.tone-library .page-heading{padding:0;margin:0}
.tone-library .page-heading h1{font-size:26px;line-height:36px;margin:0}
.tone-library .collection-tabs{margin:0;gap:8px;flex-wrap:wrap}
.tone-library .collection-tabs button{padding:8px 16px;min-height:36px}
.tone-library .collection-import{flex-shrink:0;margin:0 0 12px;padding:6px;gap:8px}
.library-selection-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px}
.tone-library .section-title{flex:1;min-width:0;gap:12px;margin:0}
.opened-playlist-title{display:flex;align-items:center;gap:8px;min-width:0;font-size:15px;margin:0}
.opened-playlist-title>strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.opened-playlist-title>span{flex-shrink:0;font-size:11px;color:var(--muted)}
.tone-library .library-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;position:static;margin:0;padding:6px 10px}
.tone-library .library-actions label{font-size:11px;margin:0;white-space:nowrap}
.tone-library .library-actions button{min-height:34px;font-size:11px;padding:7px 12px}
.tone-library .track-list{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable}
.tone-library .track-list{padding:0 14px}
.tone-library .track-list .music-search-row{padding:8px 0;gap:12px;min-height:56px}
.tone-library .music-search-cover{width:36px;height:36px}
.tone-library .music-search-info small{margin-top:4px}
.playlist-id{font-size:10px;color:var(--muted);white-space:nowrap}
.tone-library .library-placeholder{flex:1;min-height:180px;display:flex;flex-direction:column;justify-content:center}
.library-load-more{margin:10px auto;grid-column:1/-1;justify-self:center}
.library-help{font-size:10px;color:var(--muted);margin-top:8px;flex-shrink:0}
.library-help summary{cursor:pointer;width:fit-content;line-height:1.8}
.library-help p{margin:6px 0 0;line-height:1.8}
.tone-library .aside-note{padding-top:0;border:0;font-size:11px;margin:0 0 8px}
.tone-library .library-message{font-size:11px;line-height:1.6;padding:6px 10px;margin:0 0 8px;max-height:64px;overflow:auto;flex-shrink:0}
@media(max-width:760px){.library-selection-toolbar{align-items:stretch}.tone-library .library-actions{width:100%}.tone-library .library-actions label{margin-right:auto}}
@media(max-width:600px){
 .library-topbar{gap:8px;margin-bottom:10px}
 .tone-library .page-heading h1{font-size:24px}
 .tone-library .collection-tabs{gap:6px}
 .tone-library .collection-tabs button{padding:8px 12px;min-height:40px}
 .tone-library .collection-import input{flex-basis:100%}
 .tone-library .library-actions label{flex-basis:100%}
 .tone-library .library-actions button{min-height:40px;flex:1}
 .tone-library .music-search-cover{width:38px;height:38px}
}
</style>
