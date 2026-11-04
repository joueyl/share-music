import { computed, ref } from 'vue';
import { PLAYBACK_MODE_LABELS, playbackModeSchema, type PlaybackMode } from '@music-share/shared';
import { useApp } from './store';

export function usePlaybackMode() {
 const app=useApp(),changing=ref(false);
 const mode=computed(()=>app.room?.playbackMode);
 const label=computed(()=>mode.value?PLAYBACK_MODE_LABELS[mode.value]:'播放模式（请更新服务端）');
 const disabled=computed(()=>!mode.value||!app.connected||!app.permission.playbackMode||!!app.room?.pending||!!app.pendingActions||changing.value);
 async function change(value:string) {
  const parsed=playbackModeSchema.safeParse(value);
  if(disabled.value||!parsed.success||parsed.data===mode.value)return;
  changing.value=true;
  try{await app.act({type:'playbackMode',payload:{mode:parsed.data}});}finally{changing.value=false;}
 }
 function cycle(){const modes:PlaybackMode[]=['queue','shuffle','single','loop'];void change(modes[(modes.indexOf(mode.value??'queue')+1)%modes.length]!);}
 return {mode,label,disabled,change,cycle};
}
