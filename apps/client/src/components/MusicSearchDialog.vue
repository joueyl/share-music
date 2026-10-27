<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { Search, X, Plus, Check, LoaderCircle, Disc3 } from 'lucide-vue-next';
import { useMusicSuggestions } from '../useMusicSuggestions';
import { useApp } from '../store';
import * as bridge from '../bridge';
const props=defineProps<{roomId:string}>(), emit=defineEmits<{close:[]}>(), app=useApp();
const keywords=ref(''),songs=ref<bridge.MusicSearchItem[]>([]),total=ref(0),offset=ref(0),query=ref('');
const searching=ref(false),searched=ref(false),adding=ref<string|null>(null),added=ref(new Set<string>()),message=ref('');
const focused=ref(false),composing=ref(false),suggestionsSuppressed=ref(false);
const failedCovers=ref(new Set<string>());
watch(keywords,()=>{suggestionsSuppressed.value=false;},{flush:'sync'});
const suggestEnabled=computed(()=>focused.value&&!suggestionsSuppressed.value&&!composing.value&&!adding.value&&!searching.value);
const suggestions=useMusicSuggestions(keywords,suggestEnabled);
const suggestionItems=suggestions.items,suggestionLoading=suggestions.loading,suggestionActive=suggestions.active,suggestionError=suggestions.error;
const suggestionOpen=computed(()=>suggestEnabled.value&&(suggestionItems.value.length>0||suggestionLoading.value||!!suggestionError.value||suggestions.loaded.value));
function keywordInput(event:Event){
 const value=(event.target as HTMLInputElement).value;focused.value=true;
 if((event as InputEvent).isComposing||composing.value)return;
 suggestionsSuppressed.value=false;keywords.value=value;
}
function compositionEnd(event:CompositionEvent){composing.value=false;focused.value=true;suggestionsSuppressed.value=false;keywords.value=(event.target as HTMLInputElement).value;}
function chooseSuggestion(term:string){keywords.value=term;suggestions.dismiss();void search(0);}
function suggestionKeys(event:KeyboardEvent){
 if(event.isComposing||composing.value)return;
 if(event.key==='Escape'&&suggestionOpen.value){event.preventDefault();event.stopPropagation();suggestions.dismiss();return;}
 if(!suggestionOpen.value||!suggestionItems.value.length)return;
 if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const n=suggestionItems.value.length;suggestionActive.value=(suggestionActive.value+(event.key==='ArrowDown'?1:suggestionActive.value===-1?0:-1)+n)%n;}
 if(event.key==='Enter'&&suggestionActive.value>=0){event.preventDefault();chooseSuggestion(suggestionItems.value[suggestionActive.value]!);}
}
const dialog=ref<HTMLElement|null>(null),input=ref<HTMLInputElement|null>(null);
let generation=0,alive=true,previous:HTMLElement|null=null,background:HTMLElement|null=null,wasInert=false,overflow='';
const requestIds=new Map<string,string>();
const visible=ref(true);
function close(){if(!adding.value)visible.value=false;}
function trap(event:KeyboardEvent){
 if(event.isComposing||composing.value)return;
 if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
 if(event.key!=='Tab')return;
 const all=dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)');if(!all?.length)return;
 const first=all[0],last=all[all.length-1];
 if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
 else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
}
onMounted(async()=>{previous=document.activeElement as HTMLElement;background=document.querySelector<HTMLElement>('.shell');if(background){wasInert=background.inert;background.inert=true;}overflow=document.body.style.overflow;document.body.style.overflow='hidden';await nextTick();input.value?.focus();document.addEventListener('keydown',trap);});
onUnmounted(()=>{alive=false;generation++;document.removeEventListener('keydown',trap);if(background)background.inert=wasInert;document.body.style.overflow=overflow;previous?.focus();});
async function search(page=0){
 const term=page===0?keywords.value.trim():query.value;if(!term||adding.value||composing.value)return;
 suggestionsSuppressed.value=true;suggestions.dismiss();
 const current=++generation;searching.value=true;message.value='';query.value=term;
 try{const result=await bridge.searchMusic(term,page);if(!alive||current!==generation)return;songs.value=result.songs;total.value=result.total;offset.value=page;searched.value=true;}
 catch(e){if(alive&&current===generation){songs.value=[];app.error(e);message.value=app.notice;}}
 finally{if(alive&&current===generation)searching.value=false;}
}
async function add(song:bridge.MusicSearchItem){
 if(adding.value||!app.permission.enqueue||!app.connected)return;
 adding.value=song.id;app.notice='';message.value='服务端正在获取音源并上传 OSS，请稍候…';
 try{const requestId=requestIds.get(song.id)??crypto.randomUUID();requestIds.set(song.id,requestId);await bridge.addSearchedMusic(props.roomId,song.id,requestId,song.coverUrl);if(!alive)return;added.value=new Set([...added.value,song.id]);message.value='添加成功，音乐已上传 OSS 并加入播放列表';app.notice=`添加成功：${song.name}`;}
 catch(e){if(alive){app.error(e);message.value=app.notice;}}
 finally{if(alive)adding.value=null;}
}
const format=(ms:number)=>`${Math.floor(ms/60000)}:${Math.floor(ms/1000%60).toString().padStart(2,'0')}`;
</script>
<template>
 <Teleport to="body"><Transition name="modal" appear @after-leave="emit('close')"><div v-if="visible" class="modal-backdrop" @click.self="close">
 <section ref="dialog" class="modal music-search-modal" role="dialog" aria-modal="true" aria-labelledby="music-search-title" :aria-busy="searching||!!adding">
  <div class="music-search-header"><div><h2 id="music-search-title">添加音乐</h2><p class="muted">搜索网易云音乐，添加后由服务端上传到 OSS</p></div><button class="icon-button" aria-label="关闭添加音乐" :disabled="!!adding" @click="close"><X :size="20" /></button></div>
  <form class="music-search-form" @submit.prevent="search(0)"><label class="sr-only" for="music-keywords">歌曲、歌手或专辑</label><div class="music-autocomplete"><input id="music-keywords" ref="input" :value="keywords" @input="keywordInput" placeholder="搜索歌曲、歌手或专辑" maxlength="100" :disabled="!!adding" role="combobox" aria-autocomplete="list" aria-controls="music-suggestions" :aria-expanded="suggestionOpen" :aria-activedescendant="suggestionOpen&&suggestionActive>=0?`music-suggestion-${suggestionActive}`:undefined" autocomplete="off" @focus="focused=true" @blur="focused=false" @compositionstart="composing=true" @compositionend="compositionEnd" @keydown="suggestionKeys" />
  <div v-if="suggestionOpen" class="music-suggestions"><div v-if="suggestionLoading&&!suggestionItems.length" class="music-suggestion-loading loading-state" role="status">正在联想…</div><div v-if="suggestionError" class="music-suggestion-loading" role="status">{{ suggestionError }}</div><div v-else-if="!suggestionLoading&&!suggestionItems.length" class="music-suggestion-loading">暂无联想，按回车搜索</div><ul id="music-suggestions" role="listbox" aria-label="搜索联想"><li v-for="(term,index) in suggestionItems" :id="`music-suggestion-${index}`" :key="term" role="option" :aria-selected="suggestionActive===index" :class="{active:suggestionActive===index}" @mouseenter="suggestionActive=index" @mousedown.prevent @click="chooseSuggestion(term)"><Search :size="14" /><span>{{ term }}</span></li></ul></div></div><button class="primary" :aria-busy="searching" :disabled="searching||!!adding||!keywords.trim()"><LoaderCircle v-if="searching" class="spinning" :size="16" /><Search v-else :size="16" />搜索</button></form>
  <p v-if="message" class="music-search-message" role="status" aria-live="polite">{{ message }}</p>
  <div class="music-search-results">
   <p v-if="searching" class="empty-state loading-state" role="status">正在搜索…</p>
   <p v-else-if="!searched" class="empty-state">输入关键词，找到想一起听的音乐</p>
   <p v-else-if="!songs.length" class="empty-state">没有找到相关音乐，换个关键词试试</p>
   <div v-for="song in searching?[]:songs" :key="song.id" class="music-search-row"><div class="music-search-cover"><img v-if="song.coverUrl&&!failedCovers.has(song.coverUrl)" :key="song.coverUrl" :src="song.coverUrl" :alt="`${song.album || song.name}专辑封面`" width="48" height="48" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="failedCovers.add(song.coverUrl)" /><Disc3 v-else :size="24" aria-hidden="true" /></div><div class="music-search-info"><strong>{{ song.name }}</strong><small>{{ song.artists || '未知歌手' }} · {{ song.album || '未知专辑' }}</small></div><span class="track-duration">{{ format(song.durationMs) }}</span><button class="secondary" :aria-busy="adding===song.id" :disabled="!!adding||added.has(song.id)||!app.permission.enqueue||!app.connected" :aria-label="`添加 ${song.name}`" @click="add(song)"><LoaderCircle v-if="adding===song.id" class="spinning" :size="15" /><Check v-else-if="added.has(song.id)" :size="15" /><Plus v-else :size="15" />{{ added.has(song.id)?'已添加':adding===song.id?'上传中…':'添加' }}</button></div>
  </div>
  <div v-if="searched&&total>20" class="music-search-pagination"><button class="text-button" :disabled="offset===0||searching||!!adding" @click="search(offset-20)">上一页</button><span>{{ Math.floor(offset/20)+1 }} / {{ Math.ceil(total/20) }}</span><button class="text-button" :disabled="offset+20>=total||searching||!!adding" @click="search(offset+20)">下一页</button></div>
  <p class="muted small">仅添加当前账号可获取的完整音源，请确保拥有上传与共享权限。添加期间请勿关闭弹窗。</p>
 </section></div></Transition></Teleport>
</template>
