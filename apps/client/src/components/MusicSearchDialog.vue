<script setup lang="ts">
import { lockModalBackground } from '../useDialogFocus';
let unlockBackground = () => {};
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { Search, X, Plus, Check, LoaderCircle, Disc3, Clock3, Headphones, Play, Users } from 'lucide-vue-next';
import { useMusicSuggestions } from '../useMusicSuggestions';
import { useApp } from '../store';
import * as bridge from '../bridge';
import AlbumArt from './AlbumArt.vue';
const props=defineProps<{roomId?:string}>(), emit=defineEmits<{close:[];rooms:[term:string]}>(), app=useApp();
const keywords=ref(''),songs=ref<bridge.MusicSearchItem[]>([]),total=ref(0),offset=ref(0),query=ref('');
const searching=ref(false),searched=ref(false),adding=ref<string|null>(null),added=ref(new Set<string>()),message=ref('');
const history=ref<string[]>([]),allBusy=ref(false);
const historyKey=`tone.search-history:${app.user?.id??'guest'}`;
try{const saved=JSON.parse(localStorage.getItem(historyKey)??'[]');if(Array.isArray(saved))history.value=saved.filter((v:unknown):v is string=>typeof v==='string'&&v.length<=100).slice(0,8);}catch{}
function saveHistory(term?:string){history.value=term?[term,...history.value.filter(t=>t!==term)].slice(0,8):[];try{localStorage.setItem(historyKey,JSON.stringify(history.value));}catch{}}
async function addAll(){if(!props.roomId||!app.permission.enqueue||!app.connected||allBusy.value||adding.value)return;if(songs.value.filter(s=>!added.value.has(s.id)).length>200-(app.room?.playlist.length??0)){message.value='房间队列容量不足，请逐首添加';return;}allBusy.value=true;try{for(const song of songs.value){if(!alive||app.room?.id!==props.roomId||!app.connected)break;if(!added.value.has(song.id))await add(song);}}finally{allBusy.value=false;}}
function roomSearch(){if(!keywords.value.trim())return;emit('rooms',keywords.value.trim());visible.value=false;}
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
let generation=0,alive=true,previous:HTMLElement|null=null;
const requestIds=new Map<string,string>();
const visible=ref(true);
function close(){if(!adding.value&&!allBusy.value)visible.value=false;}
function trap(event:KeyboardEvent){
 if(event.isComposing||composing.value)return;
 if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
 if(event.key!=='Tab')return;
 const all=dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)');if(!all?.length)return;
 const first=all[0],last=all[all.length-1];
 if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
 else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
}
onMounted(async()=>{previous=document.activeElement as HTMLElement;unlockBackground=lockModalBackground();await nextTick();input.value?.focus();document.addEventListener('keydown',trap);});
onUnmounted(()=>{alive=false;generation++;document.removeEventListener('keydown',trap);unlockBackground();previous?.focus();});
async function search(page=0){
 const term=page===0?keywords.value.trim():query.value;if(!term||adding.value||allBusy.value||composing.value)return;
 suggestionsSuppressed.value=true;suggestions.dismiss();
 const current=++generation;searching.value=true;message.value='';query.value=term;
 try{const result=await bridge.searchMusic(term,page);if(!alive||current!==generation)return;songs.value=result.songs;total.value=result.total;offset.value=page;searched.value=true;saveHistory(term);}
 catch(e){if(alive&&current===generation){songs.value=[];app.error(e);message.value=app.notice;}}
 finally{if(alive&&current===generation)searching.value=false;}
}
async function add(song:bridge.MusicSearchItem){
 if(!props.roomId||app.room?.id!==props.roomId||adding.value||!app.permission.enqueue||!app.connected)return;
 adding.value=song.id;app.notice='';message.value='服务端正在获取并保存音乐链接，请稍候…';
 try{const requestId=requestIds.get(song.id)??crypto.randomUUID();requestIds.set(song.id,requestId);await bridge.addSearchedMusic(props.roomId,song.id,requestId,song.coverUrl);if(!alive)return;added.value=new Set([...added.value,song.id]);message.value='添加成功，音乐链接已保存并加入播放列表';app.notice=`添加成功：${song.name}`;}
 catch(e){if(alive){app.error(e);message.value=app.notice;}}
 finally{if(alive)adding.value=null;}
}
const format=(ms:number)=>`${Math.floor(ms/60000)}:${Math.floor(ms/1000%60).toString().padStart(2,'0')}`;
</script>
<template>
 <Teleport to="body"><Transition name="modal" appear @after-leave="emit('close')"><div v-if="visible" class="modal-backdrop search-backdrop">
 <section ref="dialog" class="modal music-search-modal global-search-modal" role="dialog" aria-modal="true" aria-labelledby="music-search-title" :aria-busy="searching||!!adding||allBusy">
  <header class="global-search-header"><span class="search-symbol"><Search :size="22" /></span><h2 id="music-search-title">搜索音乐</h2><p>发现好音乐，随时添加到共享房间</p><kbd>Esc</kbd><button class="round-close" aria-label="关闭搜索音乐" :disabled="!!adding||allBusy" @click="close"><X :size="22" /></button></header>
  <div class="global-search-body"><div class="search-main"><span class="eyebrow">SEARCH MUSIC / 找一首此刻想听的歌</span><h1>好音乐，值得一起发现</h1>
  <form class="music-search-form global-search-form" @submit.prevent="search(0)"><Search :size="20" /><label class="sr-only" for="music-keywords">歌曲、歌手或专辑</label><div class="music-autocomplete"><input id="music-keywords" ref="input" :value="keywords" @input="keywordInput" placeholder="搜索歌曲、歌手或专辑" maxlength="100" :disabled="!!adding||allBusy" role="combobox" aria-autocomplete="list" aria-controls="music-suggestions" :aria-expanded="suggestionOpen" :aria-activedescendant="suggestionOpen&&suggestionActive>=0?`music-suggestion-${suggestionActive}`:undefined" autocomplete="off" @focus="focused=true" @blur="focused=false" @compositionstart="composing=true" @compositionend="compositionEnd" @keydown="suggestionKeys" />
   <div v-if="suggestionOpen" class="music-suggestions"><div v-if="suggestionLoading&&!suggestionItems.length" class="music-suggestion-loading loading-state" role="status">正在联想…</div><div v-if="suggestionError" class="music-suggestion-loading" role="status">{{ suggestionError }}</div><div v-else-if="!suggestionLoading&&!suggestionItems.length" class="music-suggestion-loading">暂无联想，按回车搜索</div><ul id="music-suggestions" role="listbox" aria-label="搜索联想"><li v-for="(term,index) in suggestionItems" :id="`music-suggestion-${index}`" :key="term" role="option" :aria-selected="suggestionActive===index" :class="{active:suggestionActive===index}" @mouseenter="suggestionActive=index" @mousedown.prevent @click="chooseSuggestion(term)"><Search :size="14" /><span>{{ term }}</span></li></ul></div></div><button v-if="keywords" type="button" class="icon-button" aria-label="清空关键词" :disabled="!!adding||allBusy" @click="keywords='' "><X :size="16" /></button><button class="primary" :aria-busy="searching" :disabled="searching||!!adding||allBusy||!keywords.trim()"><LoaderCircle v-if="searching" class="spinning" :size="16" />搜索</button></form>
   <div class="search-history"><Clock3 :size="16" /><span>最近搜索</span><button v-for="term in history.slice(0,4)" :key="term" :disabled="!!adding||allBusy" @click="chooseSuggestion(term)">{{ term }}</button><small v-if="!history.length">还没有搜索记录</small><button v-else class="history-clear" :disabled="!!adding||allBusy" @click="saveHistory()">清空</button></div>
   <div class="search-kind-tabs"><button class="selected">歌曲</button><button v-for="kind in ['歌手','专辑','歌单']" :key="kind" title="当前仅接入歌曲搜索，可在关键词中输入歌手或专辑名" disabled>{{ kind }}</button><span>搜索结果 · {{ total }} 首歌曲</span></div>
   <section class="search-result-card"><header><button :disabled="!songs.length||!!adding||allBusy||!roomId||!app.permission.enqueue||!app.connected" @click="addAll"><Play :size="14" />{{ allBusy?'正在添加…':'添加全部' }}</button><span>{{ roomId?'发现喜欢的歌，添加到房间一起听':'加入房间后，可添加音乐一起听' }}</span></header><div class="result-columns"><span>歌曲</span><span>歌手</span><span>专辑</span><span>时长</span><span /></div>
   <p v-if="message" class="music-search-message" role="status" aria-live="polite">{{ message }}</p><div class="music-search-results"><p v-if="searching" class="empty-state loading-state" role="status">正在搜索…</p><p v-else-if="!searched" class="empty-state">输入关键词，找到想一起听的音乐</p><p v-else-if="!songs.length" class="empty-state">没有找到相关音乐，换个关键词试试</p>
    <div v-for="(song,index) in searching?[]:songs" :key="song.id" class="music-search-row search-song-row"><span class="search-song-number">{{ (offset+index+1).toString().padStart(2,'0') }}</span><AlbumArt :src="song.coverUrl" :alt="`${song.album||song.name}专辑封面`" /><strong>{{ song.name }}</strong><span class="search-artist">{{ song.artists||'未知歌手' }}</span><span class="search-album">{{ song.album||'未知专辑' }}</span><time>{{ format(song.durationMs) }}</time><button class="icon-button" :aria-busy="adding===song.id" :disabled="!!adding||allBusy||added.has(song.id)||!roomId||!app.permission.enqueue||!app.connected" :aria-label="`添加 ${song.name}`" @click="add(song)"><LoaderCircle v-if="adding===song.id" class="spinning" :size="17" /><Check v-else-if="added.has(song.id)" :size="17" /><Plus v-else :size="17" /></button></div>
   </div><div v-if="searched&&total>20" class="music-search-pagination"><button class="text-button" :disabled="offset===0||searching||!!adding||allBusy" @click="search(offset-20)">上一页</button><span>{{ Math.floor(offset/20)+1 }} / {{ Math.ceil(total/20) }}</span><button class="text-button" :disabled="offset+20>=total||searching||!!adding||allBusy" @click="search(offset+20)">下一页</button></div></section>
  </div><aside class="search-discovery"><h2><Headphones :size="19" />{{ history.length?'最近发现':'搜索小贴士' }}</h2><p>让好音乐，遇见同频的人</p><ol v-if="history.length"><li v-for="(term,index) in history.slice(0,6)" :key="term"><span>{{ (index+1).toString().padStart(2,'0') }}</span><button :disabled="!!adding||allBusy" @click="chooseSuggestion(term)">{{ term }}</button></li></ol><div v-else class="search-tips">试试歌曲名、歌手或专辑名。<br>搜索不会打断当前播放。<br>只添加有完整播放权限的音源。</div><button class="secondary" :disabled="!keywords.trim()||!!adding||allBusy" @click="roomSearch"><Users :size="16" />搜索同名房间</button><div class="search-room-context"><Headphones :size="17" /><strong>{{ app.room?.name??'还没有加入房间' }}</strong><small>{{ app.room?`${app.room.members.filter(m=>m.online).length} 人正在同频`:'关闭搜索后，选择喜欢的房间' }}</small></div><small class="search-source-note">当前 API 未提供热门榜单，以上为本机搜索记录。</small></aside></div>
  <footer class="global-search-footer"><Headphones :size="17" />搜索不打断一起听，关闭后返回原来的页面<small>GLOBAL SEARCH / 同频</small></footer>
 </section></div></Transition></Teleport>
</template>
