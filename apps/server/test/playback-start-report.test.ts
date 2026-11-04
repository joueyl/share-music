import { expect,it,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { RoomEngine } from '../src/engine';
import type { Action,TrackMetadata } from '../../../packages/shared/src';
function fixture(){
 let now=100000;const started=vi.fn(),host={id:randomUUID(),name:'host'};
 const engine=new RoomEngine(undefined,undefined,()=>now,undefined,undefined,started),id=engine.create('room',host.id).id;engine.join(id,host);
 const snapshot=()=>engine.snapshot(id),command=(action:Action)=>({roomId:id,commandId:randomUUID(),expectedStateVersion:snapshot().stateVersion,action});
 const cmd=(action:Action)=>engine.command(host.id,command(action));
 const track:TrackMetadata={id:randomUUID(),name:'song',neteaseId:'42',ossKey:`music/${host.id}/${randomUUID()}`,durationMs:10000,sizeBytes:1000,lossless:false,bitrateBps:128000,contentHash:'a'.repeat(64)};
 cmd({type:'enqueue',payload:track});
 const commit=()=>{const p=snapshot().pending!;engine.ready(id,host.id,p.id,p.playback.sourceEpoch);now+=200;engine.tick();};
 return {engine,id,host,track,started,snapshot,cmd,command,commit,time:(value:number)=>now=value};
}
it('reports a new song at committed playback start, never at enqueue/preparation or completion',()=>{
 const f=fixture();expect(f.started).not.toHaveBeenCalled();
 const command=f.command({type:'play',payload:{trackId:f.track.id}});f.engine.command(f.host.id,command);expect(f.started).not.toHaveBeenCalled();
 f.commit();expect(f.started).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({neteaseId:'42',durationMs:10000}));
 expect(f.snapshot().playback.positionMs).toBe(0);
 f.engine.command(f.host.id,command);f.engine.tick();expect(f.started).toHaveBeenCalledOnce();
});
it('does not duplicate start reports for pause/resume/seek/quality synchronization',()=>{
 const f=fixture();f.cmd({type:'play',payload:{trackId:f.track.id}});f.commit();
 for(const action of [{type:'pause',payload:{}},{type:'resume',payload:{}},{type:'seek',payload:{positionMs:2000}},{type:'quality',payload:{qualityMode:'source'}}] as Action[]){f.cmd(action);f.commit();}
 expect(f.started).toHaveBeenCalledOnce();
});
it('single-loop playback reports each new start once, not when preparing the next repeat',()=>{
 const f=fixture();f.cmd({type:'playbackMode',payload:{mode:'single'}});f.cmd({type:'play',payload:{trackId:f.track.id}});f.commit();
 f.time(f.snapshot().playback.effectiveAtServerMs+f.track.durationMs);f.engine.tick();expect(f.started).toHaveBeenCalledOnce();
 f.commit();expect(f.started).toHaveBeenCalledTimes(2);
});
it('cancellation, failed preparation and empty rooms do not report a play',()=>{
 const f=fixture();f.cmd({type:'play',payload:{trackId:f.track.id}});f.cmd({type:'stop',payload:{}});f.engine.tick();expect(f.started).not.toHaveBeenCalled();
 f.cmd({type:'play',payload:{trackId:f.track.id}});let p=f.snapshot().pending!;f.engine.sourceFailed(f.id,f.host.id,p.playback.sourceEpoch);expect(f.started).not.toHaveBeenCalled();
 f.cmd({type:'play',payload:{trackId:f.track.id}});p=f.snapshot().pending!;f.engine.ready(f.id,f.host.id,p.id,p.playback.sourceEpoch);f.engine.leave(f.id,f.host.id);f.time(p.playback.effectiveAtServerMs+200);f.engine.tick();expect(f.started).not.toHaveBeenCalled();
});
it('an optional reporting observer cannot break the committed player state',()=>{
 const f=fixture();f.started.mockImplementation(()=>{throw Error('background failure');});
 f.cmd({type:'play',payload:{trackId:f.track.id}});expect(()=>f.commit()).not.toThrow();expect(f.snapshot().playback.sourceId).toBe(f.track.id);
});
