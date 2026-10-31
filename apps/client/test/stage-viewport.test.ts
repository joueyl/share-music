import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createStageViewport, STAGE_RENDERER_OPTIONS, stagePixelRatio } from '../src/stage-viewport';
let resize:()=>void,disconnect:ReturnType<typeof vi.fn>;
beforeEach(()=>{
 disconnect=vi.fn();vi.stubGlobal('window',{devicePixelRatio:1});
 vi.stubGlobal('ResizeObserver',class{constructor(callback:()=>void){resize=callback;}observe(){}disconnect=disconnect;});
});
afterEach(()=>vi.unstubAllGlobals());
function fixture(){const size={clientWidth:500,clientHeight:400},renderer={setDrawingBufferSize:vi.fn()},reframe=vi.fn();return {size,renderer,reframe,viewport:createStageViewport(renderer,size as HTMLElement,reframe)};}
it('retains the transparent frame when native window dragging pauses animation',()=>{
 expect(STAGE_RENDERER_OPTIONS).toMatchObject({alpha:true,preserveDrawingBuffer:true,antialias:true});
});
it('does not reset the backing buffer when the window moves or an unchanged resize notification arrives',()=>{
 const {viewport,renderer,reframe}=fixture();viewport.sync();
 for(let i=0;i<10;i++){resize();viewport.sync();}
 expect(renderer.setDrawingBufferSize).toHaveBeenCalledExactlyOnceWith(500,400,1);expect(reframe).toHaveBeenCalledOnce();
});
it('coalesces resize callbacks and updates buffer and camera together on the next render',()=>{
 const {size,viewport,renderer,reframe}=fixture();viewport.sync();renderer.setDrawingBufferSize.mockClear();reframe.mockClear();
 size.clientWidth=510;resize();size.clientWidth=520;resize();
 expect(renderer.setDrawingBufferSize).not.toHaveBeenCalled();viewport.sync();
 expect(renderer.setDrawingBufferSize).toHaveBeenCalledExactlyOnceWith(520,400,1);expect(reframe).toHaveBeenCalledExactlyOnceWith(520,400);
});
it('follows native monitor DPR changes without a size callback',()=>{
 const {viewport,renderer}=fixture();viewport.sync();window.devicePixelRatio=1.75;viewport.sync();window.devicePixelRatio=3;viewport.sync();window.devicePixelRatio=4;viewport.sync();
 expect(renderer.setDrawingBufferSize.mock.calls).toEqual([[500,400,1],[500,400,1.75],[500,400,3],[500,400,4]]);
});
it('retains the last nonzero frame while hidden and stops resizing after disposal',()=>{
 const {size,viewport,renderer}=fixture();viewport.sync();size.clientWidth=0;resize();viewport.sync();expect(renderer.setDrawingBufferSize).toHaveBeenCalledOnce();
 size.clientWidth=600;resize();viewport.sync();expect(renderer.setDrawingBufferSize).toHaveBeenLastCalledWith(600,400,1);
 viewport.dispose();size.clientWidth=700;resize();viewport.sync();expect(renderer.setDrawingBufferSize).toHaveBeenCalledTimes(2);expect(disconnect).toHaveBeenCalledOnce();
});
it('uses the same guarded resize path for both models before each render',()=>{
 for(const component of ['IpodStage','TurntableStage']){
  const code=readFileSync(new URL(`../src/components/${component}.vue`,import.meta.url),'utf8');
  expect(code).toContain('new THREE.WebGLRenderer(STAGE_RENDERER_OPTIONS)');
  expect(code).toContain('renderer.outputColorSpace = THREE.SRGBColorSpace;');
  expect(code).not.toMatch(/renderer\.setSize|renderer\.setPixelRatio|new ResizeObserver/);
  expect(code.indexOf('viewport.sync()')).toBeLessThan(code.indexOf('renderer.render(scene, camera)'));
  expect(code).toContain('viewport.dispose()');
 }
});

it('renders native physical pixels without forced supersampling or a two-times cap',()=>{
 expect(stagePixelRatio(500,400,1,16384)).toBe(1);
 expect(stagePixelRatio(500,400,3,16384)).toBe(3);
 expect(stagePixelRatio(3840,2160,2,16384)).toBe(2);
 expect(stagePixelRatio(1000,500,2,1024)).toBe(1.024);
 expect(stagePixelRatio(500,400,NaN)).toBe(1);
});
it('keeps original model loaders and lighting without subdivision or new material overrides',()=>{
 for(const component of ['IpodStage','TurntableStage']){
  const code=readFileSync(new URL(`../src/components/${component}.vue`,import.meta.url),'utf8');
  expect(code).not.toMatch(/stage-lighting|stage-subdivision|stage-quality|subdivideStageModel|improveStageTextures/);
  expect(code).toContain('new THREE.DirectionalLight');
  expect(code).toContain(component==='IpodStage'?"loader.load('/ipod_model.glb'":"loader.load('/qq_music_gramophone.glb'");
  expect(code).toContain(component==='IpodStage'?'toneMappingExposure = 1.15':'toneMappingExposure = 1.12');
 }
});
