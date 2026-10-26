import { ALL_PERMISSIONS, DEFAULT_PERMISSIONS, positionAt, type Action, type RoomSnapshot } from '@music-share/shared';
export type SystemMediaState = {
  roomId:string|null; trackId:string|null; sourceEpoch:number; title:string;
  playback:'playing'|'paused'|'stopped'; durationMs:number; positionMs:number; canControl:boolean; canSeek:boolean;
};
export type SystemMediaEvent = {
  action:'play'|'pause'|'toggle'|'next'|'previous'|'stop'|'seek';
  roomId:string; trackId:string; sourceEpoch:number; positionMs?:number;
};
function permissions(room:RoomSnapshot|null,userId:string|null) {
  return room && userId && room.hostId===userId?ALL_PERMISSIONS:room?.members.find(member=>member.id===userId)?.permissions??DEFAULT_PERMISSIONS;
}
export function systemMediaState(room:RoomSnapshot|null,userId:string|null,connected:boolean,offset:number,now=Date.now()):SystemMediaState {
  const track=room?.playlist?.find(item=>item.id===room.playback.sourceId),p=permissions(room,userId);
  const available=!!room&&!!track&&connected&&!room.pending;
  return {
    roomId:room?.id??null,trackId:track?.id??null,sourceEpoch:room?.playback.sourceEpoch??0,title:track?.name??'共鸣 Music Share',
    playback:track&&connected?room!.playback.playState:'stopped',durationMs:track?.durationMs??0,
    positionMs:track&&room?Math.round(Math.max(0,Math.min(track.durationMs-1,positionAt(room.playback,now+offset)))):0,
    canControl:available&&p.skip,canSeek:available&&p.seek,
  };
}
/** OS commands are room commands, not local audio.play()/pause(). Reject stale callbacks. */
export function systemMediaAction(event:SystemMediaEvent,room:RoomSnapshot|null,userId:string|null,connected:boolean):Action|null {
  if(!room||!connected||room.pending||event.roomId!==room.id||event.trackId!==room.playback.sourceId||event.sourceEpoch!==room.playback.sourceEpoch)return null;
  const track=room.playlist?.find(item=>item.id===room.playback.sourceId);if(!track)return null;
  const p=permissions(room,userId);
  if(event.action==='seek') {
    if(!p.seek||typeof event.positionMs!=='number'||!Number.isFinite(event.positionMs))return null;
    return {type:'seek',payload:{positionMs:Math.round(Math.max(0,Math.min(track.durationMs-1,event.positionMs)))}};
  }
  if(!p.skip)return null;
  switch(event.action) {
    case 'toggle':return {type:room.playback.playState==='playing'?'pause':'resume',payload:{}};
    case 'play':return room.playback.playState==='playing'?null:{type:'resume',payload:{}};
    case 'pause':return room.playback.playState==='playing'?{type:'pause',payload:{}}:null;
    case 'next':case 'previous':case 'stop':return {type:event.action,payload:{}};
    default:return null;
  }
}
