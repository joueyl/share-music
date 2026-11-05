export function resolveRuntimeProfile(platform:string,arch=''){
 // Retina supersampling + MSAA is costly in WKWebView, including Apple Silicon.
 const mac=/mac|darwin/i.test(platform),audioPriority=mac;
 return {name:audioPriority?'audio-priority':'high',audioAnalysis:!audioPriority,
  supersampling:audioPriority?1.5:2,maxPixelRatio:Infinity,
  pixelBudget:Infinity,maxSamples:audioPriority?2:Infinity,
  maxFps:60,shadowSize:audioPriority?1024:2048,preserveDrawingBuffer:!audioPriority};
}
let profile=resolveRuntimeProfile(typeof navigator==='undefined'?'':navigator.platform);
export function configureRuntimeProfile(platform?:string,arch?:string){
 profile=resolveRuntimeProfile(platform??(typeof navigator==='undefined'?'':navigator.platform),arch);return profile;
}
export function getRuntimeProfile(){return profile;}
/** Preserve the original 60fps easing speed when GPU frames are decimated. */
export function stageAnimationBlend(delta:number){
 return Number.isFinite(delta)?1-Math.pow(0.92,Math.max(0,Math.min(delta,0.05))*60):0;
}
/** Decimate GPU frames, not the HTML Audio clock or shared room time. */
export function createStageFrameLimiter(maxFps=getRuntimeProfile().maxFps){
 let previous=-Infinity;
 return {ready(now:number){const interval=1000/maxFps;if(now-previous+0.1<interval)return false;previous=now;return true;},reset(){previous=-Infinity;}};
}
