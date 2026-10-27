<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { Check, Plus, Disc3, LoaderCircle, RefreshCw, Search, X } from 'lucide-vue-next';
import { useApp } from '../store';
import * as bridge from '../bridge';
const props=defineProps<{roomId:string}>(),emit=defineEmits<{close:[]}>(),app=useApp();
const adding=ref<string|null>(null),message=ref(''),requestIds=new Map<string,string>();
const completed=ref(new Set<string>());
const added=computed(()=>new Set([...completed.value,...(app.room?.id===props.roomId?app.room.playlist.map(t=>t.contentHash):[])]));
const visible=ref(true);
function close(){if(!adding.value)visible.value=false;}
async function add(song:bridge.UploadedMusicItem){
 if(adding.value||added.value.has(song.id)||song.canAdd===false||!app.connected||!app.permission.enqueue||app.room?.id!==props.roomId)return;
 adding.value=song.id;message.value='正在加入播放列表…';
 try{
  const requestId=requestIds.get(song.id)??crypto.randomUUID();requestIds.set(song.id,requestId);
  await bridge.addUploadedMusic(props.roomId,song.id,requestId);
  requestIds.delete(song.id);
  if(alive){completed.value.add(song.id);message.value=`已加入播放列表：${song.name}`;app.notice=message.value;}
 }catch(e){if(alive){app.error(e);message.value=app.notice;}}
 finally{if(alive)adding.value=null;}
}
const keywords=ref(''),query=ref(''),songs=ref<bridge.UploadedMusicItem[]>([]),total=ref(0),offset=ref(0),loading=ref(false),error=ref('');
const dialog=ref<HTMLElement|null>(null),input=ref<HTMLInputElement|null>(null),failedCovers=ref(new Set<string>());
let request:AbortController|undefined,alive=true,previous:HTMLElement|null=null,background:HTMLElement|null=null,wasInert=false,overflow='';
async function load(page=0,term=query.value){
 if(adding.value)return;
 request?.abort();const current=new AbortController();request=current;
 loading.value=true;error.value='';
 try{
  const data=await bridge.uploadedMusic(term,page,current.signal);
  if(!alive||current.signal.aborted)return;
  songs.value=data.songs;total.value=data.total;offset.value=page;query.value=term;
 }catch(e){if(alive&&!current.signal.aborted){app.error(e);error.value=app.notice;songs.value=[];}}
 finally{if(alive&&request===current)loading.value=false;}
}
function trap(event:KeyboardEvent){
 if(event.isComposing)return;
 if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
 if(event.key!=='Tab')return;
 const all=dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)');if(!all?.length)return;
 const first=all[0],last=all[all.length-1];
 if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
 else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
}
onMounted(async()=>{
 previous=document.activeElement as HTMLElement;background=document.querySelector<HTMLElement>('.shell');
 if(background){wasInert=background.inert;background.inert=true;}
 overflow=document.body.style.overflow;document.body.style.overflow='hidden';document.addEventListener('keydown',trap);
 void load();await nextTick();if(alive)input.value?.focus();
});
onUnmounted(()=>{alive=false;request?.abort();document.removeEventListener('keydown',trap);if(background)background.inert=wasInert;document.body.style.overflow=overflow;previous?.focus();});
const duration=(ms:number|null)=>ms===null?'时长未知':`${Math.floor(ms/60000)}:${Math.floor(ms/1000%60).toString().padStart(2,'0')}`;
</script>
<template>
 <Teleport to="body"><Transition name="modal" appear @after-leave="emit('close')"><div v-if="visible" class="modal-backdrop" @click.self="close">
  <section ref="dialog" class="modal music-search-modal uploaded-music-modal" role="dialog" aria-modal="true" aria-labelledby="uploaded-music-title" :aria-busy="loading||!!adding">
   <div class="music-search-header"><div><h2 id="uploaded-music-title">已上传音乐</h2><p class="muted">当前 OSS 存储的服务端上传记录 · 共 {{ total }} 首</p></div><button class="icon-button" aria-label="关闭已上传音乐" :disabled="!!adding" @click="close"><X :size="20" /></button></div>
   <form class="music-search-form" @submit.prevent="load(0,keywords.trim())"><label class="sr-only" for="uploaded-keywords">搜索已上传音乐</label><input id="uploaded-keywords" ref="input" v-model="keywords" placeholder="搜索歌曲、歌手、专辑或文件名" maxlength="100" /><button class="primary" :aria-busy="loading" :disabled="loading||!!adding"><Search :size="16" />搜索</button><button type="button" class="secondary" :disabled="loading||!!adding" aria-label="刷新已上传音乐" @click="load(offset)"><RefreshCw :size="16" />刷新</button></form>
   <p v-if="error" class="music-search-message" role="alert">{{ error }} <button class="text-button" @click="load(offset)">重试</button></p>
   <p v-if="message" class="music-search-message" role="status">{{ message }}</p>
   <div class="music-search-results" aria-live="polite">
    <p v-if="loading" class="empty-state loading-state" role="status"><LoaderCircle class="spinning" :size="18" /> 正在加载已上传音乐…</p>
    <p v-else-if="!error&&!songs.length" class="empty-state">{{ query?'没有找到匹配的已上传音乐':'暂无已上传音乐，添加音乐并上传成功后会显示在这里' }}</p>
    <template v-else-if="!error"><div v-for="song in songs" :key="song.id" class="music-search-row"><div class="music-search-cover"><img v-if="song.coverUrl&&!failedCovers.has(song.coverUrl)" :src="song.coverUrl" :alt="`${song.name}封面`" loading="lazy" referrerpolicy="no-referrer" @error="failedCovers.add(song.coverUrl)" /><Disc3 v-else :size="24" /></div><div class="music-search-info"><strong>{{ song.name }}</strong><small>{{ song.artists||'未知歌手' }} · {{ song.album||'未知专辑' }}<template v-if="song.sizeBytes!==null"> · {{ (song.sizeBytes/1024/1024).toFixed(1) }} MB</template></small></div><span class="track-duration">{{ duration(song.durationMs) }}</span><button class="secondary" :aria-busy="adding===song.id" :disabled="!!adding||added.has(song.id)||song.canAdd===false||!app.connected||!app.permission.enqueue" :title="song.canAdd===false?'历史文件缺少音频参数，请重新添加原歌曲':undefined" :aria-label="`添加 ${song.name} 到播放列表`" @click="add(song)"><LoaderCircle v-if="adding===song.id" class="spinning" :size="15" /><Check v-else-if="added.has(song.id)" :size="15" /><Plus v-else :size="15" />{{ added.has(song.id)?'已在列表':adding===song.id?'添加中…':song.canAdd===false?'信息不全':'添加到播放列表' }}</button></div></template>
   </div>
   <div v-if="total>20&&!error" class="music-search-pagination"><button class="text-button" :disabled="offset===0||loading||!!adding" @click="load(offset-20)">上一页</button><span>{{ Math.floor(offset/20)+1 }} / {{ Math.ceil(total/20) }}</span><button class="text-button" :disabled="offset+20>=total||loading||!!adding" @click="load(offset+20)">下一页</button></div>
   <p class="muted small">按文件内容去重，包含已移出播放列表的上传记录；不包含绕过本应用直接上传至 OSS 的文件。列表不实时校验 OSS 文件是否被外部删除。</p>
  </section>
 </div></Transition></Teleport>
</template>
