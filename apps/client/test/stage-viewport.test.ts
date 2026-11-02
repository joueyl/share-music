import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createStageViewport, STAGE_RENDERER_OPTIONS, stagePixelRatio } from '../src/stage-viewport';
import { configureRuntimeProfile } from '../src/runtime-profile';
let resize:()=>void,disconnect:ReturnType<typeof vi.fn>;
beforeEach(()=>{
 // These cases specify the high-quality profile, independently of the runner OS.
 // Mac audio-priority limits are asserted separately in runtime-profile.test.ts.
 configureRuntimeProfile('windows','x86_64');
 disconnect=vi.fn();vi.stubGlobal('window',{devicePixelRatio:1});
 vi.stubGlobal('ResizeObserver',class{constructor(callback:()=>void){resize=callback;}observe(){}disconnect=disconnect;});
});
afterEach(()=>vi.unstubAllGlobals());
function fixture(){const size={clientWidth:500,clientHeight:400},renderer={setDrawingBufferSize:vi.fn()},reframe=vi.fn();return {size,renderer,reframe,viewport:createStageViewport(renderer,size as HTMLElement,reframe)};}
it('retains the transparent frame when native window dragging pauses animation',()=>{
 expect(STAGE_RENDERER_OPTIONS).toMatchObject({alpha:true,premultipliedAlpha:true,preserveDrawingBuffer:true,antialias:false});
});
it('does not reset the backing buffer when the window moves or an unchanged resize notification arrives',()=>{
 const {viewport,renderer,reframe}=fixture();viewport.sync();
 for(let i=0;i<10;i++){resize();viewport.sync();}
 expect(renderer.setDrawingBufferSize).toHaveBeenCalledExactlyOnceWith(500,400,2);expect(reframe).toHaveBeenCalledOnce();
});
it('coalesces resize callbacks and updates buffer and camera together on the next render',()=>{
 const {size,viewport,renderer,reframe}=fixture();viewport.sync();renderer.setDrawingBufferSize.mockClear();reframe.mockClear();
 size.clientWidth=510;resize();size.clientWidth=520;resize();
 expect(renderer.setDrawingBufferSize).not.toHaveBeenCalled();viewport.sync();
 expect(renderer.setDrawingBufferSize).toHaveBeenCalledExactlyOnceWith(520,400,2);expect(reframe).toHaveBeenCalledExactlyOnceWith(520,400);
});
it('follows native monitor DPR changes without a size callback',()=>{
 const {viewport,renderer}=fixture();viewport.sync();window.devicePixelRatio=1.75;viewport.sync();window.devicePixelRatio=3;viewport.sync();window.devicePixelRatio=4;viewport.sync();
 expect(renderer.setDrawingBufferSize.mock.calls).toEqual([[500,400,2],[500,400,3.5],[500,400,6],[500,400,8]]);
});
it('retains the last nonzero frame while hidden and stops resizing after disposal',()=>{
 const {size,viewport,renderer}=fixture();viewport.sync();size.clientWidth=0;resize();viewport.sync();expect(renderer.setDrawingBufferSize).toHaveBeenCalledOnce();
 size.clientWidth=600;resize();viewport.sync();expect(renderer.setDrawingBufferSize).toHaveBeenLastCalledWith(600,400,2);
 viewport.dispose();size.clientWidth=700;resize();viewport.sync();expect(renderer.setDrawingBufferSize).toHaveBeenCalledTimes(2);expect(disconnect).toHaveBeenCalledOnce();
});
it('uses the same guarded resize path for both models before each render',()=>{
 for(const component of ['IpodStage','TurntableStage']){
  const code=readFileSync(new URL(`../src/components/${component}.vue`,import.meta.url),'utf8');
  expect(code).toContain('new THREE.WebGLRenderer(stageRendererOptions())');
  expect(code).toContain('renderer.outputColorSpace = THREE.SRGBColorSpace;');
  expect(code).not.toMatch(/renderer\.setSize|renderer\.setPixelRatio|new ResizeObserver/);
  expect(code.indexOf('viewport.sync()')).toBeLessThan(code.indexOf('postprocessing.render(delta)'));
  expect(code).toContain('postprocessing.setSize(w, h)');
  expect(code).toContain('createStagePostprocessing(renderer, scene, camera)');
  expect(code).not.toContain('renderer.render(scene, camera)');
  expect(code).not.toContain('THREE.ACESFilmicToneMapping');
  expect(code).toContain('postprocessing.dispose()');
  expect(code).toContain('viewport.dispose()');
 }
});

it('supersamples each native pixel axis by two without capping high-DPI displays',()=>{
 expect(stagePixelRatio(500,400,1,16384)).toBe(2);
 expect(stagePixelRatio(500,400,1.5,16384)).toBe(3);
 expect(stagePixelRatio(500,400,3,16384)).toBe(6);
 expect(stagePixelRatio(3840,2160,2,16384)).toBe(4);
 expect(stagePixelRatio(1000,500,2,1024)).toBe(1.024);
 expect(stagePixelRatio(500,1000,2,1024)).toBe(1.024);
 for(const dpr of [NaN,Infinity,0,-1])expect(stagePixelRatio(500,400,dpr)).toBe(2);
 expect(stagePixelRatio(0,400,2)).toBe(1);
 expect(stagePixelRatio(500,0,2)).toBe(1);
});
it('limits supersampled buffers by both texture and renderbuffer GPU dimensions',()=>{
 const size={clientWidth:1000,clientHeight:500};
 const renderer={setDrawingBufferSize:vi.fn(),capabilities:{maxTextureSize:4096},
  getContext:()=>({MAX_RENDERBUFFER_SIZE:1,getParameter:()=>1536})};
 const reframe=vi.fn();const viewport=createStageViewport(renderer,size as HTMLElement,reframe);
 window.devicePixelRatio=2;viewport.sync();
 expect(renderer.setDrawingBufferSize).toHaveBeenCalledExactlyOnceWith(1000,500,1.536);
 expect(reframe).toHaveBeenCalledExactlyOnceWith(1000,500);
 viewport.dispose();
});
it('keeps original models and direct lighting while sharing neutral metal reflections',()=>{
 for(const component of ['IpodStage','TurntableStage']){
  const code=readFileSync(new URL(`../src/components/${component}.vue`,import.meta.url),'utf8');
  expect(code).not.toMatch(/stage-lighting|stage-subdivision|stage-quality|subdivideStageModel|improveStageTextures/);
  expect(code).toContain('createStageEnvironment(renderer, scene)');
  expect(code).toContain('environment.dispose()');
  expect(code).toContain('new THREE.DirectionalLight');
  expect(code).toContain(component==='IpodStage'?"loader.load('/ipod_model.glb'":"loader.load('/qq_music_gramophone.glb'");
  expect(code).toContain(component==='IpodStage'?'toneMappingExposure = 1.15':'toneMappingExposure = 1.12');
 }
});
