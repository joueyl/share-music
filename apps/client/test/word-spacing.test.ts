import { describe, it, expect } from 'vitest';
import { ACTIVE_SCALE, buildWordMargins, measureWordWidth } from '../src/lyrics/wordSpacing';

describe('word width measuring', () => {
  it('estimates width from character count when no canvas is available', () => {
    expect(measureWordWidth('abcd', 10, 'sans-serif', 700)).toBeCloseTo(4 * 10 * 0.65);
    expect(measureWordWidth('', 10, 'sans-serif', 700)).toBe(0);
  });
});

describe('word margins', () => {
  it('compensates for the active scale so growing words do not collide', () => {
    const margins = buildWordMargins(
      [{ width: 100, scale: 1, x: 0 }, { width: 100, scale: 1, x: 0 }],
      28,
      1,
      0.12
    );
    // 每侧溢出 = 100 * (1 * 1.4 - 1) / 2 = 20；基础间隙 = 0.05 * 28 = 1.4
    expect(margins[0]).toBe('41.40px');
    // 末词没有后继，只补自身溢出
    expect(margins[1]).toBe('21.40px');
  });

  it('adds the scatter offset difference into the gap', () => {
    const margins = buildWordMargins(
      [{ width: 100, scale: 1, x: 30 }, { width: 100, scale: 1, x: -30 }],
      28,
      1,
      0.12
    );
    // 散开位移差 30 - (-30) = 60 进入间距
    expect(margins[0]).toBe('101.40px');
  });

  it('never drops below the minimum gap', () => {
    const margins = buildWordMargins([{ width: 0, scale: 0.5, x: 0 }], 28, 1, 0.12);
    // 算出 1.4，低于下限 0.12 * 28 = 3.36
    expect(margins[0]).toBe('3.36px');
  });

  it('scales every gap by the spacing multiplier', () => {
    const loose = buildWordMargins([{ width: 100, scale: 1, x: 0 }], 28, 2, 0.12);
    expect(loose[0]).toBe('42.80px');
    expect(ACTIVE_SCALE).toBe(1.4);
  });

  it('handles an empty word list', () => {
    expect(buildWordMargins([], 28, 1, 0.12)).toEqual([]);
  });
});
