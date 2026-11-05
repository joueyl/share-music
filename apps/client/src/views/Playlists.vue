<script setup lang="ts">
import { computed,nextTick,onMounted,onUnmounted,ref,watch } from 'vue';
import { Play,Plus,LoaderCircle,Heart,ArrowLeft,ArrowRight,Link, ListMusic, CircleHelp } from 'lucide-vue-next';
import { useApp } from '../store';
import AlbumArt from '../components/AlbumArt.vue';
import * as bridge from '../bridge';
const app=useApp(),link=ref(''),tab=ref<'netease'|'favorites'>('netease'),opened=ref<bridge.MusicCollection|null>(null);
const songs=ref<bridge.MusicSearchItem[]>([]),selected=ref(new Set<string>()),busy=ref(false),loading=ref(false),message=ref(''),hasMoreSongs=ref(false);
const requestIds=new Map<string,string>(),songOffset=ref(0),showImport=ref(false);
const detailTarget=ref<Pick<bridge.MusicCollection,'kind'|'id'>|null>(null),detailFailed=ref(false);
const profileId=ref(''),playlists=ref<bridge.MusicCollection[]>([]),profileOffset=ref(0),hasMorePlaylists=ref(false);
const favorites=ref<bridge.MusicCollection[]>([]),favoritesReady=ref(false),favoritesLoading=ref(false),favoriteBusy=ref('');
const collectionList=ref<HTMLElement|null>(null),listScroll={netease:0,favorites:0};
let lastCollection='';
let alive=true,generation=0,favoriteGeneration=0;
onUnmounted(()=>{alive=false;generation++;favoriteGeneration++;});
const available=computed(()=>!!app.room&&app.connected&&app.permission.enqueue&&!app.room.pending&&!app.pendingActions&&!app.busy&&!busy.value&&!loading.value);
const addHint=computed(()=>!app.room?'可先浏览和收藏；加入房间后即可添加歌曲':!app.connected?'连接已断开，重连后可添加歌曲':!app.permission.enqueue?'当前没有播放列表控制权限':app.room.pending||app.pendingActions||app.busy?'房间正在处理操作，请稍候':busy.value?'正在加入房间，请稍候':'加入待播列表，不会打断当前播放');
const allSelected=computed(()=>!!songs.value.length&&songs.value.every(s=>selected.value.has(s.id)));
const cards=computed(()=>tab.value==='favorites'?favorites.value:playlists.value);
function durationLabel(ms?:number){if(!ms||!Number.isFinite(ms)||ms<0)return '—';const seconds=Math.floor(ms/1000);return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;}
function toggle(id:string){const next=new Set(selected.value);next.has(id)?next.delete(id):next.add(id);selected.value=next;}
function toggleAll(){selected.value=allSelected.value?new Set():new Set(songs.value.map(s=>s.id));}
function rememberList(){if(collectionList.value)listScroll[tab.value]=collectionList.value.scrollTop||0;}
async function restoreList(gen:number,focus=false){
 await nextTick();if(!alive||gen!==generation||detailTarget.value||!collectionList.value)return;
 collectionList.value.scrollTop=listScroll[tab.value];
 if(focus){const button=Array.from(collectionList.value.querySelectorAll?.<HTMLButtonElement>('[data-collection-key]')??[]).find(el=>el.dataset.collectionKey===lastCollection);button?.focus({preventScroll:true});}
}
function report(e:unknown){const code=e instanceof Error?e.message:String(e);return ({MUSIC_LINK_ENDPOINT_UNAVAILABLE:'链接解析接口不存在，请更新服务端',MUSIC_LINK_INVALID:'请输入网易云个人主页、歌单或专辑链接',MUSIC_LINK_RESOLVE_FAILED:'短链接解析失败，请重试或使用完整链接',MUSIC_LINK_REDIRECT_LIMIT:'短链接重定向过多，请使用完整链接',MUSIC_FAVORITES_FULL:'最多收藏 200 个歌单或专辑',NETEASE_LOGIN_REQUIRED:'网易云登录态已失效，请管理员重新登录'} as Record<string,string>)[code]??code;}
function resetSongs(){detailTarget.value=null;detailFailed.value=false;opened.value=null;songs.value=[];selected.value=new Set();hasMoreSongs.value=false;songOffset.value=0;}
function switchTab(value:'netease'|'favorites'){
 if(busy.value||value===tab.value)return;rememberList();generation++;loading.value=false;tab.value=value;resetSongs();message.value='';void restoreList(generation);
 if(value==='favorites'&&!favoritesReady.value&&!favoritesLoading.value)void readFavorites();
}
async function readFavorites(){
 if(tab.value==='favorites')message.value='';
 const gen=++favoriteGeneration,user=app.user?.id;favoritesReady.value=false;favoritesLoading.value=true;
 try{const result=await bridge.musicFavorites();if(alive&&gen===favoriteGeneration&&user===app.user?.id){favorites.value=result;favoritesReady.value=true;}}
 catch(e){if(alive&&gen===favoriteGeneration)message.value='收藏读取失败：'+report(e);}
 finally{if(alive&&gen===favoriteGeneration)favoritesLoading.value=false;}
}
onMounted(readFavorites);
watch(()=>app.user?.id,()=>{generation++;loading.value=false;resetSongs();profileId.value='';profileOffset.value=0;hasMorePlaylists.value=false;playlists.value=[];favorites.value=[];favoriteBusy.value='';link.value='';message.value='';busy.value=false;listScroll.netease=0;listScroll.favorites=0;lastCollection='';requestIds.clear();void readFavorites();});
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
 if(busy.value)return;rememberList();lastCollection=item.kind+':'+item.id;const gen=++generation;loading.value=true;message.value='';resetSongs();detailTarget.value={kind:item.kind,id:item.id};showImport.value=false;
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
 if(busy.value)return;const gen=++generation;loading.value=true;message.value='';tab.value='netease';listScroll.netease=0;resetSongs();profileId.value='';playlists.value=[];profileOffset.value=0;hasMorePlaylists.value=false;
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
function back(){if(busy.value)return;generation++;loading.value=false;resetSongs();message.value='';void restoreList(generation,true);}
async function add(play=false){
 if(!available.value||!app.room||!selected.value.size||(play&&!app.permission.skip))return;
 const ownerId=app.user?.id,roomId=app.room.id,items=songs.value.filter(s=>selected.value.has(s.id));
 if(items.length>200-app.room.playlist.length){message.value=`房间最多 200 首，还可加入 ${200-app.room.playlist.length} 首，请减少勾选`;return;}
 busy.value=true;let success=0,fail=0,first=true;const errors:string[]=[];
 try{
  for(const song of items){
   if(!alive||app.user?.id!==ownerId||app.room?.id!==roomId||!app.connected||!app.permission.enqueue)break;
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
 <section class="page library-page tone-library" :class="{'is-detail':!!detailTarget}" :aria-busy="busy||loading||(tab==='favorites'&&favoritesLoading)">
  <header class="library-topbar">
   <div class="page-heading"><h1>我的音乐</h1><p v-if="tab==='netease'&&!detailTarget">把喜欢的音乐，带进同一个房间。</p></div>
   <div class="collection-tabs" :class="{'favorites-active':tab==='favorites'}" role="tablist" aria-label="音乐收藏分类">
    <button role="tab" :aria-selected="tab==='netease'" :class="{selected:tab==='netease'}" :disabled="busy" @click="switchTab('netease')"><ListMusic :size="17" />网易云歌单</button>
    <button role="tab" :aria-selected="tab==='favorites'" :class="{selected:tab==='favorites'}" :disabled="busy" @click="switchTab('favorites')"><Heart :size="17" />已收藏</button>
   </div>
  </header>
  <form v-if="tab==='netease'&&(!detailTarget||showImport)" class="music-search-form collection-import" @submit.prevent="load">
   <label class="import-label" for="music-reference"><Link :size="20" />网易云链接</label>
   <div class="import-input"><input id="music-reference" v-model="link" aria-label="网易云个人主页、歌单或专辑链接" placeholder="粘贴个人主页、歌单或专辑链接" maxlength="4096" :disabled="busy" /><kbd>Enter 打开</kbd></div>
   <button class="primary" :disabled="busy||loading||!link.trim()"><LoaderCircle v-if="loading" :size="17" class="spinning" /><ArrowRight v-else :size="18" />打开</button>
  </form>
  <p v-if="message" class="library-message" :class="{'loading-state':busy}" role="status">{{ message }}</p>
  <template v-if="detailTarget">
   <div class="collection-detail-nav">
    <button class="text-button" :disabled="busy" @click="back"><ArrowLeft :size="17" />返回{{ tab==='favorites'?'已收藏':'歌单列表' }}</button>
    <button v-if="tab==='netease'" class="secondary change-reference" :disabled="busy" :aria-expanded="showImport" @click="showImport=!showImport"><Link :size="16" />{{ showImport?'收起输入':'更换链接' }}</button>
   </div>
   <div v-if="opened" :key="'summary:'+opened.kind+':'+opened.id" class="collection-summary">
    <AlbumArt class="collection-summary-cover" :src="opened.coverUrl" :alt="`${opened.name}封面`" />
    <div class="collection-summary-info"><h2 :title="opened.name">{{ opened.name }}</h2><p>网易云{{ opened.kind==='album'?'专辑':'歌单' }}<span> · {{ opened.trackCount }} 首歌曲</span><small class="playlist-id">{{ opened.kind==='album'?'专辑':'歌单' }} ID：{{ opened.id }}</small></p><p class="collection-description" v-if="opened.description" :title="opened.description">{{ opened.description }}</p></div>
    <button class="secondary favorite-action" :disabled="!!favoriteBusy||!favoritesReady" :aria-pressed="isSaved(opened)" @click="favorite(opened)"><LoaderCircle v-if="favoriteBusy===opened.kind+':'+opened.id" :size="17" class="spinning" /><Heart v-else :size="17" :fill="isSaved(opened)?'currentColor':'none'" />{{ isSaved(opened)?'已收藏':'收藏'+(opened.kind==='album'?'专辑':'歌单') }}</button>
   </div>
   <div v-if="opened" class="library-selection-toolbar">
    <div class="library-selection"><label><input type="checkbox" :checked="allSelected" :indeterminate="selected.size>0&&!allSelected" :disabled="busy||loading||!songs.length" @change="toggleAll" />全选已加载</label><span :key="selected.size" class="selection-count">已选 {{ selected.size }} 首</span><button class="text-button clear-selection" :disabled="busy||loading||!selected.size" @click="selected=new Set()">取消选择</button></div>
    <p class="add-hint" id="music-add-hint" role="status">{{ addHint }}</p>
    <div class="library-actions"><button class="primary" :aria-busy="busy" aria-describedby="music-add-hint" :disabled="!available||!selected.size" @click="add(false)"><LoaderCircle v-if="busy" :size="17" class="spinning" /><Plus v-else :size="18" />{{ busy?'处理中…':`加入房间 · ${selected.size} 首` }}</button><button class="secondary play-selection" :disabled="!available||!selected.size||!app.permission.skip" @click="add(true)"><Play :size="15" />立即播放</button></div>
   </div>
   <div :key="'songs:'+detailTarget.kind+':'+detailTarget.id" class="track-list" tabindex="0" :aria-label="detailTarget.kind==='album'?'专辑歌曲列表':'歌单歌曲列表'">
    <p v-if="loading" class="loading-state detail-loading" role="status"><LoaderCircle :size="20" class="spinning" />{{ opened?'正在加载更多歌曲…':`正在加载${detailTarget.kind==='album'?'专辑':'歌单'}详情…` }}</p>
    <div v-if="detailFailed&&!loading" class="library-placeholder detail-error"><ListMusic :size="36" /><h3>暂时无法读取详情</h3><button class="secondary" @click="openCollection(detailTarget)">重新加载详情</button></div>
    <label v-for="song in songs" :key="song.id" class="music-search-row" :data-selected="selected.has(song.id)"><input type="checkbox" :checked="selected.has(song.id)" :disabled="busy||loading" :aria-label="`选择 ${song.name}`" @change="toggle(song.id)" /><span class="detail-track-main"><AlbumArt class="music-search-cover" :src="song.coverUrl" :alt="`${song.album||song.name}专辑封面`" /><span class="music-search-info"><strong :title="song.name">{{ song.name }}</strong><small :title="`${song.artists||'未知歌手'} · ${song.album||'未知专辑'}`">{{ song.artists||'未知歌手' }} · {{ song.album||'未知专辑' }}</small></span></span><time class="detail-track-duration" :aria-label="`时长 ${durationLabel(song.durationMs)}`">{{ durationLabel(song.durationMs) }}</time></label>
    <div v-if="!songs.length&&!loading&&!detailFailed" class="library-placeholder"><ListMusic :size="36" /><h3>暂无可读取的歌曲</h3></div>
    <button v-if="hasMoreSongs" class="secondary library-load-more" :disabled="busy||loading" @click="loadMoreSongs">加载更多歌曲（默认勾选）</button>
   </div>
   <footer v-if="opened" class="library-list-footer"><small>已加载 {{ songs.length }} / {{ opened.trackCount }} 首</small><details class="library-help"><summary><CircleHelp :size="14" />批量添加说明</summary><p>默认勾选已加载歌曲；全选仅针对已加载的歌曲。加入房间不会打断播放；立即播放需额外播放权限。失败项保留勾选，可重试。</p></details></footer>
  </template>
  <template v-else>
   <div v-if="cards.length" class="profile-heading"><h2>{{ tab==='favorites'?'已收藏':'用户歌单' }}</h2><small>{{ cards.length }} 个{{ tab==='favorites'?'歌单 / 专辑':'歌单' }}<template v-if="profileId&&tab==='netease'"> · 用户 ID：{{ profileId }}</template></small></div>
   <p v-if="loading" class="loading-state compact" role="status"><LoaderCircle :size="18" class="spinning" />正在读取链接或用户歌单…</p>
   <div v-if="cards.length" :key="tab" ref="collectionList" class="collection-grid" tabindex="0" :aria-label="tab==='favorites'?'已收藏歌单和专辑':'用户歌单列表'">
    <article v-for="(item,index) in cards" :key="item.kind+':'+item.id" class="music-collection-card" :style="{'--library-index':Math.min(index,7)}"><button class="collection-open" :data-collection-key="item.kind+':'+item.id" :disabled="busy" :aria-label="`打开${item.kind==='album'?'专辑':'歌单'} ${item.name}`" @click="openCollection(item)"><AlbumArt :src="item.coverUrl" :alt="`${item.name}封面`" /><span><strong :title="item.name">{{ item.name }}</strong><small>网易云{{ item.kind==='album'?'专辑':'歌单' }}</small><small>{{ item.trackCount }} 首歌曲</small><span class="collection-open-hint">打开{{ item.kind==='album'?'专辑':'歌单' }}<ArrowRight :size="14" /></span></span></button><button class="icon-button favorite-action" :disabled="!!favoriteBusy||!favoritesReady" :aria-label="`${isSaved(item)?'取消收藏':'收藏'} ${item.name}`" :aria-pressed="isSaved(item)" @click="favorite(item)"><LoaderCircle v-if="favoriteBusy===item.kind+':'+item.id" :size="18" class="spinning" /><Heart v-else :size="18" :fill="isSaved(item)?'currentColor':'none'" /></button></article>
    <button v-if="tab==='netease'&&hasMorePlaylists" class="secondary library-load-more" :disabled="busy||loading" @click="loadMorePlaylists">加载更多用户歌单</button>
   </div>
   <div v-else-if="!loading" :key="tab==='favorites'?'favorites:'+(favoritesLoading?'loading':favoritesReady?'ready':'error'):'netease:'+profileId" class="library-placeholder" :data-state="tab==='favorites'?(favoritesLoading?'loading':favoritesReady?'empty':'error'):'empty'" role="status">
    <span class="placeholder-icon"><LoaderCircle v-if="tab==='favorites'&&favoritesLoading" :size="32" class="spinning" /><Heart v-else-if="tab==='favorites'" :size="36" /><ListMusic v-else :size="36" /></span>
    <h3>{{ tab==='favorites'?(favoritesLoading?'正在读取收藏…':favoritesReady?'还没有收藏':'收藏暂时无法读取'):profileId?'该用户暂无可访问的歌单':'从一条链接，开始听你喜欢的音乐' }}</h3>
    <p>{{ tab==='favorites'?(favoritesLoading?'请稍候，正在读取当前账号的收藏':favoritesReady?'在歌单或专辑上点爱心，喜欢的音乐就会出现在这里。':'请检查网络连接后重试，已有收藏不会被清空。'):'支持网易云个人主页、歌单、专辑和手机分享短链接' }}</p>
    <button v-if="tab==='favorites'&&favoritesReady&&!favoritesLoading" class="primary" @click="switchTab('netease')"><ListMusic :size="17" />浏览网易云歌单</button>
    <button v-if="tab==='favorites'&&!favoritesReady&&!favoritesLoading" class="secondary" @click="readFavorites">重试读取收藏</button>
   </div>
   <details v-if="tab==='netease'" class="library-help library-link-help"><summary><CircleHelp :size="14" />支持哪些链接？</summary><p>个人主页显示可访问的歌单；歌单、专辑链接直接打开详情。支持 163cn.tv 分享短链接，数字 ID 按歌单读取。收藏保存在当前同频账号，不影响网易云账号。</p></details>
  </template>
 </section>
</template>
<style scoped>
.tone-library{width:100%;height:100%;max-width:1440px;display:flex;flex-direction:column;min-height:100%;gap:0}
.tone-library .primary{background:var(--accent);border-color:var(--accent);border-radius:12px;color:white}.tone-library .primary:hover:not(:disabled){background:#52a600;background:color-mix(in srgb,var(--accent) 90%,black)}.tone-library .secondary{border-radius:12px}
.library-topbar{display:flex;flex-direction:column;align-items:flex-start;gap:20px;flex-shrink:0;margin-bottom:20px}.is-detail .library-topbar{flex-direction:row;align-items:center;justify-content:space-between;gap:16px;margin-bottom:12px}
.tone-library .page-heading{display:block;padding:0;margin:0}.tone-library .page-heading h1{font-size:28px;font-weight:600;line-height:1.4;margin:0}.tone-library .page-heading p{font-size:12px;color:var(--muted);margin:8px 0 0;line-height:1.6}
.tone-library .collection-tabs{display:flex;align-items:center;gap:4px;margin:0;padding:4px;background:#ffffff66;border-radius:14px;flex-wrap:nowrap;max-width:100%}.tone-library .collection-tabs button{display:flex;align-items:center;justify-content:center;gap:8px;padding:8px 16px;min-height:38px;border-radius:11px;background:transparent;color:var(--muted);font-size:12px;white-space:nowrap}.tone-library .collection-tabs .selected{background:white;color:var(--accent)}
.tone-library .collection-import{display:flex;align-items:center;gap:14px;flex-shrink:0;margin:0 0 20px;padding:18px 20px;background:#ffffff99;border:1px solid #ffffffcc;border-radius:18px}.import-label{display:flex;flex-direction:row;align-items:center;gap:10px;flex-shrink:0;font-size:12px;white-space:nowrap;margin:0}.import-label svg{color:var(--accent)}.import-input{display:flex;align-items:center;flex:1;min-width:0;background:#ffffffd9;border:1px solid var(--border);border-radius:12px}.tone-library .import-input input{width:100%;min-width:0;flex:1;font-size:12px;background:none;border:0;padding:13px 14px}.import-input kbd{flex-shrink:0;padding-right:16px;color:var(--muted);font-family:inherit;font-size:10px;white-space:nowrap}.tone-library .collection-import .primary{min-width:100px;min-height:44px;width:auto;flex:0 0 auto;padding:10px 16px}.import-input:focus-within{outline:2px solid var(--accent);outline-offset:2px}
.collection-detail-nav{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-shrink:0;margin-bottom:14px}.collection-detail-nav .text-button{font-size:12px;color:var(--accent);padding:6px 0;min-height:36px}.change-reference{font-size:12px;min-height:38px;padding:8px 14px}
.collection-summary{display:flex;align-items:center;gap:20px;padding:16px;background:#ffffff80;border-radius:18px;margin-bottom:14px;flex-shrink:0;min-width:0}.collection-summary-cover{width:80px;height:80px;flex:0 0 80px;border-radius:10px}.collection-summary-info{flex:1;min-width:0}.collection-summary-info h2{font-size:22px;font-weight:600;line-height:1.4;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.collection-summary-info p{font-size:11px;color:var(--muted);line-height:1.5;margin:6px 0 0}.collection-summary-info .collection-description{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.playlist-id{display:inline;font-size:10px;color:var(--muted);margin-left:12px;overflow-wrap:anywhere}.collection-summary .favorite-action{flex-shrink:0;min-height:40px;padding:8px 14px;font-size:12px}.favorite-action[aria-pressed=true]{color:var(--accent)}
.library-selection-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;flex-shrink:0;margin-bottom:12px}.library-selection{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.library-selection label{display:flex;flex-direction:row;align-items:center;gap:8px;font-size:11px;white-space:nowrap;margin:0}.library-selection>span{color:var(--accent);font-size:11px;white-space:nowrap}.library-selection .text-button{font-size:11px;padding:8px 0;color:var(--muted)}.tone-library input[type=checkbox]{width:17px;height:17px;flex:0 0 17px;margin:0;accent-color:var(--accent)}
.add-hint{font-size:11px;line-height:1.6;color:var(--muted);margin:0 0 0 auto;flex:1;min-width:140px;text-align:right}.tone-library .library-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;position:static;margin:0;padding:0;background:transparent;border:0;box-shadow:none}.tone-library .library-actions button{min-height:42px;font-size:12px;padding:10px 14px}.tone-library .library-actions .play-selection{font-size:11px;padding:10px 12px}
.tone-library .track-list{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable}
.tone-library .track-list{display:grid;grid-template-columns:minmax(0,1fr);align-content:start;gap:10px;padding:2px 2px 12px;background:transparent;border:0;border-radius:0;min-height:90px}
.tone-library .track-list .music-search-row{display:grid;grid-template-columns:18px minmax(0,1fr) 42px;align-items:center;gap:12px;padding:12px 16px;min-height:68px;margin:0;background:var(--surface);border:1px solid var(--border);border-radius:16px;cursor:pointer;transition:background var(--motion-fast,140ms),border-color var(--motion-fast,140ms)}.tone-library .track-list .music-search-row:hover{background:#f2f8eb;background:color-mix(in srgb,var(--accent) 6%,white)}.tone-library .track-list .music-search-row[data-selected=true]{background:#eef8e5;border-color:#c4dfa8;background:color-mix(in srgb,var(--accent) 10%,white);border-color:color-mix(in srgb,var(--accent) 35%,var(--border))}.tone-library .track-list .music-search-row:focus-within{outline:2px solid var(--accent);outline-offset:-2px}.tone-library .track-list>.detail-loading,.tone-library .track-list>.library-placeholder,.tone-library .track-list>button{grid-column:1/-1}
.detail-track-main{display:flex;align-items:center;gap:16px;min-width:0}.tone-library .detail-track-main .music-search-cover{width:44px;height:44px;flex:0 0 44px;border:0;border-radius:10px;background:transparent;box-shadow:none;object-fit:cover}.tone-library .music-search-info{min-width:0;flex:1}.tone-library .music-search-info strong{display:block;color:#283448;font-size:13px;font-weight:500;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tone-library .music-search-info small{display:block;margin-top:3px;font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.detail-track-duration{font-size:11px;color:var(--muted);text-align:right;font-variant-numeric:tabular-nums}
.profile-heading{display:flex;align-items:baseline;gap:16px;flex-wrap:wrap;margin:4px 0 16px;flex-shrink:0}.profile-heading h2{font-size:15px;font-weight:500;margin:0}.profile-heading small{font-size:11px;color:var(--muted);overflow-wrap:anywhere}
.collection-grid{flex:1;min-height:0;overflow:auto;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));align-content:start;gap:20px;scrollbar-gutter:stable;overscroll-behavior:contain;padding:2px 2px 12px}
.music-collection-card{min-width:0;position:relative;background:var(--surface);border:1px solid #ffffffd9;border-radius:18px;transition:background var(--motion-fast,140ms),border-color var(--motion-fast,140ms)}.music-collection-card:hover{background:#ffffffcc;border-color:#c4dfa8;border-color:color-mix(in srgb,var(--accent) 30%,var(--border))}.music-collection-card:focus-within{border-color:var(--accent)}.collection-open{display:flex;align-items:center;gap:18px;min-width:0;width:100%;min-height:144px;justify-content:flex-start;text-align:left;background:transparent;padding:18px 16px;border-radius:18px}.collection-open .album-art{width:92px;height:92px;flex:0 0 92px;object-fit:cover}.collection-open>span{flex:1;min-width:0}.collection-open strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500;padding-right:26px}.collection-open small{display:block;color:var(--muted);margin-top:7px;font-size:11px}.collection-open-hint{display:flex;align-items:center;gap:10px;color:var(--accent);font-size:11px;margin-top:16px}.music-collection-card>.favorite-action{position:absolute;right:8px;top:8px;width:36px;height:36px;min-height:36px;min-width:36px;background:transparent}
.library-placeholder{flex:1;min-height:260px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:32px 16px;gap:0;color:var(--muted);border:0;background:none}.placeholder-icon{display:grid;place-items:center;width:84px;height:84px;border-radius:50%;background:#ffffff99;color:var(--accent);margin-bottom:24px}.library-placeholder h3{font-size:20px;font-weight:500;line-height:1.5;color:var(--text,#283448);margin:0 0 12px}.library-placeholder p{font-size:12px;line-height:1.8;margin:0 0 28px;max-width:520px;overflow-wrap:anywhere}.library-placeholder button{min-height:44px;font-size:12px;padding:10px 16px}.library-placeholder.detail-error{min-height:180px}.detail-error>svg{margin-bottom:16px}.detail-loading{display:flex;align-items:center;justify-content:center;gap:10px;padding:24px 12px;font-size:12px}.loading-state.compact{display:flex;align-items:center;gap:10px;font-size:12px}
.library-load-more{margin:8px auto;grid-column:1/-1;justify-self:center;font-size:12px}.library-list-footer{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-top:8px;flex-shrink:0}.library-list-footer>small{font-size:10px;color:var(--muted);white-space:nowrap}.library-help{font-size:11px;color:var(--muted);flex-shrink:0}.library-help summary{display:flex;align-items:center;gap:6px;cursor:pointer;width:fit-content;line-height:1.8;min-height:28px}.library-help p{margin:6px 0 0;line-height:1.8;max-width:540px}.library-link-help{align-self:flex-end;margin-top:12px}.tone-library .library-message{font-size:12px;line-height:1.6;padding:10px 14px;margin:0 0 12px;max-height:80px;overflow:auto;flex-shrink:0;background:#ffffffb3;color:var(--text,#283448);overflow-wrap:anywhere}
/* Local, finite feedback only: no timers or delayed API/state changes. */
.tone-library .collection-tabs{position:relative;isolation:isolate;width:276px}
.tone-library .collection-tabs::before{content:"";position:absolute;left:4px;top:4px;bottom:4px;width:calc((100% - 12px)/2);border-radius:11px;background:white;box-shadow:0 1px 4px #28344808;pointer-events:none;transition:transform var(--motion-normal) var(--motion-ease)}
.tone-library .collection-tabs.favorites-active::before{transform:translateX(calc(100% + 4px))}
.tone-library .collection-tabs button{position:relative;z-index:1;flex:1;min-width:0;padding-inline:10px}
.tone-library .collection-tabs .selected{background:transparent}
.import-input{transition:border-color var(--motion-fast),box-shadow var(--motion-fast)}
.collection-import,.collection-summary,.track-list,.library-placeholder{animation:library-content-in var(--motion-normal) var(--motion-ease)}
.music-collection-card{animation:library-content-in var(--motion-normal) var(--motion-ease) backwards;animation-delay:calc(var(--library-index,0)*18ms);transition:transform var(--motion-normal) var(--motion-ease),background-color var(--motion-fast),border-color var(--motion-fast),box-shadow var(--motion-normal)}
.collection-open .album-art{transition:transform var(--motion-normal) var(--motion-ease)}
.collection-open-hint svg{transition:transform var(--motion-fast) var(--motion-ease)}
.favorite-action .lucide-heart{transition:fill var(--motion-fast),color var(--motion-fast)}
.favorite-action[aria-pressed=true] .lucide-heart{animation:library-heart-pop var(--motion-normal) var(--motion-ease)}
.selection-count{display:inline-block;font-variant-numeric:tabular-nums;animation:library-count-in var(--motion-fast) var(--motion-ease)}
@media(hover:hover) and (pointer:fine){
 .music-collection-card:has(.collection-open:not(:disabled)):hover{transform:translateY(-2px);box-shadow:0 6px 18px #2834480a}
 .collection-open:not(:disabled):hover .album-art{transform:scale(1.025)}
 .collection-open:not(:disabled):hover .collection-open-hint svg{transform:translateX(3px)}
}
@keyframes library-content-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
@keyframes library-heart-pop{0%{transform:scale(.86)}55%{transform:scale(1.16)}100%{transform:scale(1)}}
@keyframes library-count-in{from{opacity:.5;transform:translateY(2px)}to{opacity:1;transform:none}}
@media(max-width:1200px){.collection-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.collection-open .album-art{width:80px;height:80px;flex-basis:80px}.collection-open{min-height:128px}.library-selection-toolbar{gap:10px}.library-selection{margin-right:auto}.import-input kbd{display:none}}
@media(max-height:740px) and (min-width:901px){.library-topbar{gap:12px;margin-bottom:14px}.tone-library .page-heading h1{font-size:24px}.tone-library .collection-import{padding:12px 16px;margin-bottom:14px}.collection-summary{gap:16px;padding:12px;margin-bottom:10px}.collection-summary-cover{width:64px;height:64px;flex-basis:64px}.collection-summary-info h2{font-size:18px}.collection-summary-info .collection-description{display:none}.library-selection-toolbar{margin-bottom:8px}.collection-detail-nav{margin-bottom:8px}}
@media(max-width:760px){.is-detail .library-topbar{align-items:flex-start;flex-wrap:wrap}.tone-library .collection-import{flex-wrap:wrap;padding:14px;gap:10px}.import-label{flex-basis:100%}.tone-library .import-input{flex:1;min-width:120px}.tone-library .import-input input{flex-basis:auto;font-size:14px}.tone-library .collection-import .primary{width:auto;min-width:88px}.collection-grid{gap:12px}.collection-open{gap:12px}.collection-open .album-art{width:64px;height:64px;flex-basis:64px}.collection-summary{gap:14px}.collection-summary-cover{width:64px;height:64px;flex-basis:64px}.collection-summary-info h2{font-size:18px}.library-list-footer{flex-wrap:wrap;gap:4px}.library-help p{max-width:100%}}
@media(max-width:600px){.library-topbar{gap:18px;margin-bottom:18px}.tone-library .page-heading h1{font-size:24px}.tone-library .collection-tabs{width:100%}.tone-library .collection-tabs button{flex:1;min-height:40px;padding:8px 12px}.is-detail .library-topbar{flex-direction:column;gap:16px}.collection-grid{grid-template-columns:minmax(0,1fr)}.collection-open{min-height:132px;padding:16px;gap:16px}.collection-open .album-art{width:88px;height:88px;flex-basis:88px}.music-collection-card>.favorite-action{width:44px;height:44px;min-width:44px;min-height:44px;right:4px;top:4px}.collection-open strong{padding-right:34px}.collection-summary{flex-wrap:wrap;padding:12px;background:#ffffff66}.collection-summary-cover{width:64px;height:64px;flex-basis:64px}.collection-summary-info h2{font-size:16px}.collection-summary .favorite-action{margin-left:auto;min-height:38px}.collection-description{display:none}.library-selection{width:100%;gap:12px}.library-selection .clear-selection{margin-left:auto}.tone-library .library-actions{width:100%;gap:8px}.tone-library .library-actions .primary{flex:1}.add-hint{order:0;flex-basis:100%;font-size:10px;text-align:left;margin:0}.tone-library .track-list .music-search-row{padding:10px 12px;gap:10px;min-height:66px;grid-template-columns:18px minmax(0,1fr) 36px}.detail-track-main{gap:12px}.tone-library .detail-track-main .music-search-cover{width:40px;height:40px;flex-basis:40px}.tone-library .music-search-info strong{font-size:12px}.tone-library .music-search-info small{font-size:10px}.detail-track-duration{font-size:10px}.library-placeholder{min-height:320px;padding:36px 12px}.library-placeholder h3{font-size:19px}.library-placeholder p{font-size:12px}.library-list-footer{align-items:flex-start}.library-help{font-size:10px}}
@media(prefers-reduced-motion:reduce){
 .tone-library *,.tone-library *::before{animation:none!important;transition:none!important}
 .music-collection-card:has(.collection-open:not(:disabled)):hover,.collection-open:not(:disabled):hover .album-art,.collection-open:not(:disabled):hover .collection-open-hint svg{transform:none}
}
</style>
