import { describe, it, expect } from 'vitest';
import { buildGlyphTimings, splitGraphemes } from '../src/lyrics/glowGraphemes';
import {
  BREATHING,
  buildLineGlowModels,
  buildLineLayout,
  buildLineRenderHints,
  buildWordGlowModel,
  buildWordLayout,
  detectChorusLines,
  finiteEnd,
  glowPhaseAt,
  MAX_LINE_MS,
  MIN_WORD_DURATION_MS,
  MICRO_LINE_RENDER_FLOOR_MS
} from '../src/lyrics/glowWordTiming';
import type { LyricLine, LyricWord } from '../src/music-library';

const word = (start: number, duration: number, text: string): LyricWord => ({ start, duration, text });
const line = (start: number, end: number, text: string, words: LyricWord[] = []): LyricLine => ({ start, end, text, words });

describe('glow grapheme timings', () => {
  it('splits text into graphemes and spreads delays evenly', () => {
    expect(splitGraphemes('')).toEqual([]);
    expect(splitGraphemes('你好')).toEqual(['你', '好']);

    const glyphs = buildGlyphTimings('abc', 300);
    expect(glyphs.map(g => g.char)).toEqual(['a', 'b', 'c']);
    expect(glyphs.map(g => g.delay)).toEqual([0, 100, 200]);
    // 拖尾拉伸 6 倍：每个字形的淡出被拉长，形成流光
    expect(glyphs.every(g => g.duration === 600)).toBe(true);
  });

  it('keeps delay monotonic and never emits zero-length animations', () => {
    const glyphs = buildGlyphTimings('海阔天空', 240);
    for (let i = 1; i < glyphs.length; i++) expect(glyphs[i].delay).toBeGreaterThan(glyphs[i - 1].delay);
    expect(buildGlyphTimings('a', 1).every(g => g.duration >= 1)).toBe(true);
  });

  it('marks single-grapheme words so they glow continuously instead of sweeping', () => {
    expect(buildGlyphTimings('你', 500)).toHaveLength(1);
    expect(buildGlyphTimings('你', 500)[0].delay).toBe(0);
  });
});

describe('line timing tiers', () => {
  it('classifies lines by raw duration into micro, short and normal', () => {
    const micro = buildLineRenderHints(line(1000, 1050, '啊'));
    expect(micro.timingClass).toBe('micro');
    expect(micro.lineTransitionMode).toBe('none');
    expect(micro.wordRevealMode).toBe('instant');

    const short = buildLineRenderHints(line(1000, 1150, '你好'));
    expect(short.timingClass).toBe('short');
    expect(short.lineTransitionMode).toBe('fast');
    expect(short.wordRevealMode).toBe('fast');

    const normal = buildLineRenderHints(line(1000, 3000, '你好世界'));
    expect(normal.timingClass).toBe('normal');
    expect(normal.lineTransitionMode).toBe('normal');
    expect(normal.wordRevealMode).toBe('normal');
  });

  it('holds micro lines on screen past their end so they do not flash by', () => {
    const hints = buildLineRenderHints(line(1000, 1050, '啊'));
    expect(hints.renderEndTime).toBe(Math.max(1050, 1000 + MICRO_LINE_RENDER_FLOOR_MS));
  });

  it('gives shorter lines snappier enter and exit timings', () => {
    const normal = buildLineRenderHints(line(1000, 3000, '你好世界'));
    const short = buildLineRenderHints(line(1000, 1150, '你好'));
    expect(normal.enterDuration).toBeGreaterThan(short.enterDuration);
    expect(normal.exitDuration).toBeGreaterThan(short.exitDuration);
    expect(buildLineRenderHints(line(1000, 1050, '啊')).enterDuration).toBe(0);
  });

  it('scales lookahead, glow radius and fade durations by tier', () => {
    const source = word(1000, 500, '你');
    const normalHints = buildLineRenderHints(line(1000, 3000, '你', [source]));
    const normal = buildWordGlowModel(source, 3000, normalHints, buildWordLayout(1000, 0, 'normal'));
    expect(normal.activeStart).toBe(850);
    expect(normal.glowInner).toBe(20);
    expect(normal.glowOuter).toBe(40);
    expect(normal.fadeDuration).toBe(800);

    // 80ms 的短字落在 short 档，用更小的光晕与更快的淡出
    const shortSource = word(1000, 80, '啊');
    const shortLine = line(1000, 1150, '啊', [shortSource]);
    const shortHints = buildLineRenderHints(shortLine);
    const short = buildWordGlowModel(shortSource, 1150, shortHints, buildWordLayout(1000, 0, 'normal'));
    expect(short.glowInner).toBe(18);
    expect(short.fadeDuration).toBe(240);
    expect(short.activeStart).toBe(920);
  });

  it('floors very short words to the tier minimum ramp duration', () => {
    const source = word(1000, 50, '你');
    const hints = buildLineRenderHints(line(1000, 3000, '你', [source]));
    const model = buildWordGlowModel(source, 3000, hints, buildWordLayout(1000, 0, 'normal'));
    expect(model.colorDuration).toBe(MIN_WORD_DURATION_MS);
  });
});

describe('glow word phases', () => {
  it('derives waiting, active and passed phases from the word window', () => {
    const source = word(1000, 500, '你');
    const hints = buildLineRenderHints(line(1000, 3000, '你', [source]));
    const model = buildWordGlowModel(source, 3000, hints, buildWordLayout(1000, 0, 'normal'));

    expect(model.activeStart).toBe(850);
    expect(model.activeEnd).toBe(1500);
    expect(glowPhaseAt(849, model)).toBe('waiting');
    expect(glowPhaseAt(850, model)).toBe('active');
    expect(glowPhaseAt(1500, model)).toBe('active');
    expect(glowPhaseAt(1501, model)).toBe('passed');
  });

  it('rises the halo over 90% of the word for single glyphs, fixed rise for words', () => {
    const single = buildWordGlowModel(word(1000, 500, '你'), 3000,
      buildLineRenderHints(line(1000, 3000, '你')), buildWordLayout(1000, 0, 'normal'));
    expect(single.singleGlyph).toBe(true);
    expect(single.glowRise).toBeCloseTo(450);

    const multi = buildWordGlowModel(word(1000, 400, 'Hello'), 3000,
      buildLineRenderHints(line(1000, 3000, 'Hello')), buildWordLayout(1000, 0, 'normal'));
    expect(multi.singleGlyph).toBe(false);
    expect(multi.glowRise).toBe(80);
    expect(multi.glyphs.map(g => g.delay)).toEqual([0, 80, 160, 240, 320]);
  });
});

describe('scatter layout', () => {
  it('produces stable per-word poses that depend only on line seed and index', () => {
    expect(buildWordLayout(1000, 0, 'normal')).toEqual(buildWordLayout(1000, 0, 'normal'));
    expect(buildWordLayout(1000, 1, 'normal')).not.toEqual(buildWordLayout(1000, 0, 'normal'));
  });

  it('keeps calm lines in place and lets chaotic ones spread out', () => {
    const calm = buildWordLayout(1000, 0, 'calm');
    expect(calm.x).toBe(0);
    expect(calm.y).toBe(0);
    expect(calm.rotate).toBe(0);

    const chaotic = buildWordLayout(1000, 0, 'chaotic');
    expect(Math.abs(chaotic.x)).toBeLessThanOrEqual(60);
    expect(Math.abs(chaotic.rotate)).toBeLessThanOrEqual(30);
    expect(chaotic.rippleScale).toBeGreaterThanOrEqual(1.5);
    expect(chaotic.rippleScale).toBeLessThanOrEqual(3.5);
  });

  it('keeps every line centred and varies only the perspective', () => {
    expect(buildLineLayout(1000, 'calm').justifyContent).toBe('center');
    expect(buildLineLayout(2500, 'chaotic').justifyContent).toBe('center');
    expect(buildLineLayout(2500, 'chaotic').alignItems).toBe('center');
    expect(buildLineLayout(1000, 'normal').perspective).toBe(1000);
    const chaotic = buildLineLayout(2500, 'chaotic');
    expect(chaotic.perspective).toBeGreaterThanOrEqual(500);
    expect(chaotic.perspective).toBeLessThan(1000);
  });

  it('calms the breathing float and speeds it up when chaotic', () => {
    expect(BREATHING.calm.distance).toBeLessThan(BREATHING.normal.distance);
    expect(BREATHING.chaotic.distance).toBeGreaterThan(BREATHING.normal.distance);
    expect(BREATHING.chaotic.duration).toBeLessThan(BREATHING.calm.duration);
  });
});

describe('chorus detection', () => {
  it('flags the most repeated lyric lines as chorus', () => {
    const lines = [
      line(0, 1000, '第一句'),
      line(1000, 2000, '副歌来了'),
      line(2000, 3000, '第二句'),
      line(3000, 4000, '副歌来了'),
      line(4000, 5000, '副歌来了')
    ];
    expect(detectChorusLines(lines)).toEqual(new Set(['副歌来了']));
  });

  it('ignores rests, interjections and songs without repetition', () => {
    expect(detectChorusLines([line(0, 1000, '......'), line(1000, 2000, '嗯'), line(2000, 3000, '嗯')]).size).toBe(0);
    expect(detectChorusLines([line(0, 1000, '第一句'), line(1000, 2000, '第二句')]).size).toBe(0);
  });

  it('marks chorus words so they can ripple while singing', () => {
    const chorus = detectChorusLines([line(0, 1000, '副歌'), line(1000, 2000, '副歌')]);
    const model = buildLineGlowModels(line(0, 1000, '副歌'), 'normal', chorus)[0];
    expect(model.isChorus).toBe(true);
    expect(buildLineGlowModels(line(0, 1000, '主歌'), 'normal', chorus)[0].isChorus).toBe(false);
  });
});

describe('glow line models', () => {
  it('truncates infinite line ends so CSS math stays finite', () => {
    expect(finiteEnd(Infinity, 1000)).toBe(1000 + MAX_LINE_MS);
    expect(finiteEnd(3000, 1000)).toBe(3000);
  });

  it('synthesizes one sweeping word for LRC lines without word timings', () => {
    const models = buildLineGlowModels(line(1000, 3000, '普通歌词'));
    expect(models).toHaveLength(1);
    expect(models[0].text).toBe('普通歌词');
    expect(models[0].singleGlyph).toBe(false);
    expect(models[0].glyphs).toHaveLength(4);
    expect(models[0].activeEnd).toBe(3000);
  });

  it('falls back to a rest symbol for instrumental lines', () => {
    expect(buildLineGlowModels(line(0, 1000, ''))[0].text).toBe('♪');
  });

  it('caps synthetic words for trailing lines that never end', () => {
    const model = buildLineGlowModels(line(1000, Infinity, '你好'))[0];
    expect(Number.isFinite(model.activeEnd)).toBe(true);
  });

  it('keeps one model per parsed word on word-timed lines', () => {
    const models = buildLineGlowModels(line(1000, 3000, '你好', [word(1000, 500, '你'), word(1500, 1500, '好')]));
    expect(models.map(m => m.text)).toEqual(['你', '好']);
    expect(models.map(m => m.activeStart)).toEqual([850, 1350]);
  });
});
