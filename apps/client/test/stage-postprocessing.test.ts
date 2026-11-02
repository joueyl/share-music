import { beforeEach, expect, it, vi } from 'vitest';
import { Camera, HalfFloatType, NoBlending, NoToneMapping, Scene, UnsignedByteType } from 'three';
import type { WebGLRenderer } from 'three';
import { createStagePostprocessing } from '../src/stage-postprocessing';

const state = vi.hoisted(() => ({
 options: {} as Record<string, unknown>, passes: [] as any[],
 setSize: vi.fn(), render: vi.fn(), dispose: vi.fn(),
}));
vi.mock('postprocessing', () => ({
 EffectComposer: class {
  constructor(_renderer: unknown, options: Record<string, unknown>) { state.options = options; }
  addPass(pass: unknown) { state.passes.push(pass); }
  setSize = state.setSize; render = state.render; dispose = state.dispose;
 },
 RenderPass: class { constructor(public scene: unknown, public camera: unknown) {} },
 EffectPass: class {
  effects: any[];
  constructor(public camera: unknown, ...effects: any[]) { this.effects = effects; }
 },
 Effect: class { constructor(public name: string, public fragmentShader: string, public options: unknown) {} },
 ShaderPass: class { constructor(public fullscreenMaterial: any) {} },
 ToneMappingEffect: class { constructor(public options: unknown) {} },
 SMAAEffect: class { constructor(public options: unknown) {} },
 ToneMappingMode: { ACES_FILMIC: 'aces' }, SMAAPreset: { ULTRA: 'ultra' }, BlendFunction: { SRC: 'src' },
}));
beforeEach(() => { state.passes = []; vi.clearAllMocks(); });
function fixture(hdr = true, colorSamples: number[] | null = [8, 4, 2], depthSamples = [8, 4, 2], maxSamples = 8) {
 const gl = {
  RENDERBUFFER: 1, RGBA16F: 2, RGBA8: 3, DEPTH_COMPONENT24: 4, SAMPLES: 5,
  getInternalformatParameter: vi.fn((_target: number, format: number) => format === 4 ? depthSamples : colorSamples),
 };
 const renderer = { toneMapping: -1, toneMappingExposure: 1.15, extensions: { has: vi.fn(() => hdr) },
  getContext: () => gl, capabilities: { maxSamples } };
 const scene = new Scene(), camera = new Camera();
 return { renderer, scene, camera, pipeline: createStagePostprocessing(renderer as unknown as WebGLRenderer, scene, camera) };
}
it('uses maximum supported MSAA and ULTRA SMAA without duplicate tone mapping', () => {
 const { renderer, scene, camera } = fixture();
 expect(renderer.toneMapping).toBe(NoToneMapping);
 expect(renderer.toneMappingExposure).toBe(1.15);
 expect(state.options).toEqual({ frameBufferType: HalfFloatType, multisampling: 8 });
 expect(state.passes).toHaveLength(4);
 expect(state.passes[0]).toMatchObject({ scene, camera });
 expect(state.passes[1].effects[1].options).toEqual({ mode: 'aces' });
 expect(state.passes[2].effects[0].options).toEqual({ preset: 'ultra' });
 expect(renderer.getContext().getInternalformatParameter).toHaveBeenCalledWith(1, 2, 5);
});
it('falls back to byte buffers on WebViews without float color attachments', () => {
 const { renderer } = fixture(false);
 expect(renderer.extensions.has).toHaveBeenCalledWith('EXT_color_buffer_float');
 expect(state.options.frameBufferType).toBe(UnsignedByteType);
 expect(renderer.getContext().getInternalformatParameter).toHaveBeenCalledWith(1, 3, 5);
});
it('selects the highest shared color/depth count within the renderer limit', () => {
 fixture(true, [8, 4, 2], [4, 2], 8);
 expect(state.options.multisampling).toBe(4);
 fixture(true, [8, 4, 2], [8, 4, 2], 2);
 expect(state.options.multisampling).toBe(2);
});
it('retains ULTRA SMAA when the attachment formats have no supported MSAA count', () => {
 for (const samples of [[], null, [8]]) {
  fixture(true, samples, [4, 2]);
  expect(state.options.multisampling).toBe(0);
  expect(state.passes[2].effects[0].options).toEqual({ preset: 'ultra' });
 }
});
it('unpremultiplies before tone mapping and restores coverage before SMAA', () => {
 fixture();
 const effects = state.passes[1].effects;
 expect(effects.map((effect: any) => effect.name ?? 'ACES')).toEqual(['StageUnpremultiply', 'ACES', 'StagePremultiply']);
 expect(effects[0].fragmentShader).toContain('inputColor.a > 0.0 ? inputColor.rgb / inputColor.a : vec3(0.0)');
 expect(effects[2].fragmentShader).toContain('inputColor.rgb * inputColor.a');
 for (const index of [0, 2]) expect(effects[index].options).toEqual({ blendFunction: 'src' });
});
it('encodes straight color before final premultiplication without applying alpha blending again', () => {
 fixture();
 const material = state.passes[3].fullscreenMaterial;
 expect(material.blending).toBe(NoBlending);
 expect(material.toneMapped).toBe(false);
 expect(material.depthTest).toBe(false);
 expect(material.depthWrite).toBe(false);
 const shader = material.fragmentShader;
 const divide = shader.indexOf('color.a > 0.0 ? color.rgb / color.a : vec3(0.0)');
 const encode = shader.indexOf('#include <colorspace_fragment>');
 const multiply = shader.indexOf('gl_FragColor.rgb *= gl_FragColor.a');
 expect(divide).toBeGreaterThan(-1);
 expect(encode).toBeGreaterThan(divide);
 expect(multiply).toBeGreaterThan(encode);
});
it('forwards logical resize without CSS changes, frame delta, and target cleanup', () => {
 const { pipeline } = fixture();
 pipeline.setSize(500, 400); pipeline.render(0.016); pipeline.dispose();
 expect(state.setSize).toHaveBeenCalledExactlyOnceWith(500, 400, false);
 expect(state.render).toHaveBeenCalledExactlyOnceWith(0.016);
 expect(state.dispose).toHaveBeenCalledOnce();
});
