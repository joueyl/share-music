import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { coverCrop, roomFlowPreset } from '../src/room-flow-preset';

it('keeps the fixed flow effect and snapshot phases', () => {
  expect(roomFlowPreset.parameters).toMatchObject({
    blur: 107, strength: 20, scale: 3, speed: .8, swirl: -24,
    directional: 42, zoomBlur: 11, lens: -37, contrast: 9, saturation: 6,
    imageSpin: 8, leftSpin: -7, rightSpin: -8,
  });
  expect(Object.values(roomFlowPreset.filterEnabled)).toHaveLength(18);
  expect(Object.values(roomFlowPreset.filterEnabled).every(Boolean)).toBe(true);
  expect(roomFlowPreset.playback).toEqual({
    paused: false, time: 116.99955239998418, filterRotationPhase: 0,
    centerRotationPhase: .6676250908022379, leftRotationPhase: -5.011075901925036,
    rightRotationPhase: -6.2099704903877555,
  });
  expect(roomFlowPreset.view).toEqual({ splitView: true, allowOverflow: true, showGuides: false, stackPresets: true });
});

it('center-crops album artwork without distorting it or leaving bars', () => {
  const crop = coverCrop(1000, 1000, 700, 550);
  expect(crop[0]).toBe(0);
  expect(crop[1]).toBeCloseTo(107.142857);
  expect(crop[2] / crop[3]).toBeCloseTo(700 / 550);
  expect(coverCrop(1400, 1100, 700, 550)).toEqual([0, 0, 1400, 1100]);
  expect(coverCrop(1400, 550, 700, 550)).toEqual([350, 0, 700, 550]);
});

it('positions the artwork across the desktop room shell and leaves it non-interactive', () => {
  const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8');
  expect(app).toMatch(/<RoomFlowBackground\s+v-if="bridge.desktop && app.user && inRoom && app.room && app.room.id === route.params.id"/);
  expect(app).toContain(':cover-url="bridge.playingTrackCover(roomFlowTrack)"');
  const sfc = parse(readFileSync(new URL('../src/components/RoomFlowBackground.vue', import.meta.url), 'utf8'));
  expect(sfc.errors).toEqual([]);
  const css = sfc.descriptor.styles[0].content;
  expect(css).toMatch(/\.room-flow\s*\{[^}]*inset: 0;[^}]*pointer-events: none;/s);
  expect(css).toContain('object-fit: cover');
});
