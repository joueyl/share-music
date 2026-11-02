import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  stageTheme,
  applyPreset,
  applyLumierePreset,
  hexToRgbTriplet,
  lumiereCssVars,
  IPOD_PRESETS,
  TURNTABLE_VINYL_EDITIONS,
  LUMIERE_PRESETS
} from '../src/stage-theme';

describe('stageTheme state and presets', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn()
    });
  });

  it('can switch between turntable, ipod and lumiere modes', () => {
    stageTheme.mode = 'turntable';
    expect(stageTheme.mode).toBe('turntable');

    stageTheme.mode = 'ipod';
    expect(stageTheme.mode).toBe('ipod');

    stageTheme.mode = 'lumiere';
    expect(stageTheme.mode).toBe('lumiere');
  });

  it('applies presets correctly', () => {
    applyPreset('silver');
    expect(stageTheme.ipod.preset).toBe('silver');
    expect(stageTheme.ipod.bodyColor).toBe(IPOD_PRESETS.silver.bodyColor);
    expect(stageTheme.ipod.wheelColor).toBe(IPOD_PRESETS.silver.wheelColor);
    expect(stageTheme.ipod.buttonColor).toBe(IPOD_PRESETS.silver.buttonColor);

    applyPreset('u2');
    expect(stageTheme.ipod.preset).toBe('u2');
    expect(stageTheme.ipod.bodyColor).toBe(IPOD_PRESETS.u2.bodyColor);
    expect(stageTheme.ipod.wheelColor).toBe(IPOD_PRESETS.u2.wheelColor);
  });

  it('supports custom color adjustments', () => {
    stageTheme.ipod.bodyColor = '#123456';
    stageTheme.ipod.preset = 'custom';
    expect(stageTheme.ipod.bodyColor).toBe('#123456');
    expect(stageTheme.ipod.preset).toBe('custom');
  });

  it('supports 3D tilt and beat pulse toggles', () => {
    stageTheme.ipod.parallaxTilt = false;
    expect(stageTheme.ipod.parallaxTilt).toBe(false);
    stageTheme.ipod.parallaxTilt = true;
    expect(stageTheme.ipod.parallaxTilt).toBe(true);

    stageTheme.ipod.beatPulse = false;
    expect(stageTheme.ipod.beatPulse).toBe(false);
  });
});

describe('lumiere theme config', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn()
    });
  });

  it('applies lumiere presets and marks manual colors as custom', () => {
    applyLumierePreset('dawn');
    expect(stageTheme.lumiere.preset).toBe('dawn');
    expect(stageTheme.lumiere.primary).toBe(LUMIERE_PRESETS.dawn.primary);
    expect(stageTheme.lumiere.secondary).toBe(LUMIERE_PRESETS.dawn.secondary);
    expect(stageTheme.lumiere.base).toBe(LUMIERE_PRESETS.dawn.base);

    applyLumierePreset('ocean');
    expect(stageTheme.lumiere.preset).toBe('ocean');

    stageTheme.lumiere.primary = '#123456';
    stageTheme.lumiere.preset = 'custom';
    expect(stageTheme.lumiere.primary).toBe('#123456');
    expect(stageTheme.lumiere.preset).toBe('custom');
  });

  it('ignores unknown presets instead of blanking the palette', () => {
    applyLumierePreset('ocean');
    const before = { ...stageTheme.lumiere };
    applyLumierePreset('not-a-preset');
    expect(stageTheme.lumiere).toEqual(before);
  });

  it('toggles sweep and depth blur independently', () => {
    stageTheme.lumiere.sweep = false;
    expect(stageTheme.lumiere.sweep).toBe(false);
    stageTheme.lumiere.sweep = true;

    stageTheme.lumiere.depthBlur = false;
    expect(stageTheme.lumiere.depthBlur).toBe(false);
  });

  it('supports motion tier, breathing and word spacing', () => {
    stageTheme.lumiere.motion = 'chaotic';
    expect(stageTheme.lumiere.motion).toBe('chaotic');

    stageTheme.lumiere.breathing = false;
    expect(stageTheme.lumiere.breathing).toBe(false);

    stageTheme.lumiere.wordSpacing = 1.5;
    expect(stageTheme.lumiere.wordSpacing).toBe(1.5);
    stageTheme.lumiere.motion = 'normal';
    stageTheme.lumiere.breathing = true;
    stageTheme.lumiere.wordSpacing = 0.7;
  });

  it('exposes palette as css variables with rgb triplets for alpha', () => {
    expect(hexToRgbTriplet('#1d6fee')).toBe('29, 111, 238');
    expect(hexToRgbTriplet('#fff')).toBe('255, 255, 255');
    expect(hexToRgbTriplet('')).toBe('0, 0, 0');

    const vars = lumiereCssVars(LUMIERE_PRESETS.ocean);
    expect(vars['--lumiere-primary']).toBe(LUMIERE_PRESETS.ocean.primary);
    expect(vars['--lumiere-primary-rgb']).toBe(hexToRgbTriplet(LUMIERE_PRESETS.ocean.primary));
    expect(vars['--lumiere-secondary-rgb']).toBe(hexToRgbTriplet(LUMIERE_PRESETS.ocean.secondary));
    expect(vars['--lumiere-base-rgb']).toBe(hexToRgbTriplet(LUMIERE_PRESETS.ocean.base));
  });

  it('falls back to lumiere defaults for themes saved before the lumiere section existed', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => JSON.stringify({ mode: 'lumiere', ipod: { preset: 'u2' }, turntable: { vinylEdition: 'black' } })),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn()
    });

    const fresh = await import('../src/stage-theme');
    expect(fresh.stageTheme.mode).toBe('lumiere');
    expect(fresh.stageTheme.lumiere.preset).toBe('ocean');
    expect(fresh.stageTheme.lumiere.primary).toBe(fresh.LUMIERE_PRESETS.ocean.primary);
    expect(fresh.stageTheme.lumiere.sweep).toBe(true);
    expect(fresh.stageTheme.lumiere.depthBlur).toBe(true);
    expect(fresh.stageTheme.lumiere.motion).toBe('normal');
    expect(fresh.stageTheme.lumiere.breathing).toBe(true);
    expect(fresh.stageTheme.lumiere.wordSpacing).toBe(0.7);
    // 其它舞台配置照常恢复
    expect(fresh.stageTheme.ipod.preset).toBe('u2');
    expect(fresh.stageTheme.turntable.vinylEdition).toBe('black');
  });
});

it('uses restrained satin vinyl reflections without reducing the silver/gold metalness',()=>{
 expect(TURNTABLE_VINYL_EDITIONS.silver).toMatchObject({color:'#d8dedb',metalness:0.88,roughness:0.42,envMapIntensity:0.45});
 expect(TURNTABLE_VINYL_EDITIONS.gold.metalness).toBe(0.90);
 for(const finish of Object.values(TURNTABLE_VINYL_EDITIONS)){expect(finish.roughness).toBeGreaterThanOrEqual(0.38);expect(finish.envMapIntensity).toBe(0.45);}
});

it('applies satin roughness to the vinyl mesh without the GLB glossy multiplier',()=>{
 const source=readFileSync(new URL('../src/components/TurntableStage.vue',import.meta.url),'utf8');
 const vinyl=source.slice(source.indexOf('if (vinylMesh && vinylMesh.material)'),source.indexOf('const pColor ='));
 expect(vinyl).toContain('mat.roughnessMap = null');expect(vinyl).toContain('mat.envMapIntensity = vEdition.envMapIntensity');expect(vinyl).not.toContain('normalMap = null');expect(vinyl).not.toContain('metalnessMap = null');
});

it('keeps the record album label unlit and separate from the reflective vinyl finish',()=>{
 const source=readFileSync(new URL('../src/components/TurntableStage.vue',import.meta.url),'utf8');
 const label=source.slice(source.indexOf("else if (mesh.name.includes('Center_Label'))"),source.indexOf("else if (mesh.name.includes('Plinth'))"));
 expect(label).toContain('new THREE.MeshBasicMaterial({ map: labelTexture })');expect(label).toContain('mesh.receiveShadow = false');expect(label).not.toContain('MeshStandardMaterial');expect(label).not.toContain('envMap');
});
