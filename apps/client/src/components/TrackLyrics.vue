<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, nextTick } from 'vue';
import { useApp } from '../store';
import * as bridge from '../bridge';
import { activeLyric, parseLyrics, type LyricLine, type LyricWord } from '../music-library';
import {
  BREATHING,
  buildLineGlowModels,
  buildLineLayout,
  buildLineRenderHints,
  detectChorusLines
} from '../lyrics/glowWordTiming';
import { buildWordMargins, measureWordWidth } from '../lyrics/wordSpacing';
import { lumiereCssVars, stageTheme } from '../stage-theme';
import LumiereWord from './LumiereWord.vue';

const props = withDefaults(defineProps<{
  variant?: 'default' | 'lumiere';
}>(), {
  variant: 'default'
});

// 与 .lumiere-line-wrap 的 clamp(2.25rem, 6vw, 4.5rem) 同源，canvas 量宽按它算词间距
const LUMIERE_FONT_MIN_PX = 36;
const LUMIERE_FONT_MAX_PX = 72;
const LUMIERE_FONT_VW = 0.06;
const LUMIERE_FONT_WEIGHT = 700;
const LUMIERE_FONT_STACK = '"Microsoft YaHei", "Segoe UI", sans-serif';

const app=useApp(),lines=ref<LyricLine[]>([]),status=ref(''),list=ref<HTMLElement|null>(null);
const loading=ref(false);
const current=computed(()=>activeLyric(lines.value,app.progress));
const track=computed(()=>app.room?.playlist.find(t=>t.id===app.room?.playback.sourceId));
// 副歌行只随歌词变化判定一次
const chorusLines=computed(()=>detectChorusLines(lines.value));
// 流光模式的逐字模型只随歌词/强度变化重建，避免播放时钟把整列组件冲掉。
const lineModels=computed(()=>props.variant==='lumiere'
  ? lines.value.map(line=>buildLineGlowModels(line,stageTheme.lumiere.motion,chorusLines.value))
  : []);
const lineLayouts=computed(()=>props.variant==='lumiere'
  ? lines.value.map(line=>buildLineLayout(line.start,stageTheme.lumiere.motion))
  : []);
const lineHints=computed(()=>props.variant==='lumiere'
  ? lines.value.map(line=>buildLineRenderHints(line))
  : []);

// 字号跟随视口，量宽结果才有意义
const viewportWidth=ref(typeof window==='undefined'?1280:window.innerWidth);
let detachViewport: (()=>void)|undefined;
onMounted(()=>{
 if(typeof window==='undefined')return;
 const onResize=()=>{viewportWidth.value=window.innerWidth;};
 window.addEventListener('resize',onResize);
 detachViewport=()=>window.removeEventListener('resize',onResize);
});
onUnmounted(()=>detachViewport?.());

const fontPx=computed(()=>Math.min(LUMIERE_FONT_MAX_PX,Math.max(LUMIERE_FONT_MIN_PX,viewportWidth.value*LUMIERE_FONT_VW)));
// 词间距：把 active 放大与散开位移产生的溢出补进 margin，否则字会互相压住
const lineMargins=computed(()=>{
 if(props.variant!=='lumiere')return [];
 const spacing=stageTheme.lumiere.wordSpacing;
 const minGapRatio=stageTheme.lumiere.motion==='chaotic'?0.08:0.12;
 const px=fontPx.value;
 return lineModels.value.map(models=>{
  const inputs=models.map(m=>({width:measureWordWidth(m.text,px,LUMIERE_FONT_STACK,LUMIERE_FONT_WEIGHT),scale:m.scale,x:m.x}));
  return buildWordMargins(inputs,px,spacing,minGapRatio);
 });
});
// 配色变量缓存住，避免每次渲染都生成新对象触发 style 重算。
const lumiereVars=computed(()=>props.variant==='lumiere'?lumiereCssVars(stageTheme.lumiere):undefined);

// 舞台式布局：只放当前行，撑满可视区居中，全程不滚动
const currentLine=computed(()=>props.variant==='lumiere'&&current.value>=0?lines.value[current.value]:null);

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
// 只有默认变体是滚动列表，才需要跟随滚动
watch(current,async()=>{
 if(props.variant==='lumiere')return;
 await nextTick();
 const row=list.value?.querySelector<HTMLElement>('.lyric-line.active');
 if(row&&list.value)list.value.scrollTo({top:row.offsetTop-list.value.clientHeight/2+row.clientHeight/2,behavior:globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
});
function progress(word:LyricWord){return `${Math.max(0,Math.min(1,(app.progress-word.start)/Math.max(1,word.duration)))*100}%`;}
function isWordActive(word:LyricWord){return app.progress >= word.start && app.progress < word.start + word.duration;}
function isWordPassed(word:LyricWord){return app.progress >= word.start + word.duration;}
// 行级动效：布局（对齐/透视）、进出场时长与呼吸参数，全按行算好挂到 style 上
function lineVars(i:number){
 if(props.variant!=='lumiere')return undefined;
 const layout=lineLayouts.value[i],hints=lineHints.value[i];
 const breathe=stageTheme.lumiere.breathing?BREATHING[stageTheme.lumiere.motion]:null;
 return {
  '--gw-justify':layout?.justifyContent,
  '--gw-align':layout?.alignItems,
  '--gw-perspective':`${layout?.perspective??1000}px`,
  '--gw-enter':`${Math.round(hints?.enterDuration??300)}ms`,
  '--gw-exit':`${Math.round(hints?.exitDuration??300)}ms`,
  '--gw-breathe-dist':breathe?`${breathe.distance}px`:undefined,
  '--gw-breathe-dur':breathe?`${breathe.duration}s`:undefined
 };
}
</script>
<template>
 <section
  v-if="track"
  class="lyrics-panel"
  :class="{ 'is-lumiere': variant === 'lumiere' }"
  :style="lumiereVars"
  aria-label="同步歌词"
 >
  <!-- 流光：舞台式，只呈现当前行并撑满可视区，上下句退到底部字幕，全程不滚动 -->
  <template v-if="variant === 'lumiere'">
   <div class="lumiere-stage">
    <Transition name="lumiere-line">
     <div
      v-if="currentLine"
      :key="current"
      class="lumiere-line-wrap"
      :style="lineVars(current)"
     >
      <span
       class="lumiere-line-inner"
       :class="{ 'is-breathing': stageTheme.lumiere.breathing }"
      ><LumiereWord
        v-for="(model,j) in lineModels[current]"
        :key="j"
        :model="model"
        :margin="lineMargins[current]?.[j]"
      /></span>
     </div>
    </Transition>
    <p v-if="status" class="empty-state compact lumiere-empty" role="status" :aria-busy="loading">{{ status }}</p>
   </div>
  </template>

  <!-- 默认：滚动列表（黑胶 / iPod 形态用），逐字卡拉OK保持 --fill 渐变 -->
  <template v-else>
   <header><h3>歌词</h3><small>{{ lines.some(l=>l.words.length)?'逐字歌词':'时间轴同步' }}</small></header>
   <p v-if="status" class="empty-state compact" :class="{'loading-state':loading}" role="status" :aria-busy="loading">{{ status }}</p>
   <div v-else ref="list" class="lyric-scroll" tabindex="0">
    <p
     v-for="(line,i) in lines"
     :key="i"
     class="lyric-line"
     :class="{ active: i === current, 'has-words': line.words.length > 0 }"
    >
     <template v-if="line.words.length">
      <span
       v-for="(word,j) in line.words"
       :key="j"
       class="lyric-word"
       :class="{
         'is-word-active': i === current && isWordActive(word),
         'is-word-passed': isWordPassed(word)
       }"
       :style="{'--fill':progress(word)}"
      >{{ word.text }}</span>
     </template>
     <template v-else>
      <span class="lyric-text-wrap">{{ line.text || '♪' }}</span>
     </template>
    </p>
   </div>
  </template>
 </section>
</template>

<style scoped>
/* 流光纯歌词模式：配色走 --lumiere-* 变量（由 stage-theme.lumiere 注入） */
.lyrics-panel.is-lumiere {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: transparent;
  border: none;
  overflow: hidden;
  box-shadow: none;
  margin: 0;
  --gw-spring: cubic-bezier(0.34, 1.26, 0.64, 1);
  --gw-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
}

/* 主舞台：占满可视区并居中，字号随视口放大（对齐 Folia clamp(2.25rem, 6vw, 4.5rem)） */
.lumiere-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.lumiere-line-wrap {
  width: 100%;
  font-size: clamp(2.25rem, 6vw, 4.5rem);
  font-weight: 700;
  line-height: 1.22;
  user-select: none;
}

/* 内层负责呼吸漂浮与逐字散开，与行进出场的 transform 分层，互不覆盖 */
.lumiere-line-inner {
  display: flex;
  flex-wrap: wrap;
  width: 100%;
  justify-content: var(--gw-justify, center);
  align-items: var(--gw-align, center);
  perspective: var(--gw-perspective, 1000px);
  transform-origin: center;
}

.lumiere-line-inner.is-breathing {
  animation: lumiere-breathe var(--gw-breathe-dur, 7s) ease-in-out infinite;
}

@keyframes lumiere-breathe {
  0% { transform: translateY(0) scale(1); }
  25% { transform: translateY(calc(var(--gw-breathe-dist, 14px) * -1)) scale(1.01); }
  50% { transform: translateY(0) scale(1); }
  75% { transform: translateY(calc(var(--gw-breathe-dist, 14px) * 0.45)) scale(0.995); }
  100% { transform: translateY(0) scale(1); }
}

/* 行切换：新行聚焦浮现，旧行景深放大散去；时长按行的时序档位给 */
.lumiere-line-enter-active {
  transition: opacity var(--gw-enter, 300ms) var(--gw-ease),
              transform var(--gw-enter, 300ms) var(--gw-ease),
              filter var(--gw-enter, 300ms) var(--gw-ease);
}

.lumiere-line-leave-active {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity var(--gw-exit, 300ms) var(--gw-ease),
              transform var(--gw-exit, 300ms) var(--gw-ease),
              filter var(--gw-exit, 300ms) var(--gw-ease);
}

.lumiere-line-enter-from {
  opacity: 0;
  transform: scale(0.9);
  filter: blur(10px);
}

.lumiere-line-leave-to {
  opacity: 0;
  transform: scale(1.1);
  filter: blur(20px);
}

.lumiere-empty {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  margin: 0;
  font-size: clamp(1.5rem, 3.5vw, 2.5rem);
  color: var(--lumiere-base, #64748b);
  white-space: nowrap;
}

/* 减少动态效果：去掉景深、缩放与呼吸，保留行高亮层级 */
@media (prefers-reduced-motion: reduce) {
  .lumiere-line-enter-active,
  .lumiere-line-leave-active {
    transition: none !important;
  }

  .lumiere-line-enter-from,
  .lumiere-line-leave-to {
    filter: none !important;
    transform: none !important;
  }

  .lumiere-line-inner.is-breathing {
    animation: none !important;
  }
}
</style>
