// Folia「流光」(classic) 的逐字时序：三态判定、时序档位与渲染模型构造。
// 全链路使用毫秒（与 LyricWord/LyricLine 同基准），CSS 侧以 ms 变量注入，不做秒换算。
// 机制参考 Folia 的 visualizer/glowWordTiming.ts、GlowWord.tsx 与 utils/lyrics/renderHints.ts（AGPL-3.0），此处为独立重写。
import type { LyricLine, LyricWord } from '../music-library';
import { buildGlyphTimings, type GlowGlyph } from './glowGraphemes';

export type GlowPhase = 'waiting' | 'active' | 'passed';
export type LineTimingClass = 'micro' | 'short' | 'normal';
export type LineTransitionMode = 'none' | 'fast' | 'normal';
export type WordRevealMode = 'instant' | 'fast' | 'normal';
export type MotionIntensity = 'calm' | 'normal' | 'chaotic';

/** 行时长分档阈值：micro < 100ms、short < 180ms，其余为 normal（Folia renderHints） */
export const MICRO_LINE_DURATION_MS = 100;
export const SHORT_LINE_DURATION_MS = 180;
/** micro 行的渲染下限，避免一闪而过 */
export const MICRO_LINE_RENDER_FLOOR_MS = 67;
/** normal 档的发光 ramp 最短时长，兜住 yrc 里的极短字 */
export const MIN_WORD_DURATION_MS = 100;
/** 末行 end 为 Infinity 时的截断上限，否则 CSS calc 会得到 Infinity */
export const MAX_LINE_MS = 15_000;
/** fast 档给短字的保底点亮时长 */
const FAST_MIN_LIT_MS = 120;
/** 单字形光晕升到峰值占词时长的比例，等价 Folia glowKeyframes([0,1,1]) + times:[0,.9,1] */
const SINGLE_GLOW_RISE_RATIO = 0.9;
/** 多字形的光晕包络上升时长（扫光由逐字 keyframes 承担） */
const MULTI_GLOW_RISE_MS = 80;

/** 每档的时序与光晕参数（Folia glowWordTiming / wordGlow 的档位表） */
export interface RevealProfile {
  /** 开唱前的提前点亮量 */
  wordLookahead: number;
  /** 发光 ramp 的最短时长 */
  minDuration: number;
  /** 双环光晕半径：内环 / 外环（px） */
  glowInner: number;
  glowOuter: number;
  /** blur(10px) → 0 的聚焦时长 */
  focusDuration: number;
  /** passed 后主体层褪色时长 */
  fadeDuration: number;
  /** passed 后光晕淡出时长 */
  glowFadeDuration: number;
}

export const REVEAL_PROFILES: Record<WordRevealMode, RevealProfile> = {
  instant: { wordLookahead: 30, minDuration: 80, glowInner: 14, glowOuter: 24, focusDuration: 80, fadeDuration: 120, glowFadeDuration: 120 },
  fast: { wordLookahead: 80, minDuration: 120, glowInner: 18, glowOuter: 32, focusDuration: 120, fadeDuration: 240, glowFadeDuration: 220 },
  normal: { wordLookahead: 150, minDuration: 100, glowInner: 20, glowOuter: 40, focusDuration: 200, fadeDuration: 800, glowFadeDuration: 900 }
};

export interface LineRenderHints {
  rawDuration: number;
  timingClass: LineTimingClass;
  /** 行可以留在屏上的最晚时刻，供 passed / 退场用 */
  renderEndTime: number;
  lineTransitionMode: LineTransitionMode;
  wordRevealMode: WordRevealMode;
  enterDuration: number;
  exitDuration: number;
}

/** 截断 LRC 末行的 Infinity，保证后续 CSS calc 拿到有限值 */
export function finiteEnd(end: number, start: number): number {
  return Number.isFinite(end) ? end : start + MAX_LINE_MS;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function timingClassOf(rawDuration: number): LineTimingClass {
  if (rawDuration < MICRO_LINE_DURATION_MS) return 'micro';
  if (rawDuration < SHORT_LINE_DURATION_MS) return 'short';
  return 'normal';
}

function transitionModeOf(cls: LineTimingClass): LineTransitionMode {
  return cls === 'micro' ? 'none' : cls === 'short' ? 'fast' : 'normal';
}

function revealModeOf(cls: LineTimingClass): WordRevealMode {
  return cls === 'micro' ? 'instant' : cls === 'short' ? 'fast' : 'normal';
}

/** 行进出场时长（Folia getLineTransitionTiming，秒换算为毫秒） */
function transitionTimingOf(rawDuration: number, mode: LineTransitionMode) {
  if (mode === 'none') return { enterDuration: 0, exitDuration: 0, linePassHold: 0 };
  if (mode === 'fast') {
    return {
      enterDuration: clamp(rawDuration * 0.45, 45, 60),
      exitDuration: clamp(rawDuration * 0.22, 30, 40),
      linePassHold: 30
    };
  }
  return {
    enterDuration: clamp(Math.max(rawDuration, 120) * 0.34, 220, 420),
    exitDuration: clamp(Math.max(rawDuration, 120) * 0.18, 180, 320),
    linePassHold: 60
  };
}

function lastWordEndOf(line: LyricLine, fallback: number): number {
  const last = line.words[line.words.length - 1];
  return last ? last.start + last.duration : fallback;
}

function buildRenderEndTime(
  line: LyricLine,
  lineEnd: number,
  mode: LineTransitionMode,
  timing: { enterDuration: number; exitDuration: number; linePassHold: number }
): number {
  if (mode === 'none') return Math.max(lineEnd, line.start + MICRO_LINE_RENDER_FLOOR_MS);
  const linePassStart = Math.max(lastWordEndOf(line, lineEnd), line.start) + timing.linePassHold;
  const exitStart = mode === 'fast'
    ? Math.max(line.start + timing.enterDuration + 10, linePassStart, lineEnd - timing.exitDuration)
    : Math.max(linePassStart, lineEnd - timing.exitDuration);
  return Math.max(lineEnd, exitStart + timing.exitDuration);
}

/** 按行原始时长算出这一行该怎么过渡、每个字该怎么点亮 */
export function buildLineRenderHints(line: LyricLine): LineRenderHints {
  const lineEnd = finiteEnd(line.end, line.start);
  const rawDuration = Math.max(lineEnd - line.start, 0);
  const timingClass = timingClassOf(rawDuration);
  const lineTransitionMode = transitionModeOf(timingClass);
  const wordRevealMode = revealModeOf(timingClass);
  const timing = transitionTimingOf(rawDuration, lineTransitionMode);
  return {
    rawDuration,
    timingClass,
    renderEndTime: buildRenderEndTime(line, lineEnd, lineTransitionMode, timing),
    lineTransitionMode,
    wordRevealMode,
    enterDuration: timing.enterDuration,
    exitDuration: timing.exitDuration
  };
}

/** 三态判定：activeStart / activeEnd 均为闭区间（对齐 Folia GlowWord 的边界语义） */
export function glowPhaseAt(
  timeMs: number,
  model: Pick<GlowWordModel, 'activeStart' | 'activeEnd'>
): GlowPhase {
  if (timeMs < model.activeStart) return 'waiting';
  if (timeMs <= model.activeEnd) return 'active';
  return 'passed';
}

// ── 确定性随机布局：同一行同一位置每次得到同一姿态，时间只驱动动画状态 ──

export interface WordLayout {
  x: number;
  y: number;
  scale: number;
  rotate: number;
  /** passed 期间的追加旋转角，配合 5s 极慢续转形成余晖漂移 */
  passedRotate: number;
  alignSelf: string;
  /** 副歌涟漪的扩散终点倍率 */
  rippleScale: number;
}

export interface LineLayout {
  justifyContent: string;
  alignItems: string;
  /** 行容器透视距离，配合逐字 rotate/scale 产生轻微景深 */
  perspective: number;
}

const SPREAD_PX: Record<MotionIntensity, number> = { calm: 0, normal: 20, chaotic: 60 };
const ROTATE_DEG: Record<MotionIntensity, number> = { calm: 0, normal: 5, chaotic: 30 };

function seededUnit(seed: number, offset: number): number {
  const x = Math.sin(seed + offset) * 10000;
  return x - Math.floor(x);
}

export function buildWordLayout(lineSeed: number, index: number, intensity: MotionIntensity): WordLayout {
  const wordSeed = lineSeed + index;
  const r = (offset: number) => seededUnit(wordSeed, offset);
  const spread = SPREAD_PX[intensity];
  const baseRotate = ROTATE_DEG[intensity];
  return {
    x: (r(1) - 0.5) * spread * 2,
    y: (r(2) - 0.5) * spread * 2,
    scale: intensity === 'chaotic' ? 0.8 + r(4) * 0.6 : 1.1 + r(4) * 0.2,
    rotate: (r(3) - 0.5) * baseRotate * 2,
    passedRotate: (r(8) - 0.5) * 45,
    alignSelf: intensity === 'chaotic' && r(6) > 0.7 ? (r(7) > 0.5 ? 'flex-start' : 'flex-end') : 'auto',
    rippleScale: 1.5 + r(9) * 2
  };
}

export function buildLineLayout(lineSeed: number, intensity: MotionIntensity): LineLayout {
  const safeSeed = Math.abs(Math.floor(lineSeed)) || 1;
  return {
    // Folia 会按行随机挑对齐方式制造舞台变化，但那样歌词会偏左 / 偏右；这里固定居中，
    // 只保留透视距离的逐行差异（配合散开位移与旋转仍有景深变化）
    justifyContent: 'center',
    alignItems: 'center',
    perspective: intensity === 'chaotic' ? 500 + (safeSeed % 500) : 1000
  };
}

/** 整行呼吸漂浮参数（挂行容器，y/scale 关键帧循环） */
export interface BreathingConfig {
  /** 漂浮幅度（px） */
  distance: number;
  /** 循环周期（秒） */
  duration: number;
}

export const BREATHING: Record<MotionIntensity, BreathingConfig> = {
  calm: { distance: 10, duration: 8.5 },
  normal: { distance: 14, duration: 7 },
  chaotic: { distance: 18, duration: 5.8 }
};

/**
 * 副歌行检测：重复次数最多的歌词文本视为高潮段。
 * 跳过空行、间奏标记与单字语气词（Folia chorusDetector 同款启发式）。
 */
export function detectChorusLines(lines: LyricLine[]): Set<string> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const text = line.text.trim();
    if (!text || text === '......' || text.length < 2) continue;
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  let maxCount = 0;
  for (const count of counts.values()) if (count > maxCount) maxCount = count;
  const chorus = new Set<string>();
  if (maxCount <= 1) return chorus;
  for (const [text, count] of counts) if (count === maxCount) chorus.add(text);
  return chorus;
}

// ── 逐字渲染模型 ──

export interface GlowWordModel {
  text: string;
  /** 进入 active 的时刻（ms，已含提前量） */
  activeStart: number;
  /** 离开 active 的时刻（ms） */
  activeEnd: number;
  /** 主体层颜色线性过渡时长（ms） */
  colorDuration: number;
  focusDuration: number;
  fadeDuration: number;
  glowFadeDuration: number;
  /** 光晕包络上升时长（ms）：单字形占词时长 90%，多字形固定值 */
  glowRise: number;
  /** 双环光晕半径（px） */
  glowInner: number;
  glowOuter: number;
  x: number;
  y: number;
  scale: number;
  rotate: number;
  passedRotate: number;
  alignSelf: string;
  /** 副歌涟漪的扩散终点倍率 */
  rippleScale: number;
  /** 副歌行：active 时额外扩散涟漪 */
  isChorus: boolean;
  glyphs: GlowGlyph[];
  /** 单字形（典型汉字）不做逐字扫光，改由光晕包络承担「升起并保持」 */
  singleGlyph: boolean;
}

export function buildWordGlowModel(
  word: LyricWord,
  lineEnd: number,
  hints: LineRenderHints,
  layout: WordLayout,
  isChorus = false
): GlowWordModel {
  const profile = REVEAL_PROFILES[hints.wordRevealMode];
  const start = word.start;
  const wordEnd = start + Math.max(word.duration, profile.minDuration);
  const activeStart = start - profile.wordLookahead;

  let activeEnd: number;
  if (hints.wordRevealMode === 'instant') {
    // 短促行整行一起亮到行尾，允许留到 renderEndTime（比 line.end 更晚）
    activeEnd = hints.renderEndTime;
  } else if (hints.wordRevealMode === 'fast') {
    activeEnd = Math.min(hints.renderEndTime, Math.max(wordEnd, start + FAST_MIN_LIT_MS));
  } else {
    activeEnd = wordEnd;
  }
  // wordEnd 与 renderEndTime 都已有限，这里只兜住非法数据
  activeEnd = Math.max(activeStart, Number.isFinite(activeEnd) ? activeEnd : finiteEnd(lineEnd, start));

  const colorDuration = Math.max(activeEnd - start, profile.minDuration);
  const glyphs = buildGlyphTimings(word.text, colorDuration);
  const singleGlyph = glyphs.length <= 1;

  return {
    text: word.text,
    activeStart,
    activeEnd,
    colorDuration,
    focusDuration: profile.focusDuration,
    fadeDuration: profile.fadeDuration,
    glowFadeDuration: profile.glowFadeDuration,
    glowRise: singleGlyph ? colorDuration * SINGLE_GLOW_RISE_RATIO : MULTI_GLOW_RISE_MS,
    glowInner: profile.glowInner,
    glowOuter: profile.glowOuter,
    ...layout,
    isChorus,
    glyphs,
    singleGlyph
  };
}

/**
 * 逐行构造渲染模型。LRC 回落（words 为空）时把整行合成一个词，
 * 拆成字形后自动走逐字扫光，替代原先固定周期循环的游走光斑。
 */
export function buildLineGlowModels(
  line: LyricLine,
  intensity: MotionIntensity = 'normal',
  chorusLines?: Set<string>
): GlowWordModel[] {
  const lineEnd = finiteEnd(line.end, line.start);
  const hints = buildLineRenderHints(line);
  const isChorus = chorusLines?.has(line.text.trim()) ?? false;
  const profile = REVEAL_PROFILES[hints.wordRevealMode];
  const source: LyricWord[] = line.words.length
    ? line.words
    : [{ start: line.start, duration: Math.max(lineEnd - line.start, profile.minDuration), text: line.text || '♪' }];

  return source.map((word, index) =>
    buildWordGlowModel(word, lineEnd, hints, buildWordLayout(line.start, index, intensity), isChorus)
  );
}
