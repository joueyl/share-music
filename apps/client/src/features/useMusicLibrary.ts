import { computed,nextTick,onMounted,onUnmounted,ref,watch } from 'vue';
import { useApp } from '../store';
import * as bridge from '../bridge';
/** Shared domain controller: desktop and APK must use the same request/permission flow. */
export function useMusicLibrary(){
const app=useApp(),link=ref(''),tab=ref<'netease'|'favorites'>('netease'),opened=ref<bridge.MusicCollection|null>(null);
const favoriteTab=ref<'collections'|'songs'>('collections');
const songs=ref<bridge.MusicSearchItem[]>([]),selected=ref(new Set<string>()),busy=ref(false),loading=ref(false),message=ref('');
const requestIds=new Map<string,string>(),songOffset=ref(0),showImport=ref(false);
const detailTarget=ref<Pick<bridge.MusicCollection,'kind'|'id'>|null>(null),detailFailed=ref(false);
const profile=ref<bridge.MusicProfile|null>(null),profileError=ref(false),bindingBusy=ref(false);
const profileId=ref(''),playlists=ref<bridge.MusicCollection[]>([]),profileOffset=ref(0),hasMorePlaylists=ref(false);
const favorites=ref<bridge.MusicCollection[]>([]),favoritesReady=ref(false),favoritesLoading=ref(false),favoriteBusy=ref('');
const collectionList=ref<HTMLElement|null>(null),listScroll={netease:0,favorites:0};
let lastCollection='';
let alive=true,generation=0,favoriteGeneration=0;
onUnmounted(()=>{alive=false;generation++;favoriteGeneration++;});
const available=computed(()=>!!app.room&&app.connected&&app.permission.enqueue&&!app.room.pending&&!app.pendingActions&&!app.busy&&!busy.value&&!loading.value&&!detailFailed.value);
const addHint=computed(()=>!app.room?'可先浏览和收藏；加入房间后即可添加歌曲':!app.connected?'连接已断开，重连后可添加歌曲':!app.permission.enqueue?'当前没有播放列表控制权限':app.room.pending||app.pendingActions||app.busy?'房间正在处理操作，请稍候':detailFailed.value?'歌单未完整读取，请重新加载详情':busy.value?'正在加入房间，请稍候':'加入待播列表，不会打断当前播放');
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
function report(e:unknown){const code=e instanceof Error?e.message:String(e);return ({QQ_PUBLIC_PROFILE_UNSUPPORTED:'当前 QQ 音乐接口不支持读取任意个人主页，暂不能绑定；请使用网易云主页',MUSIC_PROFILE_LINK_REQUIRED:'绑定需要个人主页链接，不能使用歌单或专辑链接',MUSIC_PROFILE_UNAVAILABLE:'无法读取用户资料，请检查主页是否公开后重试',MUSIC_PROFILE_INVALID:'绑定资料读取异常，请重试',MUSIC_LINK_ENDPOINT_UNAVAILABLE:'链接解析接口不存在，请更新服务端',MUSIC_LINK_INVALID:'请输入网易云个人主页、歌单或专辑链接',MUSIC_LINK_RESOLVE_FAILED:'短链接解析失败，请重试或使用完整链接',MUSIC_LINK_REDIRECT_LIMIT:'短链接重定向过多，请使用完整链接',MUSIC_FAVORITES_FULL:'最多收藏 200 个歌单或专辑',NETEASE_LOGIN_REQUIRED:'网易云登录态已失效，请管理员重新登录'} as Record<string,string>)[code]??code;}
function resetSongs(){detailTarget.value=null;detailFailed.value=false;opened.value=null;songs.value=[];selected.value=new Set();songOffset.value=0;}
function switchTab(value:'netease'|'favorites'){
 if(busy.value||bindingBusy.value||value===tab.value)return;rememberList();generation++;loading.value=false;tab.value=value;resetSongs();message.value='';void restoreList(generation);
 if(value==='favorites'&&!favoritesReady.value&&!favoritesLoading.value)void readFavorites();
 if(value==='netease'&&!profile.value)void restoreProfile();
}
async function readFavorites(){
 if(tab.value==='favorites')message.value='';
 const gen=++favoriteGeneration,user=app.user?.id;favoritesReady.value=false;favoritesLoading.value=true;
 try{const result=await bridge.musicFavorites();if(alive&&gen===favoriteGeneration&&user===app.user?.id){favorites.value=result;favoritesReady.value=true;}}
 catch(e){if(alive&&gen===favoriteGeneration)message.value='收藏读取失败：'+report(e);}
 finally{if(alive&&gen===favoriteGeneration)favoritesLoading.value=false;}
}
async function restoreProfile(){
 const gen=++generation;loading.value=true;profileError.value=false;message.value='';
 try{const result=await bridge.musicProfile();if(!alive||gen!==generation)return;
  profile.value=result;profileId.value=result?.id??'';playlists.value=[];profileOffset.value=0;hasMorePlaylists.value=false;
  if(result)await readProfile(gen);
 }catch(e){if(alive&&gen===generation){profileError.value=true;message.value='音乐主页读取失败：'+report(e);}}
 finally{if(alive&&gen===generation)loading.value=false;}
}
async function unbindProfile(){
 if(bindingBusy.value||busy.value)return;const owner=app.user?.id,gen=++generation;bindingBusy.value=true;loading.value=true;message.value='';
 try{await bridge.bindMusicProfile(null);if(!alive||gen!==generation)return;
  profile.value=null;profileId.value='';playlists.value=[];profileOffset.value=0;hasMorePlaylists.value=false;profileError.value=false;link.value='';
 }catch(e){if(alive&&gen===generation)message.value=report(e);}
 finally{if(alive&&owner===app.user?.id){bindingBusy.value=false;if(gen===generation)loading.value=false;}}
}
onMounted(()=>{void readFavorites();void restoreProfile();});
watch(()=>app.user?.id,()=>{generation++;loading.value=false;resetSongs();profile.value=null;profileError.value=false;bindingBusy.value=false;profileId.value='';profileOffset.value=0;hasMorePlaylists.value=false;playlists.value=[];favorites.value=[];favoriteBusy.value='';link.value='';message.value='';busy.value=false;listScroll.netease=0;listScroll.favorites=0;lastCollection='';requestIds.clear();void readFavorites();void restoreProfile();});
const isSaved=(item:bridge.MusicCollection)=>favorites.value.some(saved=>saved.kind===item.kind&&saved.id===item.id);
async function favorite(item:bridge.MusicCollection){
 if(favoriteBusy.value||!favoritesReady.value)return;const user=app.user?.id,gen=favoriteGeneration;favoriteBusy.value=item.kind+':'+item.id;
 try{const result=await bridge.setMusicFavorite(item.kind,item.id,!isSaved(item));if(alive&&user===app.user?.id&&gen===favoriteGeneration)favorites.value=result;}
 catch(e){if(alive&&user===app.user?.id&&gen===favoriteGeneration)message.value=report(e);}
 finally{if(alive&&user===app.user?.id&&gen===favoriteGeneration)favoriteBusy.value='';}
}
async function readSongs(collection:bridge.MusicCollection,gen:number){
 // Upstream stays paged; the UI automatically reads every accessible song without manual pagination.
 if(collection.trackCount>100000)throw new Error('歌单超过当前可读取的 100000 首上限');
 for(let pageIndex=0;pageIndex<2001;pageIndex++){
  const page=await bridge.playlistSongs(collection.id,songOffset.value);if(!alive||gen!==generation)return;
  const known=new Set(songs.value.map(song=>song.id));
  const fresh=page.filter(song=>{if(known.has(song.id))return false;known.add(song.id);return true;});
  if(page.length&&!fresh.length)throw new Error('歌曲读取未返回新内容，请重新加载详情');
  songs.value=[...songs.value,...fresh];songOffset.value+=page.length;
  selected.value=new Set([...selected.value,...fresh.map(song=>song.id)]);
  if(songOffset.value>=collection.trackCount||page.length<50){
   if(songOffset.value<collection.trackCount)message.value=`已读取 ${songs.value.length} 首，部分歌曲当前不可访问`;
   return;
  }
 }
 throw new Error('歌曲读取超出安全范围，请重新加载详情');
}
async function openCollection(item:Pick<bridge.MusicCollection,'kind'|'id'>){
 if(busy.value||bindingBusy.value)return;rememberList();lastCollection=item.kind+':'+item.id;const gen=++generation;loading.value=true;message.value='';resetSongs();detailTarget.value={kind:item.kind,id:item.id};showImport.value=false;
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
 if(busy.value||bindingBusy.value)return;const owner=app.user?.id,gen=++generation;loading.value=true;message.value='';profileError.value=false;tab.value='netease';resetSongs();
 try{
  // QQ URLs are checked server-side too; do not route them through the NetEase resolver.
  const qqLink=/https?:\/\/(?:y|i\.y|c\.y)\.qq\.com(?:[\/:?#]|$)/i.test(link.value);
  const parsed=qqLink?{kind:'user' as const,id:''}:await bridge.resolveMusicLink(link.value);if(!alive||gen!==generation)return;
  if(parsed.kind!=='user'){await openCollection({kind:parsed.kind,id:parsed.id});return;}
  bindingBusy.value=true;
  const result=await bridge.bindMusicProfile(link.value);if(!alive||gen!==generation)return;
  if(!result)throw new Error('MUSIC_PROFILE_INVALID');
  bindingBusy.value=false;profile.value=result;profileId.value=result.id;playlists.value=[];profileOffset.value=0;hasMorePlaylists.value=false;listScroll.netease=0;showImport.value=false;
  try{await readProfile(gen);}catch(e){if(alive&&gen===generation)profileError.value=true;throw e;}
 }catch(e){if(alive&&gen===generation)message.value=report(e);}
 finally{if(alive&&owner===app.user?.id){bindingBusy.value=false;if(gen===generation)loading.value=false;}}
}
async function loadMorePlaylists(){if(loading.value||busy.value||!hasMorePlaylists.value)return;const gen=++generation;loading.value=true;try{await readProfile(gen);}catch(e){if(alive&&gen===generation)message.value=report(e);}finally{if(alive&&gen===generation)loading.value=false;}}
function back(){if(busy.value)return;generation++;loading.value=false;resetSongs();message.value='';void restoreList(generation,true);}
async function add(play=false){
 if(!available.value||!app.room||!selected.value.size||(play&&!app.permission.skip))return;
 const ownerId=app.user?.id,roomId=app.room.id,items=songs.value.filter(s=>selected.value.has(s.id));
 if(items.length>200-app.room.playlist.length){message.value=`房间最多 200 首，还可加入 ${200-app.room.playlist.length} 首，请减少勾选`;return;}
 busy.value=true;let success=0,fail=0,first=true;const errors:string[]=[];
 try{
  for(let offset=0;offset<items.length;offset+=50){
   if(!alive||app.user?.id!==ownerId||app.room?.id!==roomId||!app.connected||!app.permission.enqueue)break;
   const chunk=items.slice(offset,offset+50),requests=chunk.map(song=>{
    const key=roomId+':'+song.id,id=requestIds.get(key)??crypto.randomUUID();requestIds.set(key,id);
    return {songId:song.id,requestId:id,coverUrl:song.coverUrl};
   });
   message.value=`正在处理 ${offset+1}–${offset+chunk.length}/${items.length} 首`;
   try{
    const results=await bridge.addSearchedMusicBatch(roomId,requests);
    if(!alive||app.user?.id!==ownerId||app.room?.id!==roomId)break;
    for(let i=0;i<results.length;i++){
     if(!alive||app.user?.id!==ownerId||app.room?.id!==roomId)break;
     const result=results[i],song=chunk[i];
     if(result.ok){
      success++;requestIds.delete(roomId+':'+song.id);selected.value=new Set([...selected.value].filter(id=>id!==song.id));
      if(play&&first&&alive&&app.room?.id===roomId){first=false;try{await bridge.playMusic(roomId,result.track.id,crypto.randomUUID());}catch(e){errors.push(`已加入，但立即播放失败：${report(e)}`);}}
     }else{fail++;errors.push(`${song.name}：${report(result.error)}`);}
    }
   }catch(e){if(!alive||app.user?.id!==ownerId||app.room?.id!==roomId)break;fail+=chunk.length;errors.push(report(e));}
  }
  if(alive&&app.user?.id===ownerId&&app.room?.id===roomId)message.value=`已加入 ${success} 首，失败 ${fail} 首${success+fail<items.length?'，其余已停止':''}。${errors.slice(0,3).join('；')}`;
 }finally{if(alive&&app.user?.id===ownerId)busy.value=false;}
}

return { app,link,tab,opened,favoriteTab,songs,selected,busy,loading,message,showImport,detailTarget,detailFailed,profile,profileError,bindingBusy,profileId,favoritesReady,favoritesLoading,favoriteBusy,collectionList,available,addHint,allSelected,cards,hasMorePlaylists,loadMorePlaylists,durationLabel,toggle,toggleAll,switchTab,readFavorites,restoreProfile,unbindProfile,isSaved,favorite,openCollection,load,back,add };
}
