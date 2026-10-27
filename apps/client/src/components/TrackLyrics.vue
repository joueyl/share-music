<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useApp } from '../store';
import * as bridge from '../bridge';
import { activeLyric, parseLyrics, type LyricLine, type LyricWord } from '../music-library';
const app=useApp(),lines=ref<LyricLine[]>([]),status=ref(''),list=ref<HTMLElement|null>(null);
const loading=ref(false);
const current=computed(()=>activeLyric(lines.value,app.progress));
const track=computed(()=>app.room?.playlist.find(t=>t.id===app.room?.playback.sourceId));
// Compare source values individually: room snapshots can change without a song change.
watch([()=>app.room?.id,()=>track.value?.id,()=>app.connected],async(_,__,onCleanup)=>{
 const roomId=app.room?.id,song=track.value;let alive=true;const abort=new AbortController();onCleanup(()=>{alive=false;abort.abort();});
 lines.value=[];status.value='';loading.value=false;if(!roomId||!song)return;
 if(!app.connected){status.value='连接后加载歌词';return;}
 status.value='正在加载歌词…';loading.value=true;
 try{
  const id=song.neteaseId??(await bridge.trackMetadata(roomId,song.id)).neteaseId;
  if(!alive)return;if(!id){status.value='本地歌曲暂无网易云歌词';return;}
  const data=await bridge.songLyrics(id,abort.signal);if(!alive)return;
  lines.value=parseLyrics(data);status.value=lines.value.length?'':data.nolyric?'纯音乐，请欣赏':'暂无歌词';
 }catch{if(alive)status.value='歌词暂时无法加载，重新连接或切歌后重试';}
 finally{if(alive)loading.value=false;}
},{immediate:true});
watch(current,async()=>{await nextTick();const row=list.value?.querySelector<HTMLElement>('.lyric-line.active');if(row&&list.value)list.value.scrollTo({top:row.offsetTop-list.value.clientHeight/2+row.clientHeight/2,behavior:globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});});
function progress(word:LyricWord){return `${Math.max(0,Math.min(1,(app.progress-word.start)/Math.max(1,word.duration)))*100}%`;}
</script>
<template>
 <section v-if="track" class="lyrics-panel" aria-label="同步歌词"><header><h3>歌词</h3><small>{{ lines.some(l=>l.words.length)?'逐字歌词':'时间轴同步' }}</small></header>
  <p v-if="status" class="empty-state compact" :class="{'loading-state':loading}" role="status" :aria-busy="loading">{{ status }}</p>
  <div v-else ref="list" class="lyric-scroll" tabindex="0">
   <p v-for="(line,i) in lines" :key="i" class="lyric-line" :class="{active:i===current}">
    <template v-if="line.words.length"><span v-for="(word,j) in line.words" :key="j" class="lyric-word" :style="{'--fill':progress(word)}">{{ word.text }}</span></template><template v-else>{{ line.text || '♪' }}</template>
   </p>
  </div>
 </section>
</template>
