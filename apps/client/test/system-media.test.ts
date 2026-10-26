import { expect,it } from 'vitest';
import type { RoomSnapshot } from '@music-share/shared';
import { systemMediaAction,systemMediaState,type SystemMediaEvent } from '../src/system-media';
function room():RoomSnapshot{return {
 id:'room',hostId:'host',members:[{id:'member',permissions:{skip:false,seek:false,enqueue:true,stream:false}}],
 playlist:[{id:'song',name:'当前歌曲',durationMs:120000}],pending:null,
 playback:{sourceId:'song',sourceEpoch:7,playState:'playing',positionMs:10000,effectiveAtServerMs:100000},
} as RoomSnapshot;}
const event=(action:SystemMediaEvent['action']):SystemMediaEvent=>({action,roomId:'room',trackId:'song',sourceEpoch:7});
it('publishes the actual room song, playback status, duration and server-adjusted progress',()=>{
 expect(systemMediaState(room(),'host',true,1000,101000)).toEqual({roomId:'room',trackId:'song',sourceEpoch:7,title:'当前歌曲',playback:'playing',durationMs:120000,positionMs:12000,canControl:true,canSeek:true});
});
it('routes toggle, pause, next and previous through room actions',()=>{
 const r=room();expect(systemMediaAction(event('toggle'),r,'host',true)).toEqual({type:'pause',payload:{}});
 expect(systemMediaAction(event('play'),r,'host',true)).toBeNull();
 r.playback.playState='paused';expect(systemMediaAction(event('toggle'),r,'host',true)).toEqual({type:'resume',payload:{}});
 expect(systemMediaAction(event('pause'),r,'host',true)).toBeNull();
 for(const type of ['next','previous','stop'] as const)expect(systemMediaAction(event(type),r,'host',true)).toEqual({type,payload:{}});
});
it('blocks members without permission and disables taskbar controls during pending/disconnected states',()=>{
 const r=room();expect(systemMediaState(r,'member',true,0).canControl).toBe(false);
 expect(systemMediaAction(event('toggle'),r,'member',true)).toBeNull();
 expect(systemMediaAction(event('toggle'),r,'host',false)).toBeNull();
 r.pending={} as RoomSnapshot['pending'];expect(systemMediaState(r,'host',true,0).canControl).toBe(false);
 expect(systemMediaAction(event('toggle'),r,'host',true)).toBeNull();
});
it('drops stale room, track and epoch callbacks after changing songs or leaving',()=>{
 const r=room();
 for(const patch of [{roomId:'other'},{trackId:'old'},{sourceEpoch:6}])expect(systemMediaAction({...event('toggle'),...patch},r,'host',true)).toBeNull();
 expect(systemMediaAction(event('toggle'),null,'host',true)).toBeNull();
 expect(systemMediaState(null,null,false,0).playback).toBe('stopped');
});
it('honors seek permission independently and clamps OS seek positions',()=>{
 const r=room();expect(systemMediaAction({...event('seek'),positionMs:999999},r,'host',true)).toEqual({type:'seek',payload:{positionMs:119999}});
 expect(systemMediaAction({...event('seek'),positionMs:-1000},r,'host',true)).toEqual({type:'seek',payload:{positionMs:0}});
 expect(systemMediaAction({...event('seek'),positionMs:NaN},r,'host',true)).toBeNull();
 expect(systemMediaAction({...event('seek'),positionMs:1000},r,'member',true)).toBeNull();
});
