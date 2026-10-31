<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { positionAt } from '@music-share/shared';
import { useApp } from '../store';
import { stageTheme } from '../stage-theme';
import { nowMs, subscribeLyricClock } from '../lyrics/lyricClock';
import { glowPhaseAt, type GlowPhase, type GlowWordModel } from '../lyrics/glowWordTiming';
import { ACTIVE_SCALE } from '../lyrics/wordSpacing';

// 单字流光渲染：容器 / 旋转 / 光晕 / 主体四层 + 副歌涟漪，各自独立三态。
// 每个字自带 phase ref，只在三态翻转时重渲染；渐变与扫光交给 CSS 合成器，
// 因此歌词列表不会跟着播放时钟整表刷新。
const props = defineProps<{
  model: GlowWordModel;
  /** 由 canvas 量宽算出的右间距，负责把 active 放大与散开位移的溢出补开 */
  margin?: string;
}>();

const app = useApp();
const phase = ref<GlowPhase>('waiting');
let stopClock: (() => void) | undefined;

function syncPhase() {
  const t = app.room ? positionAt(app.room.playback, nowMs() + app.offset) : 0;
  const next = glowPhaseAt(t, props.model);
  if (next !== phase.value) phase.value = next;
}

onMounted(() => { stopClock = subscribeLyricClock(syncPhase); });
onUnmounted(() => stopClock?.());

const wordVars = computed(() => {
  const m = props.model;
  return {
    '--gw-color-dur': `${m.colorDuration}ms`,
    '--gw-focus-dur': `${m.focusDuration}ms`,
    '--gw-fade-dur': `${m.fadeDuration}ms`,
    '--gw-glow-fade': `${m.glowFadeDuration}ms`,
    '--gw-glow-rise': `${m.glowRise}ms`,
    '--gw-glow-inner': `${m.glowInner}px`,
    '--gw-glow-outer': `${m.glowOuter}px`,
    '--gw-rot': `${m.rotate}deg`,
    '--gw-rot-passed': `${m.rotate + m.passedRotate}deg`,
    '--gw-x': `${m.x}px`,
    '--gw-y': `${m.y}px`,
    // waiting 从更远处飘进来，位置由静态布局推导，不随时间变化
    '--gw-wait-x': `${m.x + Math.sin(m.y) * 100}px`,
    '--gw-wait-y': `${m.y + Math.cos(m.x) * 50}px`,
    '--gw-scale-base': String(m.scale),
    '--gw-scale-active': String(m.scale * ACTIVE_SCALE),
    '--gw-ripple-scale': String(m.rippleScale),
    marginRight: props.margin
  };
});

const wordClass = computed(() => ({
  [`is-${phase.value}`]: true,
  'is-single': props.model.singleGlyph,
  'is-no-sweep': !stageTheme.lumiere.sweep,
  'is-no-blur': !stageTheme.lumiere.depthBlur
}));

// 副歌行才扩散涟漪，且只在唱到的时候
const showRipple = computed(() => props.model.isChorus && phase.value === 'active');

function glyphVars(glyph: { delay: number; duration: number }) {
  return { '--gw-delay': `${glyph.delay}ms`, '--gw-trail': `${glyph.duration}ms` };
}
</script>

<template>
  <!-- 光晕层与主体层必须逐字重叠，模板写成单行避免空白字符撑开宽度 -->
  <span class="gw-word" :class="wordClass" :style="wordVars"><span class="gw-spin"><span v-if="showRipple" class="gw-ripple" aria-hidden="true"></span><span class="gw-glow" aria-hidden="true"><span v-for="(g, i) in model.glyphs" :key="i" class="gw-glyph" :style="glyphVars(g)">{{ g.char }}</span></span><span class="gw-body">{{ model.text }}</span></span></span>
</template>

<style scoped>
.gw-word,
.gw-word .gw-spin,
.gw-word .gw-body {
  font: inherit;
  letter-spacing: inherit;
  line-height: inherit;
}

/* ── 容器：waiting 远处飘入 → active spring 弹入 → passed 回落并留在散开位置 ── */
.gw-word {
  display: inline-block;
  position: relative;
  white-space: nowrap;
  transform-origin: center;
  opacity: 0;
  transform: translate(var(--gw-wait-x, 0px), var(--gw-wait-y, 0px)) scale(0.5);
  transition: opacity 100ms linear, transform 450ms var(--gw-spring, cubic-bezier(0.34, 1.26, 0.64, 1));
  will-change: transform, opacity;
}

.gw-word.is-active {
  opacity: 1;
  transform: translate(var(--gw-x, 0px), var(--gw-y, 0px)) scale(var(--gw-scale-active, 1.4));
}

.gw-word.is-passed {
  opacity: 0.82;
  transform: translate(var(--gw-x, 0px), var(--gw-y, 0px)) scale(var(--gw-scale-base, 1));
  transition: opacity 500ms var(--gw-ease, cubic-bezier(0.2, 0.8, 0.2, 1)),
              transform 500ms var(--gw-ease, cubic-bezier(0.2, 0.8, 0.2, 1));
}

/* ── 旋转独立一层：passed 用 5s 极慢续转形成余晖漂移 ── */
.gw-spin {
  position: relative;
  display: inline-block;
  transform: rotate(var(--gw-rot));
  transition: transform 450ms var(--gw-spring, cubic-bezier(0.34, 1.26, 0.64, 1));
}

.gw-word.is-waiting .gw-spin {
  transform: rotate(calc(var(--gw-rot) + 20deg));
  transition-duration: 400ms;
}

.gw-word.is-passed .gw-spin {
  transform: rotate(var(--gw-rot-passed));
  transition: transform 5000ms linear;
}

/* ── 主体层：blur 景深浮现 + 整词颜色过渡 ── */
.gw-body {
  position: relative;
  z-index: 1;
  display: inline-block;
  color: var(--lumiere-base, #64748b);
  filter: blur(10px);
  transition: color 400ms var(--gw-ease, cubic-bezier(0.2, 0.8, 0.2, 1)),
              filter 400ms var(--gw-ease, cubic-bezier(0.2, 0.8, 0.2, 1));
}

.gw-word.is-active .gw-body {
  color: var(--lumiere-primary, #1d6fee);
  filter: blur(0px);
  /* 颜色跟随词时长线性过渡，聚焦解除得更快 */
  transition: color var(--gw-color-dur, 200ms) linear,
              filter var(--gw-focus-dur, 200ms) var(--gw-ease, cubic-bezier(0.2, 0.8, 0.2, 1));
}

.gw-word.is-passed .gw-body {
  color: var(--lumiere-base, #64748b);
  /* 退场后彻底摘掉 filter，避免 blur 图层长期占用合成器 */
  filter: none;
  transition: color var(--gw-fade-dur, 800ms) ease-in-out, filter 500ms ease;
}

.gw-word.is-no-blur .gw-body {
  filter: none !important;
}

/* ── 光晕层：半径按档位给定且恒定，只动 opacity（避免字形缓存反复栅格化） ── */
.gw-glow {
  position: absolute;
  inset: 0;
  display: inline-block;
  pointer-events: none;
  user-select: none;
  color: transparent;
  opacity: 0;
  text-shadow: 0 0 var(--gw-glow-inner, 20px) var(--lumiere-primary, #1d6fee),
               0 0 var(--gw-glow-outer, 40px) var(--lumiere-secondary, #00b4d8);
}

.gw-word.is-active .gw-glow {
  opacity: 1;
  transition: opacity var(--gw-glow-rise, 200ms) ease-in-out;
}

.gw-word.is-passed .gw-glow {
  opacity: 0;
  transition: opacity var(--gw-glow-fade, 900ms) ease-out;
}

/* ── 逐字扫光：光点沿字形依次点亮并拖尾，「流光」感的主要来源 ── */
.gw-glyph {
  display: inline-block;
  opacity: 1;
}

.gw-word.is-active .gw-glyph,
.gw-word.is-passed .gw-glyph {
  animation: gw-trail var(--gw-trail, 300ms) ease-in-out var(--gw-delay, 0ms) 1 both;
}

.gw-word.is-waiting .gw-glyph {
  animation: none;
}

/* 单字形不做扫光，由光晕包络承担「升起并保持」 */
.gw-word.is-single .gw-glyph,
.gw-word.is-no-sweep .gw-glyph {
  animation: none !important;
}

@keyframes gw-trail {
  0% { opacity: 0; }
  30% { opacity: 1; }
  100% { opacity: 0; }
}

/* ── 副歌涟漪：唱到副歌时从字心扩散出去的一圈光 ── */
.gw-ripple {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 0;
  /* 按字高定尺寸：宽度会随词长变化，按宽算会让英文词的涟漪过大 */
  height: 150%;
  aspect-ratio: 1;
  border-radius: 999px;
  border: 1px solid var(--lumiere-primary, #1d6fee);
  filter: blur(1px);
  pointer-events: none;
  animation: gw-ripple 500ms ease-out 1 both;
}

@keyframes gw-ripple {
  from {
    transform: translate(-50%, -50%) scale(0.2);
    opacity: 0.8;
  }
  to {
    transform: translate(-50%, -50%) scale(var(--gw-ripple-scale, 2));
    opacity: 0;
  }
}

/* ── 减少动态效果：保留「当前字高亮 + 光晕」的静态卡拉OK，而不是整个流光失效 ── */
@media (prefers-reduced-motion: reduce) {
  .gw-word,
  .gw-spin {
    transform: none !important;
  }

  .gw-body {
    filter: none !important;
  }

  .gw-glyph,
  .gw-ripple {
    animation: none !important;
  }

  .gw-glyph {
    opacity: 1;
  }

  .gw-ripple {
    display: none;
  }
}
</style>
