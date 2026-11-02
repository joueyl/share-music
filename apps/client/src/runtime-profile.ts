export function resolveRuntimeProfile(platform:string,arch=''){
 const mac=/mac|darwin/i.test(platform),audioPriority=mac&&arch!=='aarch64'&&arch!=='arm64';
 return {name:audioPriority?'audio-priority':'high',audioAnalysis:!audioPriority,
  supersampling:audioPriority?1:2,maxPixelRatio:audioPriority?1.5:Infinity,
  pixelBudget:audioPriority?1500000:Infinity,maxSamples:audioPriority?0:Infinity,
  maxFps:audioPriority?30:60,shadowSize:audioPriority?1024:2048,preserveDrawingBuffer:!audioPriority};
}
let profile=resolveRuntimeProfile(typeof navigator==='undefined'?'':navigator.platform);
export function configureRuntimeProfile(platform?:string,arch?:string){
 profile=resolveRuntimeProfile(platform??(typeof navigator==='undefined'?'':navigator.platform),arch);return profile;
}
export function getRuntimeProfile(){return profile;}
/** Decimate GPU frames, not the HTML Audio clock or shared room time. */
export function createStageFrameLimiter(maxFps=getRuntimeProfile().maxFps){
 let previous=-Infinity;
 return {ready(now:number){const interval=1000/maxFps;if(now-previous+0.1<interval)return false;previous=now;return true;},reset(){previous=-Infinity;}};
}
