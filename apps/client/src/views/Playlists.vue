<script setup lang="ts">
import { computed,onMounted,onUnmounted,ref,watch } from 'vue';
import { Play,Plus,LoaderCircle,Heart,ArrowLeft } from 'lucide-vue-next';
import { useApp } from '../store';
import AlbumArt from '../components/AlbumArt.vue';
import * as bridge from '../bridge';
const app=useApp(),link=ref(''),tab=ref<'netease'|'favorites'>('netease'),opened=ref<bridge.MusicCollection|null>(null);
const songs=ref<bridge.MusicSearchItem[]>([]),selected=ref(new Set<string>()),busy=ref(false),loading=ref(false),message=ref(''),hasMoreSongs=ref(false);
const requestIds=new Map<string,string>(),songOffset=ref(0),showImport=ref(false);
const detailTarget=ref<Pick<bridge.MusicCollection,'kind'|'id'>|null>(null),detailFailed=ref(false);
const profileId=ref(''),playlists=ref<bridge.MusicCollection[]>([]),profileOffset=ref(0),hasMorePlaylists=ref(false);
const favorites=ref<bridge.MusicCollection[]>([]),favoritesReady=ref(false),favoritesLoading=ref(false),favoriteBusy=ref('');
let alive=true,generation=0,favoriteGeneration=0;
onUnmounted(()=>{alive=false;generation++;favoriteGeneration++;});
const available=computed(()=>!!app.room&&app.connected&&app.permission.enqueue&&!busy.value&&!loading.value);
const allSelected=computed(()=>!!songs.value.length&&songs.value.every(s=>selected.value.has(s.id)));
const cards=computed(()=>tab.value==='favorites'?favorites.value:playlists.value);
function durationLabel(ms?:number){if(!ms||!Number.isFinite(ms)||ms<0)return '—';const seconds=Math.floor(ms/1000);return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;}
function toggle(id:string){const next=new Set(selected.value);next.has(id)?next.delete(id):next.add(id);selected.value=next;}
function toggleAll(){selected.value=allSelected.value?new Set():new Set(songs.value.map(s=>s.id));}
function report(e:unknown){const code=e instanceof Error?e.message:String(e);return ({MUSIC_LINK_ENDPOINT_UNAVAILABLE:'链接解析接口不存在，请更新服务端',MUSIC_LINK_INVALID:'请输入网易云个人主页、歌单或专辑链接',MUSIC_LINK_RESOLVE_FAILED:'短链接解析失败，请重试或使用完整链接',MUSIC_LINK_REDIRECT_LIMIT:'短链接重定向过多，请使用完整链接',MUSIC_FAVORITES_FULL:'最多收藏 200 个歌单或专辑',NETEASE_LOGIN_REQUIRED:'网易云登录态已失效，请管理员重新登录'} as Record<string,string>)[code]??code;}
function resetSongs(){detailTarget.value=null;detailFailed.value=false;opened.value=null;songs.value=[];selected.value=new Set();hasMoreSongs.value=false;songOffset.value=0;}
function switchTab(value:'netease'|'favorites'){
 if(busy.value||value===tab.value)return;generation++;loading.value=false;tab.value=value;resetSongs();message.value='';
 if(value==='favorites'&&!favoritesReady.value)void readFavorites();
}
async function readFavorites(){
 const gen=++favoriteGeneration,user=app.user?.id;favoritesReady.value=false;favoritesLoading.value=true;
 try{const result=await bridge.musicFavorites();if(alive&&gen===favoriteGeneration&&user===app.user?.id){favorites.value=result;favoritesReady.value=true;}}
 catch(e){if(alive&&gen===favoriteGeneration)message.value='收藏读取失败：'+report(e);}
 finally{if(alive&&gen===favoriteGeneration)favoritesLoading.value=false;}
}
onMounted(readFavorites);
watch(()=>app.user?.id,()=>{generation++;loading.value=false;resetSongs();profileId.value='';profileOffset.value=0;hasMorePlaylists.value=false;playlists.value=[];favorites.value=[];favoriteBusy.value='';link.value='';message.value='';busy.value=false;requestIds.clear();void readFavorites();});
const isSaved=(item:bridge.MusicCollection)=>favorites.value.some(saved=>saved.kind===item.kind&&saved.id===item.id);
async function favorite(item:bridge.MusicCollection){
 if(favoriteBusy.value||!favoritesReady.value)return;const user=app.user?.id,gen=favoriteGeneration;favoriteBusy.value=item.kind+':'+item.id;
 try{const result=await bridge.setMusicFavorite(item.kind,item.id,!isSaved(item));if(alive&&user===app.user?.id&&gen===favoriteGeneration)favorites.value=result;}
 catch(e){if(alive&&user===app.user?.id&&gen===favoriteGeneration)message.value=report(e);}
 finally{if(alive&&user===app.user?.id&&gen===favoriteGeneration)favoriteBusy.value='';}
}
async function readSongs(collection:bridge.MusicCollection,gen:number){
 const page=await bridge.playlistSongs(collection.id,songOffset.value);if(!alive||gen!==generation)return;
 const fresh=page.filter(s=>!songs.value.some(x=>x.id===s.id));songs.value=[...songs.value,...fresh];songOffset.value+=page.length;
 selected.value=new Set([...selected.value,...fresh.map(s=>s.id)]);hasMoreSongs.value=page.length===50&&songOffset.value<collection.trackCount;
}
async function openCollection(item:Pick<bridge.MusicCollection,'kind'|'id'>){
 if(busy.value)return;const gen=++generation;loading.value=true;message.value='';resetSongs();detailTarget.value={kind:item.kind,id:item.id};showImport.value=false;
 try{
  if(item.kind==='album'){
   const data=await bridge.albumDetail(item.id);if(!alive||gen!==generation)return;
   opened.value=data.collection;songs.value=data.songs;selected.value=new Set(data.songs.map(s=>s.id));
  }else{
   const detail=await bridge.playlistDetail(item.id);if(!alive||gen!==generation)return;
   opened.value={...detail,kind:'playlist'};await readSongs(opened.value,gen);
  }
  showImport.value=false;
 }catch(e){if(alive&&gen===generation){message.value=report(e);detailFailed.value=true;}}
 finally{if(alive&&gen===generation)loading.value=false;}
}
async function readProfile(gen:number){
 // Load every accessible page, with a bounded batch and explicit continuation for huge profiles.
 for(let page=0;page<100;page++){
  const result=await bridge.userPlaylists(profileId.value,profileOffset.value);if(!alive||gen!==generation)return;
  const fresh=result.playlists.filter(item=>!playlists.value.some(old=>old.id===item.id));
  playlists.value.push(...fresh.map(item=>({...item,kind:'playlist' as const})));profileOffset.value+=result.playlists.length;
  hasMorePlaylists.value=result.more&&result.playlists.length>0&&profileOffset.value<=100000;
  if(result.more&&(!result.playlists.length||!fresh.length)){hasMorePlaylists.value=false;throw new Error('歌单分页未返回新内容，请稍后重试');}
  if(!hasMorePlaylists.value)break;
 }
}
async function load(){
 if(busy.value)return;const gen=++generation;loading.value=true;message.value='';tab.value='netease';resetSongs();profileId.value='';playlists.value=[];profileOffset.value=0;hasMorePlaylists.value=false;
 try{
  const parsed=await bridge.resolveMusicLink(link.value);if(!alive||gen!==generation)return;
  if(parsed.kind!=='user'){await openCollection({kind:parsed.kind,id:parsed.id});return;}
  profileId.value=parsed.id;await readProfile(gen);
 }catch(e){if(alive&&gen===generation)message.value=report(e);}
 finally{if(alive&&gen===generation)loading.value=false;}
}
async function loadMorePlaylists(){if(loading.value||busy.value||!hasMorePlaylists.value)return;const gen=++generation;loading.value=true;try{await readProfile(gen);}catch(e){if(alive&&gen===generation)message.value=report(e);}finally{if(alive&&gen===generation)loading.value=false;}}
async function loadMoreSongs(){
 if(loading.value||busy.value||!opened.value||!hasMoreSongs.value)return;
 const gen=++generation;loading.value=true;message.value='';
 try{await readSongs(opened.value,gen);}catch(e){if(alive&&gen===generation)message.value=report(e);}finally{if(alive&&gen===generation)loading.value=false;}
}
function back(){if(busy.value)return;generation++;loading.value=false;resetSongs();message.value='';}
async function add(play=false){
 if(!available.value||!app.room||!selected.value.size||(play&&!app.permission.skip))return;
 const ownerId=app.user?.id,roomId=app.room.id,items=songs.value.filter(s=>selected.value.has(s.id));
 if(items.length>200-app.room.playlist.length){message.value=`房间最多 200 首，还可加入 ${200-app.room.playlist.length} 首，请减少勾选`;return;}
 busy.value=true;let success=0,fail=0,first=true;const errors:string[]=[];
 try{
  for(const song of items){
   if(!alive||app.user?.id!==ownerId||app.room?.id!==roomId||!app.connected)break;
   message.value=`正在处理 ${success+fail+1}/${items.length}：${song.name}`;
   try{
    const key=roomId+':'+song.id,id=requestIds.get(key)??crypto.randomUUID();requestIds.set(key,id);
    const track=await bridge.addSearchedMusic(roomId,song.id,id,song.coverUrl);
    if(!alive||app.user?.id!==ownerId||app.room?.id!==roomId)break;success++;
    requestIds.delete(key);
    selected.value=new Set([...selected.value].filter(id=>id!==song.id));
    if(play&&first&&alive&&app.room?.id===roomId){first=false;try{await bridge.playMusic(roomId,track.id,crypto.randomUUID());}catch(e){errors.push(`已加入，但立即播放失败：${report(e)}`);}}
   }catch(e){if(!alive||app.user?.id!==ownerId||app.room?.id!==roomId)break;fail++;errors.push(`${song.name}：${report(e)}`);}
  }
  if(alive&&app.user?.id===ownerId&&app.room?.id===roomId)message.value=`已加入 ${success} 首，失败 ${fail} 首${success+fail<items.length?'，其余已停止':''}。${errors.slice(0,3).join('；')}`;
 }finally{if(alive&&app.user?.id===ownerId)busy.value=false;}
}
</script>
<template>
 <section class="page library-page tone-library" :aria-busy="busy||loading">
  <header class="library-topbar"><div class="page-heading"><h1>我的音乐</h1></div><div class="collection-tabs" role="tablist" aria-label="音乐收藏分类"><button role="tab" :aria-selected="tab==='netease'" :class="{selected:tab==='netease'}" :disabled="busy" @click="switchTab('netease')">网易云歌单</button><button role="tab" :aria-selected="tab==='favorites'" :class="{selected:tab==='favorites'}" :disabled="busy" @click="switchTab('favorites')">已收藏</button></div></header>
  <form v-if="tab==='netease'&&(!detailTarget||showImport)" class="music-search-form collection-import" @submit.prevent="load"><input v-model="link" aria-label="网易云个人主页、歌单或专辑链接" placeholder="输入个人主页、歌单、专辑链接或手机分享短链接…" maxlength="4096" :disabled="busy" /><button class="primary" :disabled="busy||loading||!link.trim()"><LoaderCircle v-if="loading" :size="16" class="spinning" />读取链接</button></form>
  <p v-if="!app.room" class="aside-note">可先浏览和收藏；加入房间后才能添加和播放歌曲。</p>
  <p v-if="message" class="library-message" :class="{'loading-state':busy}" role="status">{{ message }}</p>
  <p v-if="loading&&!detailTarget" class="loading-state compact" role="status">正在读取链接或用户歌单…</p>
  <template v-if="detailTarget">
   <div class="collection-detail-nav"><button class="text-button" :disabled="busy" @click="back"><ArrowLeft :size="16" />返回{{ tab==='favorites'?'已收藏':'歌单列表' }}</button><button v-if="tab==='netease'" class="text-button" :disabled="busy" :aria-expanded="showImport" @click="showImport=!showImport">{{ showImport?'收起输入':'更换链接' }}</button><button v-if="opened" class="secondary favorite-action" :disabled="!!favoriteBusy||!favoritesReady" :aria-pressed="isSaved(opened)" @click="favorite(opened)"><Heart :size="15" />{{ isSaved(opened)?'取消收藏':'收藏'+(opened.kind==='album'?'专辑':'歌单') }}</button></div>
   <div v-if="opened" class="library-selection-toolbar"><div class="section-title"><h2 class="opened-playlist-title"><strong :title="opened.name">{{ opened.name }}</strong><span>{{ songs.length }}/{{ opened.trackCount }}</span></h2><small class="playlist-id">{{ opened.kind==='album'?'专辑':'歌单' }} ID：{{ opened.id }}</small></div>
    <div class="library-actions"><label><input type="checkbox" :checked="allSelected" :disabled="busy||loading" @change="toggleAll" />全选已加载歌曲（{{ selected.size }}）</label><button class="secondary" :aria-busy="busy" :disabled="!available||!selected.size" @click="add(false)"><LoaderCircle v-if="busy" :size="16" class="spinning" /><Plus v-else :size="16" />{{ busy?'处理中…':'加入播放列表' }}</button><button class="primary" :disabled="!available||!selected.size||!app.permission.skip||!!app.room?.pending" @click="add(true)"><Play :size="16" />立即播放</button></div>
   </div>
   <p v-if="opened?.description" class="collection-description">{{ opened.description }}</p>
   <div class="track-list" tabindex="0" :aria-label="detailTarget.kind==='album'?'专辑歌曲列表':'歌单歌曲列表'"><p v-if="loading" class="loading-state detail-loading" role="status"><LoaderCircle :size="20" class="spinning" />正在加载{{ detailTarget.kind==='album'?'专辑':'歌单' }}详情…</p><button v-if="detailFailed&&!loading" class="secondary" @click="openCollection(detailTarget)">重新加载详情</button><label v-for="song in songs" :key="song.id" class="music-search-row" :data-selected="selected.has(song.id)"><input type="checkbox" :checked="selected.has(song.id)" :disabled="busy||loading" :aria-label="`选择 ${song.name}`" @change="toggle(song.id)" /><span class="detail-track-main"><AlbumArt class="music-search-cover" :src="song.coverUrl" :alt="`${song.album||song.name}专辑封面`" /><span class="music-search-info"><strong :title="song.name">{{ song.name }}</strong><small :title="`${song.artists||'未知歌手'} · ${song.album||'未知专辑'}`">{{ song.artists||'未知歌手' }} · {{ song.album||'未知专辑' }}</small></span></span><time class="detail-track-duration" :aria-label="`时长 ${durationLabel(song.durationMs)}`">{{ durationLabel(song.durationMs) }}</time></label><p v-if="!songs.length&&!loading&&!detailFailed" class="empty-state">暂无可读取的歌曲</p><button v-if="hasMoreSongs" class="secondary library-load-more" :disabled="busy||loading" @click="loadMoreSongs">加载更多歌曲（默认勾选）</button></div>
   <details class="library-help"><summary>批量添加说明</summary><p>默认勾选已加载歌曲。按真实权限、容量和音源情况加入房间队列；失败项保留勾选，可重试。</p></details>
  </template>
  <template v-else>
   <div v-if="profileId&&tab==='netease'" class="profile-heading"><strong>用户歌单</strong><small>用户 ID：{{ profileId }} · {{ playlists.length }} 个歌单</small></div>
   <div class="collection-grid" tabindex="0" :aria-label="tab==='favorites'?'已收藏歌单和专辑':'用户歌单列表'"><article v-for="item in cards" :key="item.kind+':'+item.id" class="music-collection-card"><button class="collection-open" :disabled="busy" :aria-label="`打开${item.kind==='album'?'专辑':'歌单'} ${item.name}`" @click="openCollection(item)"><AlbumArt :src="item.coverUrl" /><span><strong :title="item.name">{{ item.name }}</strong><small>{{ item.kind==='album'?'专辑':'歌单' }} · {{ item.trackCount }} 首</small></span></button><button class="icon-button favorite-action" :disabled="!!favoriteBusy||!favoritesReady" :aria-label="`${isSaved(item)?'取消收藏':'收藏'} ${item.name}`" :aria-pressed="isSaved(item)" @click="favorite(item)"><Heart :size="17" /></button></article>
    <button v-if="tab==='netease'&&hasMorePlaylists" class="secondary library-load-more" :disabled="busy||loading" @click="loadMorePlaylists">加载更多用户歌单</button>
    <div v-if="!cards.length&&!loading" class="empty-state library-placeholder"><h3>{{ tab==='favorites'?(favoritesLoading?'正在读取收藏…':favoritesReady?'还没有收藏':'收藏暂时无法读取'):'读取网易云音乐' }}</h3><p>{{ tab==='favorites'?'收藏的歌单与专辑会保存在当前同频账号下，不影响网易云账号':'个人主页显示用户歌单；歌单、专辑链接直接打开详情' }}</p><button v-if="tab==='favorites'&&!favoritesReady&&!favoritesLoading" class="secondary" @click="readFavorites">重试读取收藏</button></div>
   </div>
  </template>
 </section>
</template>
<style scoped>
.collection-grid{flex:1;min-height:0;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(240px,100%),1fr));align-content:start;gap:12px;scrollbar-gutter:stable;padding:2px 2px 12px}
.music-collection-card{min-width:0;display:flex;align-items:center;gap:8px;padding:12px;background:var(--surface);border:1px solid var(--border);border-radius:16px}
.collection-open{display:flex;align-items:center;gap:12px;min-width:0;flex:1;justify-content:flex-start;text-align:left;background:transparent;padding:0}
.collection-open .album-art{width:52px;height:52px;flex:0 0 52px;object-fit:cover}
.collection-open>span{flex:1;min-width:0}.collection-open strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.collection-open small{display:block;color:var(--muted);margin-top:6px;font-size:11px}
.detail-loading{display:flex;align-items:center;justify-content:center;gap:10px;padding:32px 12px}
.favorite-action[aria-pressed=true]{color:var(--accent)}
.profile-heading,.collection-detail-nav{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px;flex-shrink:0}.profile-heading small{color:var(--muted)}
.collection-detail-nav .favorite-action{margin-left:auto}.collection-description{font-size:12px;line-height:1.6;max-height:58px;overflow:auto;flex-shrink:0;margin:0 0 10px;color:var(--muted)}
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
.tone-library .library-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;position:static;margin:0;padding:6px 0;background:transparent;border:0;box-shadow:none}
.tone-library .library-actions label{font-size:11px;margin:0;white-space:nowrap}
.tone-library .library-actions button{min-height:34px;font-size:11px;padding:7px 12px}
.tone-library .track-list{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable}
.tone-library .track-list{display:grid;grid-template-columns:minmax(0,1fr);align-content:start;gap:12px;padding:2px 2px 12px;background:transparent;border:0;border-radius:0}
.tone-library .track-list .music-search-row{display:grid;grid-template-columns:18px minmax(0,1fr) 38px;align-items:center;gap:12px;padding:12px;min-height:78px;margin:0;background:var(--surface);border:1px solid var(--border);border-radius:16px;cursor:pointer;transition:background .15s,border-color .15s}
.tone-library .track-list .music-search-row:hover{background:#edf3fa}
.tone-library .track-list .music-search-row[data-selected=true]{border-color:#bdcee3}
.tone-library .track-list .music-search-row:focus-within{border-color:var(--accent)}
.tone-library .track-list input[type=checkbox]{width:16px;height:16px;margin:0}
.tone-library .track-list>.detail-loading,.tone-library .track-list>.empty-state,.tone-library .track-list>button{grid-column:1/-1}
.detail-track-main{display:flex;align-items:center;gap:12px;min-width:0}
.tone-library .detail-track-main .music-search-cover{width:52px;height:52px;flex:0 0 52px;border:0;border-radius:10px;background:transparent;box-shadow:none;object-fit:cover}
.tone-library .music-search-info{min-width:0;flex:1}
.tone-library .music-search-info strong{display:block;font-size:13px;font-weight:500;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tone-library .music-search-info small{display:block;margin-top:4px;font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.detail-track-duration{font-size:11px;color:var(--muted);text-align:right;font-variant-numeric:tabular-nums}
.playlist-id{font-size:10px;color:var(--muted);white-space:nowrap}
.tone-library .library-placeholder{grid-column:1/-1;flex:1;min-height:180px;display:flex;flex-direction:column;justify-content:center}
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
 .tone-library .track-list .music-search-row{gap:10px}
 .detail-track-main{gap:10px}
}
</style>
