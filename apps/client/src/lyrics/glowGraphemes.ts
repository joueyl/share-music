// 字形切分与时序均分：把一个词的时间跨度摊到它的每个字形上。
// 时间单位沿用 LyricWord/LyricLine 的毫秒基准，CSS 侧直接以 ms 注入，不做秒换算。
// 机制参考 Folia 的 utils/lyrics/graphemeTiming.ts（AGPL-3.0），此处为独立重写。

/** 光晕拖尾拉伸倍数：Folia 让光晕淡出拉长到字时长的 6 倍，形成「流光」拖尾 */
export const TRAIL_STRETCH = 6;

export interface GlowGlyph {
  char: string;
  /** 相对词起点的延迟（ms），直接作为 CSS animation-delay */
  delay: number;
  /** 扫光动画时长（ms），已含拖尾拉伸 */
  duration: number;
}

let segmenter: Intl.Segmenter | null | undefined;

function getSegmenter(): Intl.Segmenter | null {
  if (segmenter === undefined) {
    segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      : null;
  }
  return segmenter;
}

/** 按字素切分（处理 emoji 组合、代理对），不支持 Intl.Segmenter 时回退码点遍历 */
export function splitGraphemes(text: string): string[] {
  if (!text) return [];
  const seg = getSegmenter();
  if (seg) return [...seg.segment(text)].map(s => s.segment);
  return [...text];
}

/**
 * 均分每个字形的扫光延迟与时长。
 * 本地歌词没有音节级时间戳，因此在词内部按字形均分（等价 Folia 无 syllables 的分支）。
 */
export function buildGlyphTimings(text: string, duration: number): GlowGlyph[] {
  const chars = splitGraphemes(text);
  const total = chars.length;
  if (!total) return [];
  const unit = duration / total;
  return chars.map((char, index) => ({
    char,
    delay: unit * index,
    duration: Math.max(unit * TRAIL_STRETCH, 1)
  }));
}
