import { HalfFloatType, NoBlending, NoToneMapping, ShaderMaterial, Uniform, UnsignedByteType } from 'three';
import type { Camera, Scene, WebGLRenderer } from 'three';
import { BlendFunction, Effect, EffectComposer, EffectPass, RenderPass, ShaderPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode } from 'postprocessing';

// MSAA resolves coverage into premultiplied linear RGB. Nonlinear transforms
// must operate on straight color, not on color multiplied by edge coverage.
const unpremultiply = `void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
 outputColor = vec4(inputColor.a > 0.0 ? inputColor.rgb / inputColor.a : vec3(0.0), inputColor.a);
}`;
const premultiply = `void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
 outputColor = vec4(inputColor.rgb * inputColor.a, inputColor.a);
}`;

/** Convert straight linear color to sRGB BEFORE reapplying canvas coverage. */
function createAlphaOutputPass() {
 return new ShaderPass(new ShaderMaterial({
  name: 'StageAlphaOutput', blending: NoBlending, depthTest: false, depthWrite: false, toneMapped: false,
  uniforms: { inputBuffer: new Uniform(null) },
  vertexShader: `varying vec2 vUv;
   void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
  fragmentShader: `uniform sampler2D inputBuffer;
   varying vec2 vUv;
   void main() {
    vec4 color = texture2D(inputBuffer, vUv);
    gl_FragColor = vec4(color.a > 0.0 ? color.rgb / color.a : vec3(0.0), color.a);
    #include <colorspace_fragment>
    gl_FragColor.rgb *= gl_FragColor.a;
   }`,
 }));
}

/** Shared transparent pipeline for both 3D stages; Three.js still owns the scene. */
export function createStagePostprocessing(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
 renderer.toneMapping = NoToneMapping;
 // Preserve HDR highlights before tone mapping where the WebView supports it.
 const frameBufferType = renderer.extensions.has('EXT_color_buffer_float') ? HalfFloatType : UnsignedByteType;
 // Color and depth attachments must support the same sample count. MAX_SAMPLES
 // alone can exceed the limit for half-float targets on some WebView GPUs.
 // Three.js r174 requires WebGL2, though @types/three still includes WebGL1.
 const gl = renderer.getContext() as WebGL2RenderingContext;
 const colorSamples = Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER,
  frameBufferType === HalfFloatType ? gl.RGBA16F : gl.RGBA8, gl.SAMPLES) as Int32Array | null ?? []);
 const depthSamples = Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, gl.SAMPLES) as Int32Array | null ?? []);
 const multisampling = Math.max(0, ...colorSamples.filter(samples => samples <= renderer.capabilities.maxSamples && depthSamples.includes(samples)));
 const composer = new EffectComposer(renderer, { frameBufferType, multisampling });
 composer.addPass(new RenderPass(scene, camera));
 composer.addPass(new EffectPass(camera,
  new Effect('StageUnpremultiply', unpremultiply, { blendFunction: BlendFunction.SRC }),
  new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
  new Effect('StagePremultiply', premultiply, { blendFunction: BlendFunction.SRC }),
 ));
 composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.ULTRA })));
 // SMAA filters premultiplied color and alpha together; only the final pass
 // encodes sRGB, then restores premultiplication for browser compositing.
 composer.addPass(createAlphaOutputPass());
 return {
  // Called only after the viewport updates the renderer's drawing buffer/DPR.
  // The composer reads that DPR for all intermediate targets without resizing the canvas again.
  setSize(width: number, height: number) { composer.setSize(width, height, false); },
  render(delta: number) { composer.render(delta); },
  dispose() { composer.dispose(); },
 };
}
