import { afterEach, expect, it } from 'vitest';
import { configureRuntimeProfile, createStageFrameLimiter, resolveRuntimeProfile, stageAnimationBlend } from '../src/runtime-profile';
import { stagePixelRatio, stageRendererOptions } from '../src/stage-viewport';
afterEach(()=>configureRuntimeProfile('windows','x86_64'));
it('prioritizes smooth native audio and bounded GPU load on every Mac architecture',()=>{
 expect(resolveRuntimeProfile('macos','x86_64')).toMatchObject({name:'audio-priority',audioAnalysis:false,maxSamples:2,maxFps:60});
 expect(resolveRuntimeProfile('MacIntel')).toMatchObject({name:'audio-priority'});
 for(const arch of ['aarch64','arm64','x86_64',''])expect(resolveRuntimeProfile('macos',arch)).toMatchObject({name:'audio-priority',audioAnalysis:false,supersampling:1.5,maxPixelRatio:Infinity,pixelBudget:Infinity,maxSamples:2,maxFps:60,shadowSize:1024,preserveDrawingBuffer:false});
 expect(resolveRuntimeProfile('windows','x86_64').name).toBe('high');
 expect(resolveRuntimeProfile('linux','aarch64').name).toBe('high');
});
it('uses 1.5x native supersampling on Macs with GPU dimension limits and no preserved buffer',()=>{
 for(const arch of ['x86_64','aarch64','arm64']){
 configureRuntimeProfile('macos',arch);
 for(const dpr of [1,1.5,2,3])expect(stagePixelRatio(500,400,dpr,16384)).toBe(dpr*1.5);
 expect(stagePixelRatio(2000,1000,2,16384)).toBe(3);
 expect(stagePixelRatio(1000,500,2,1024)).toBe(1.024);
 }
 expect(stageRendererOptions().preserveDrawingBuffer).toBe(false);
 configureRuntimeProfile('windows','x86_64');expect(stageRendererOptions().preserveDrawingBuffer).toBe(true);expect(stagePixelRatio(500,400,2,16384)).toBe(4);
});
it('renders at 60fps rather than 30fps for every Mac profile',()=>{
 for(const arch of ['x86_64','aarch64','arm64','']){
  configureRuntimeProfile('macos',arch);const limiter=createStageFrameLimiter();let rendered=0;
  for(let i=0;i<120;i++)if(limiter.ready(i*1000/120))rendered++;
  expect(rendered).toBe(60);
 }
});
it('keeps iPod easing independent of frame rate without jumps after resuming',()=>{
 const positions=[30,60,120].map(fps=>{let value=0;for(let i=0;i<fps;i++)value+=(1-value)*stageAnimationBlend(1/fps);return value;});
 expect(positions[0]).toBeCloseTo(positions[1],12);expect(positions[1]).toBeCloseTo(positions[2],12);
 expect(stageAnimationBlend(1)).toBe(stageAnimationBlend(0.05));
 for(const delta of [NaN,Infinity,-1,0])expect(stageAnimationBlend(delta)).toBe(0);
});
it('limits GPU work to 30/60 fps without altering audio time and can resume immediately',()=>{
 for(const fps of [30,60]){const limiter=createStageFrameLimiter(fps);let rendered=0;for(let i=0;i<120;i++)if(limiter.ready(i*1000/120))rendered++;expect(rendered).toBe(fps);limiter.reset();expect(limiter.ready(1000)).toBe(true);}
});
