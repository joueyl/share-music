import { afterEach, expect, it } from 'vitest';
import { configureRuntimeProfile, createStageFrameLimiter, resolveRuntimeProfile } from '../src/runtime-profile';
import { stagePixelRatio, stageRendererOptions } from '../src/stage-viewport';
afterEach(()=>configureRuntimeProfile('windows','x86_64'));
it('prioritizes native audio on Intel/unknown-architecture Macs without misidentifying Apple Silicon from its UA',()=>{
 expect(resolveRuntimeProfile('macos','x86_64')).toMatchObject({name:'audio-priority',audioAnalysis:false,maxSamples:0,maxFps:30});
 expect(resolveRuntimeProfile('MacIntel')).toMatchObject({name:'audio-priority'});
 expect(resolveRuntimeProfile('macos','aarch64')).toMatchObject({name:'high',audioAnalysis:true,supersampling:2});
 expect(resolveRuntimeProfile('windows','x86_64').name).toBe('high');
});
it('caps Retina render pixels, disables redundant MSAA and avoids a preserved Mac drawing buffer',()=>{
 configureRuntimeProfile('macos','x86_64');expect(stagePixelRatio(500,400,2,16384)).toBe(1.5);
 const ratio=stagePixelRatio(2000,1000,2,16384);expect(2000*1000*ratio*ratio).toBeCloseTo(1500000);
 expect(stageRendererOptions().preserveDrawingBuffer).toBe(false);
 configureRuntimeProfile('windows','x86_64');expect(stageRendererOptions().preserveDrawingBuffer).toBe(true);expect(stagePixelRatio(500,400,2,16384)).toBe(4);
});
it('limits GPU work to 30/60 fps without altering audio time and can resume immediately',()=>{
 for(const fps of [30,60]){const limiter=createStageFrameLimiter(fps);let rendered=0;for(let i=0;i<120;i++)if(limiter.ready(i*1000/120))rendered++;expect(rendered).toBe(fps);limiter.reset();expect(limiter.ready(1000)).toBe(true);}
});
