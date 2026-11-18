import { computed,ref,watch } from 'vue';
import { useApp } from '../store';
import { usePlaybackMode } from '../usePlaybackMode';
import { modalDepth } from '../useDialogFocus';
import * as bridge from '../bridge';
/** Shared domain controller: desktop and APK must use the same request/permission flow. */
export function usePlayerControls(){
const playbackMode=usePlaybackMode();
const app=useApp(), volume=ref(1), seek=ref<number|null>(null);
const expanded=ref(false);
watch(()=>app.room?.id,()=>{expanded.value=false;});
watch(modalDepth,depth=>{if(depth)expanded.value=false;});
const track=computed(()=>app.room?.playlist.find(t=>t.id===app.room?.playback.sourceId));
const favoriteReference=computed(()=>bridge.favoriteTrackReference(track.value));
const blocked=computed(()=>!app.connected||!!app.room?.pending||!!app.pendingActions);
const maximum=computed(()=>Math.max(0,(track.value?.durationMs??1)-1));
const progress=computed(()=>seek.value??Math.min(app.room?.pending?.playback.positionMs??app.progress,maximum.value));
const format=(ms:number)=>`${Math.floor(ms/60000).toString().padStart(2,'0')}:${Math.floor(ms/1000%60).toString().padStart(2,'0')}`;
watch(()=>app.room?.playback.sourceEpoch,()=>{seek.value=null;});
async function commit(event:Event){const positionMs=Math.min(maximum.value,Math.max(0,Math.round(seek.value??Number((event.target as HTMLInputElement).value))));if(!blocked.value&&track.value&&app.permission.seek)await app.act({type:'seek',payload:{positionMs}});seek.value=null;}

async function control(type:'previous'|'next'|'stop'|'pause'|'resume'){
 if(!app.room||!app.connected||!app.permission.skip||app.pendingActions)return;
 if(type!=='stop'&&blocked.value)return;
 if((type==='pause'||type==='resume')&&!track.value)return;
 return app.act({type,payload:{}});
}
function togglePlayback(){return control(app.room?.playback.playState==='playing'?'pause':'resume');}

return { playbackMode,app,volume,seek,expanded,track,favoriteReference,blocked,maximum,progress,format,commit,control,togglePlayback };
}
