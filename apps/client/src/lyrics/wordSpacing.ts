// 词间距测量：canvas 量宽 + 缩放溢出补偿。
// 流光的字在 active 时会放大（约 1.4 倍），散开布局还会平移，直接用默认字距会互相压住。
// 机制参考 Folia classic/Visualizer.tsx 的词间距补偿（AGPL-3.0），此处为独立重写。

/** active 状态下词的峰值缩放，间距补偿按这个值预留两侧溢出 */
export const ACTIVE_SCALE = 1.4;
/** 词与词的基础间隙占字号的比例 */
const GAP_RATIO = 0.05;

let measureCanvas: HTMLCanvasElement | null = null;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  return measureCanvas.getContext('2d');
}

/** 用离屏 canvas 量词宽；无 DOM 环境（测试）时按字符数估算 */
export function measureWordWidth(text: string, fontPx: number, fontStack: string, fontWeight: number): number {
  const ctx = getMeasureContext();
  if (!ctx) return text.length * fontPx * 0.65;
  ctx.font = `${fontWeight} ${fontPx}px ${fontStack}`;
  return ctx.measureText(text).width;
}

export interface WordSpacingInput {
  /** 词的渲染宽度（px） */
  width: number;
  /** 该词的散开缩放 */
  scale: number;
  /** 该词的散开位移（px） */
  x: number;
}

/**
 * 算出每个词的右间距：把 active 放大产生的两侧溢出、散开位移差与基础间隙一起补进去。
 * 最后一个词没有后继，只补自身溢出。
 */
export function buildWordMargins(
  words: WordSpacingInput[],
  fontPx: number,
  spacingMultiplier: number,
  minGapRatio: number
): string[] {
  const gap = GAP_RATIO * fontPx;
  const minMargin = minGapRatio * fontPx * spacingMultiplier;
  const overflow = (w: WordSpacingInput) => (w.width * (w.scale * ACTIVE_SCALE - 1)) / 2;

  return words.map((word, index) => {
    const next = words[index + 1];
    const spread = next ? word.x - next.x : 0;
    const calculated = (overflow(word) + (next ? overflow(next) : 0) + spread + gap) * spacingMultiplier;
    return `${Math.max(minMargin, calculated).toFixed(2)}px`;
  });
}
