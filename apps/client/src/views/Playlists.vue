<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { Disc3, Play, Plus, ArrowLeft, LoaderCircle } from 'lucide-vue-next';
import { useApp } from '../store';
import * as bridge from '../bridge';
import { parsePlaylistLink } from '../music-library';
import { getServerUrl } from '../server-config';
const app=useApp(),link=ref(''),playlists=ref<bridge.MusicPlaylist[]>([]),opened=ref<bridge.MusicPlaylist|null>(null);
const songs=ref<bridge.MusicSearchItem[]>([]),selected=ref(new Set<string>()),busy=ref(false),loading=ref(false),message=ref(''),more=ref(false),uid=ref(''),userOffset=ref(0),hasMoreSongs=ref(false);
const failedCovers=ref(new Set<string>()),requestIds=new Map<string,string>();
const songOffset=ref(0);
const key=`music-share.playlists:${getServerUrl()}:${app.user?.id}`;
const saved=ref<{id:string;creatorId?:string;name:string}[]>([]);
try{const items=JSON.parse(localStorage.getItem(key)??'[]');if(Array.isArray(items))saved.value=items.filter(x=>x&&typeof x.id==='string'&&/^\d{1,20}$/.test(x.id)&&typeof x.name==='string').slice(0,30);}catch{}
let alive=true,generation=0;onUnmounted(()=>{alive=false;generation++;});
const available=computed(()=>!!app.room&&app.connected&&app.permission.enqueue&&!busy.value&&!loading.value);
const allSelected=computed(()=>!!songs.value.length&&songs.value.every(s=>selected.value.has(s.id)));
function toggle(id:string){const next=new Set(selected.value);next.has(id)?next.delete(id):next.add(id);selected.value=next;}
function toggleAll(){selected.value=allSelected.value?new Set():new Set(songs.value.map(s=>s.id));}
function report(e:unknown){return e instanceof Error?e.message:String(e);}
async function load(input=link.value){
 if(loading.value||busy.value)return;
 let parsed;try{parsed=parsePlaylistLink(input);}catch(e){message.value=report(e);return;}
 const gen=++generation;loading.value=true;message.value='';opened.value=null;songs.value=[];selected.value=new Set();
 try{
  const detail=await bridge.playlistDetail(parsed.id);if(!alive||gen!==generation)return;
  uid.value=parsed.creatorId??detail.creatorId;playlists.value=[detail];more.value=false;userOffset.value=0;
  saved.value=[{id:detail.id,creatorId:uid.value,name:detail.name},...saved.value.filter(p=>p.id!==detail.id)].slice(0,30);
  try{localStorage.setItem(key,JSON.stringify(saved.value));}catch{/* Browsing still works when local storage is unavailable. */}
  if(/^\d{1,20}$/.test(uid.value)){
   try{const result=await bridge.userPlaylists(uid.value);if(!alive||gen!==generation)return;playlists.value=[detail,...result.playlists.filter(p=>p.id!==detail.id)];more.value=result.more;}
   catch(e){if(alive&&gen===generation)message.value=`用户歌单加载失败，仍可打开链接歌单：${report(e)}`;}
  }
 }catch(e){if(alive&&gen===generation)message.value=report(e);}
 finally{if(alive&&gen===generation)loading.value=false;}
}
async function nextPlaylists(){
 if(loading.value||busy.value)return;const gen=generation;loading.value=true;
 try{const offset=userOffset.value+30,result=await bridge.userPlaylists(uid.value,offset);if(!alive||gen!==generation)return;playlists.value=[...playlists.value,...result.playlists.filter(p=>!playlists.value.some(x=>x.id===p.id))];more.value=result.more;userOffset.value=offset;}
 catch(e){if(alive)message.value=report(e);}finally{if(alive)loading.value=false;}
}
async function open(playlist:bridge.MusicPlaylist,append=false){
 if(loading.value||busy.value)return;const gen=++generation;loading.value=true;message.value='';
 if(!append){opened.value=playlist;songs.value=[];selected.value=new Set();hasMoreSongs.value=false;songOffset.value=0;}
 try{
  const page=await bridge.playlistSongs(playlist.id,songOffset.value);if(!alive||gen!==generation)return;
  const fresh=page.filter(s=>!songs.value.some(x=>x.id===s.id));songs.value=[...songs.value,...fresh];songOffset.value+=page.length;
  selected.value=new Set([...selected.value,...fresh.map(s=>s.id)]);hasMoreSongs.value=page.length===50&&songOffset.value<playlist.trackCount;
 }catch(e){if(alive&&gen===generation)message.value=report(e);}
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
 <header class="topbar"><span>我的歌单</span><router-link v-if="app.room" :to="`/room/${app.room.id}`" class="text-button">返回正在收听</router-link></header>
 <section class="page library-page" :aria-busy="busy||loading"><div class="page-heading"><div><span class="eyebrow">YOUR MUSIC COLLECTION</span><h1>把歌单带进房间</h1><p class="muted">粘贴网易云歌单链接，浏览创建者的歌单，自由多选歌曲</p></div></div>
  <form class="music-search-form" @submit.prevent="load()"><input v-model="link" aria-label="网易云歌单链接" placeholder="https://music.163.com/m/playlist?id=…&creatorId=…" maxlength="2048" :disabled="busy||loading" /><button class="primary" :disabled="busy||loading||!link.trim()"><LoaderCircle v-if="loading" :size="16" class="spinning" />读取歌单</button></form>
  <div v-if="saved.length" class="saved-playlists"><span class="muted">最近导入</span><button v-for="p in saved" :key="p.id" class="secondary" :disabled="busy||loading" @click="load(`https://music.163.com/m/playlist?id=${p.id}${p.creatorId?'&creatorId='+p.creatorId:''}`)">{{ p.name }}</button></div>
  <p v-if="!app.room" class="aside-note">可先浏览歌单；加入房间后才能添加和播放。</p>
  <p v-if="message" class="library-message" :class="{'loading-state':busy}" role="status">{{ message }}</p>
  <p v-if="loading" class="empty-state compact loading-state" role="status">正在加载歌单与歌曲…</p>
  <template v-if="opened">
   <div class="section-title"><h2 class="opened-playlist-title"><strong :title="opened.name">{{ opened.name }}</strong> <span>{{ songs.length }}/{{ opened.trackCount }}</span></h2><button class="text-button" :disabled="busy||loading" @click="opened=null"><ArrowLeft :size="15" />用户歌单</button></div>
   <div class="library-actions"><label><input type="checkbox" :checked="allSelected" :disabled="busy||loading" @change="toggleAll" />全选已加载歌曲（{{ selected.size }}）</label><button class="secondary" :aria-busy="busy" :disabled="!available||!selected.size" @click="add(false)"><LoaderCircle v-if="busy" :size="16" class="spinning" /><Plus v-else :size="16" />{{ busy ? '处理中…' : '加入播放列表' }}</button><button class="primary" :aria-busy="busy" :disabled="!available||!selected.size||!app.permission.skip||!!app.room?.pending" @click="add(true)"><LoaderCircle v-if="busy" :size="16" class="spinning" /><Play v-else :size="16" />{{ busy ? '处理中…' : '立即播放' }}</button></div>
   <div class="track-list"><label v-for="song in songs" :key="song.id" class="music-search-row"><input type="checkbox" :checked="selected.has(song.id)" :disabled="busy||loading" :aria-label="`选择 ${song.name}`" @change="toggle(song.id)" /><div class="music-search-cover"><img v-if="song.coverUrl&&!failedCovers.has(song.coverUrl)" :src="song.coverUrl" alt="专辑封面" loading="lazy" referrerpolicy="no-referrer" @error="failedCovers.add(song.coverUrl)" /><Disc3 v-else :size="24" /></div><div class="music-search-info"><strong>{{ song.name }}</strong><small>{{ song.artists }} · {{ song.album }}</small></div></label></div>
   <button v-if="hasMoreSongs" class="secondary" :disabled="busy||loading" @click="open(opened,true)">加载更多歌曲（默认勾选）</button>
   <p v-if="!songs.length&&!loading" class="empty-state">暂无可读取的歌曲</p>
   <p class="muted small">默认多选当前已加载歌曲。立即播放会将所选歌曲加入队列，并播放第一首成功导入的歌曲。失败项保留勾选，可重试；仅导入当前账号可获取的完整音源。</p>
  </template>
  <template v-else><div class="playlist-grid"><button v-for="p in playlists" :key="p.id" class="playlist-card" :disabled="loading||busy" @click="open(p)"><img v-if="p.coverUrl&&!failedCovers.has(p.coverUrl)" :src="p.coverUrl" alt="歌单封面" referrerpolicy="no-referrer" loading="lazy" @error="failedCovers.add(p.coverUrl)" /><Disc3 v-else :size="44" /><strong>{{ p.name }}</strong><small>{{ p.trackCount }} 首 · 打开并选择歌曲</small></button></div><button v-if="more" class="secondary" :disabled="busy||loading" @click="nextPlaylists">更多用户歌单</button><p v-if="!playlists.length&&!loading" class="empty-state">填写歌单链接，开始整理喜欢的音乐</p></template>
 </section>
</template>
