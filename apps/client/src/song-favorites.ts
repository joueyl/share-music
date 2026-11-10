import { computed,ref,watch } from 'vue';
import { defineStore } from 'pinia';
import { useApp } from './store';
import * as bridge from './bridge';
export const useSongFavorites=defineStore('song-favorites',()=>{
 const app=useApp(),songs=ref<bridge.FavoriteSong[]>([]),ready=ref(false),loading=ref(false),pending=ref(''),error=ref('');
 let generation=0,reading:Promise<void>|undefined;
 watch(()=>app.user?.id,()=>{generation++;songs.value=[];ready.value=false;loading.value=false;pending.value='';error.value='';reading=undefined;},{immediate:true,flush:'sync'});
 const keys=computed(()=>new Set(songs.value.map(song=>song.source+':'+song.id)));
 const has=(source:bridge.FavoriteSong['source'],id:string)=>keys.value.has(source+':'+id);
 function report(e:unknown){const code=e instanceof Error?e.message:String(e);return ({FAVORITE_SONGS_INVALID:'收藏单曲数据异常，请重试',FAVORITE_SONGS_FULL:'最多收藏 5000 首单曲',DATABASE_UNAVAILABLE:'收藏服务暂时不可用，请稍后重试',NETEASE_INVALID_RESPONSE:'无法读取歌曲资料，请稍后重试'} as Record<string,string>)[code]??code;}
 function read(force=false):Promise<void>{
  if(!app.user||pending.value)return Promise.resolve();if(reading)return reading;if(ready.value&&!force)return Promise.resolve();
  const gen=generation;loading.value=true;error.value='';
  const job=(async()=>{try{const result=await bridge.favoriteSongs();if(gen===generation){songs.value=result;ready.value=true;}}catch(e){if(gen===generation){error.value=report(e);ready.value=false;}}finally{if(gen===generation){loading.value=false;reading=undefined;}}})();
  reading=job;return job;
 }
 async function set(source:bridge.FavoriteSong['source'],id:string,saved:boolean){
  if(!app.user||pending.value)return;const gen=generation;
  await read();if(gen!==generation||pending.value)return;if(!ready.value)throw new Error(error.value||'收藏暂时无法读取');
  pending.value=source+':'+id;error.value='';
  try{const result=await bridge.setFavoriteSong(source,id,saved);if(gen===generation){songs.value=result;ready.value=true;}}
  catch(e){if(gen===generation){error.value=report(e);throw new Error(error.value);}}
  finally{if(gen===generation)pending.value='';}
 }
 return {songs,ready,loading,pending,error,has,read,set};
});
