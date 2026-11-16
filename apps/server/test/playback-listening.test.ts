import { expect,it,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { RoomEngine,type PlaybackListeningEvent } from '../src/engine';
import type { Action,TrackMetadata } from '../../../packages/shared/src';

function fixture(){
 let now=100000;const observed=vi.fn<(event:PlaybackListeningEvent)=>void>(),host={id:randomUUID(),name:'host'};
 const engine=new RoomEngine(undefined,undefined,()=>now,undefined,undefined,observed),id=engine.create('room',host.id).id;engine.join(id,host);
 const snapshot=()=>engine.snapshot(id),command=(action:Action)=>({roomId:id,commandId:randomUUID(),expectedStateVersion:snapshot().stateVersion,action});
 const cmd=(action:Action)=>engine.command(host.id,command(action));
 const track:TrackMetadata={id:randomUUID(),name:'song',neteaseId:'42',ossKey:`music/${host.id}/${randomUUID()}`,durationMs:20000,sizeBytes:1000,lossless:false,bitrateBps:128000,contentHash:'a'.repeat(64)};
 cmd({type:'enqueue',payload:track});
 const commit=()=>{const p=snapshot().pending!;engine.ready(id,host.id,p.id,p.playback.sourceEpoch);now+=200;engine.tick();};
 const play=()=>{cmd({type:'play',payload:{trackId:track.id}});commit();};
 const counters=new Map<number,number>();
 const step=(ms:number,position?:number,user=host.id)=>{now+=ms;const state=snapshot(),p=state.playback,next=position??p.positionMs+ms;
  const measured=(counters.get(p.sourceEpoch)??0)+(!state.pending&&p.playState==='playing'?Math.min(ms,Math.max(0,next-p.positionMs)):0);counters.set(p.sourceEpoch,measured);
  engine.reportProgress(id,user,p.sourceEpoch,next,now,measured);};
 const finishes=()=>observed.mock.calls.map(([event])=>event).filter(event=>event.type==='finish');
 const starts=()=>observed.mock.calls.map(([event])=>event).filter(event=>event.type==='start');
 const stop=()=>cmd({type:'stop',payload:{}});
 return {engine,id,host,track,observed,snapshot,cmd,command,commit,play,step,stop,finishes,starts,time:(value:number)=>now=value,now:()=>now};
}
it('reports only confirmed Audio progress at stop and deduplicates repeated commands',()=>{
 const f=fixture();f.play();expect(f.finishes()).toEqual([]);f.step(1000);f.step(1200);
 const command=f.command({type:'stop',payload:{}});f.engine.command(f.host.id,command);f.engine.command(f.host.id,command);f.engine.tick();
 expect(f.finishes()).toEqual([expect.objectContaining({track:expect.objectContaining({neteaseId:'42'}),listenedMs:2200})]);
});
it('never counts server-clock progress without Audio samples, including natural completion',()=>{
 const f=fixture();f.play();f.time(f.now()+f.track.durationMs);f.engine.tick();
 expect(f.finishes()).toEqual([expect.objectContaining({listenedMs:0})]);
});
it('counts playback before and after a seek, not the skipped track position',()=>{
 const f=fixture();f.play();f.step(1000);f.cmd({type:'seek',payload:{positionMs:15000}});f.commit();f.step(1000);f.stop();
 expect(f.finishes()).toEqual([expect.objectContaining({listenedMs:2000})]);expect(f.starts()).toHaveLength(1);
});
it('does not count paused time, preparation time or quality resynchronization as listening',()=>{
 const f=fixture();f.play();f.step(1000);f.cmd({type:'pause',payload:{}});f.commit();f.step(10000);
 f.cmd({type:'resume',payload:{}});f.commit();f.step(1000);
 f.cmd({type:'quality',payload:{qualityMode:'source'}});f.step(2000);f.commit();f.step(1000);f.stop();
 expect(f.finishes()).toEqual([expect.objectContaining({listenedMs:3000})]);expect(f.starts()).toHaveLength(1);
});
it('does not count stalls, missing telemetry, repeated samples or out-of-order timestamps',()=>{
 const f=fixture();f.play();f.step(1000,0);f.step(1000,1000);
 const p=f.snapshot().playback;f.engine.reportProgress(f.id,f.host.id,p.sourceEpoch,1000,f.now(),1000);
 f.engine.reportProgress(f.id,f.host.id,p.sourceEpoch,500,f.now()-500,500);
 f.step(6000,7000);f.step(1000,8000);f.stop();
 expect(f.finishes()).toEqual([expect.objectContaining({listenedMs:2000})]);
});
it('bounds counted progress by elapsed time, not a forward position jump',()=>{
 const f=fixture();f.play();f.step(1000,4000);f.stop();expect(f.finishes()[0].listenedMs).toBe(1000);
});
it('accepts only the current leader and epoch, with no member-count multiplier',()=>{
 const f=fixture(),member={id:randomUUID(),name:'member'};f.engine.join(f.id,member);f.play();
 f.step(1000,1000,member.id);expect(f.snapshot().playback.positionMs).toBe(0);
 f.engine.reportProgress(f.id,f.host.id,f.snapshot().playback.sourceEpoch-1,1000,f.now(),1000);
 f.engine.reportProgress(f.id,f.host.id,f.snapshot().playback.sourceEpoch,1000,f.now(),1000);f.stop();
 expect(f.finishes()[0].listenedMs).toBe(1000);
});
it('ends a session when the room becomes empty and never backfills the offline gap on rejoin',()=>{
 const f=fixture();f.play();f.step(2000);f.engine.leave(f.id,f.host.id);expect(f.finishes()[0].listenedMs).toBe(2000);
 f.time(f.now()+5000);f.engine.join(f.id,f.host);f.step(1000,8000);f.step(1000,9000);f.stop();
 expect(f.finishes().map(event=>event.listenedMs)).toEqual([2000,1000]);
});
it('does not count a leader handoff gap or create a second song session',()=>{
 const f=fixture(),member={id:randomUUID(),name:'member'};f.engine.join(f.id,member);f.play();f.step(1000);
 f.engine.leave(f.id,f.host.id);f.step(1000,2000,member.id);f.step(1000,3000,member.id);
 f.engine.leave(f.id,member.id);expect(f.finishes()[0].listenedMs).toBe(2000);expect(f.starts()).toHaveLength(1);
});
it('ends the old song once the next song commits, keeping preparation out of both totals',()=>{
 const f=fixture(),second={...f.track,id:randomUUID(),neteaseId:'43'};f.cmd({type:'enqueue',payload:second});f.play();f.step(2000);
 f.cmd({type:'next',payload:{}});f.step(3000);expect(f.finishes()).toEqual([]);f.commit();f.step(1000);f.stop();
 expect(f.finishes().map(event=>[event.track.neteaseId,event.listenedMs])).toEqual([['42',2000],['43',1000]]);
});
it('finishes natural playback before queue removal and treats each single-loop play as a new session',()=>{
 const f=fixture();f.cmd({type:'playbackMode',payload:{mode:'single'}});f.play();
 for(let i=0;i<20;i++)f.step(1000);f.engine.tick();expect(f.finishes()[0].listenedMs).toBe(20000);
 f.commit();f.step(1000);f.stop();expect(f.finishes().map(event=>event.listenedMs)).toEqual([20000,1000]);
 expect(new Set(f.starts().map(event=>event.id)).size).toBe(2);
});
it('failed preparation, cancelled playback and empty-room commit do not invent listening',()=>{
 const f=fixture();f.cmd({type:'play',payload:{trackId:f.track.id}});f.stop();expect(f.observed).not.toHaveBeenCalled();
 f.cmd({type:'play',payload:{trackId:f.track.id}});let p=f.snapshot().pending!;f.engine.sourceFailed(f.id,f.host.id,p.playback.sourceEpoch);expect(f.observed).not.toHaveBeenCalled();
 f.cmd({type:'play',payload:{trackId:f.track.id}});p=f.snapshot().pending!;f.engine.ready(f.id,f.host.id,p.id,p.playback.sourceEpoch);f.engine.leave(f.id,f.host.id);f.time(p.playback.effectiveAtServerMs+200);f.engine.tick();expect(f.observed).not.toHaveBeenCalled();
});
it('source failure ends only the already confirmed listening and optional observers cannot break playback',()=>{
 const f=fixture();f.play();f.step(1000);f.engine.sourceFailed(f.id,f.host.id,f.snapshot().playback.sourceEpoch);
 expect(f.finishes()[0].listenedMs).toBe(1000);
 const other=fixture();other.observed.mockImplementation(()=>{throw Error('background failure');});expect(()=>other.play()).not.toThrow();other.step(1000);expect(()=>other.stop()).not.toThrow();
});
it('does not credit legacy position-only progress or buffered timeline catch-up without measured Audio time',()=>{
 const f=fixture();f.play();const epoch=f.snapshot().playback.sourceEpoch;
 f.time(f.now()+1000);f.engine.reportProgress(f.id,f.host.id,epoch,1000,f.now());
 f.time(f.now()+1000);f.engine.reportProgress(f.id,f.host.id,epoch,2000,f.now(),0);
 f.time(f.now()+1000);f.engine.reportProgress(f.id,f.host.id,epoch,3000,f.now(),0);
 f.stop();expect(f.finishes()[0].listenedMs).toBe(0);
});
