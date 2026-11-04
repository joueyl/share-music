import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { RoomEngine, type RoomRecord } from '../src/engine';
import { Database } from '../src/database';
import { commandSchema, type Action, type PlaybackMode, type TrackMetadata } from '../../../packages/shared/src';

function setup(mode:PlaybackMode='queue',count=4) {
 let now=100000;
 const saved:RoomRecord[]=[];
 const engine=new RoomEngine(record=>saved.push(structuredClone(record)),undefined,()=>now);
 const host={id:randomUUID(),name:'host'},member={id:randomUUID(),name:'member'};
 const room=engine.create('modes',host.id);engine.join(room.id,host);engine.join(room.id,member);
 const snapshot=()=>engine.snapshot(room.id);
 const cmd=(action:Action,user=host.id)=>engine.command(user,{roomId:room.id,commandId:randomUUID(),expectedStateVersion:snapshot().stateVersion,action});
 const tracks:TrackMetadata[]=Array.from({length:count},(_,i)=>({id:randomUUID(),name:`song-${i}`,durationMs:10000,sizeBytes:1000,lossless:false,bitrateBps:128000,contentHash:'a'.repeat(64),ossKey:`music/${host.id}/${randomUUID()}`}));
 for(const t of tracks)cmd({type:'enqueue',payload:t});
 cmd({type:'playbackMode',payload:{mode}});
 const commit=()=>{const p=snapshot().pending!;engine.ready(room.id,host.id,p.id,p.playback.sourceEpoch);now+=200;engine.tick();};
 const play=(id=tracks[0].id)=>{cmd({type:'play',payload:{trackId:id}});commit();};
 const finish=()=>{const p=snapshot().playback;now=p.effectiveAtServerMs+tracks[0].durationMs;engine.tick();};
 return {engine,host,member,room,tracks,saved,snapshot,cmd,commit,play,finish};
}
it('validates only the four strict playback modes',()=>{
 for(const mode of ['queue','shuffle','single','loop'])expect(commandSchema.safeParse({type:'playbackMode',payload:{mode}}).success).toBe(true);
 for(const payload of [{mode:'random'},{mode:'loop',extra:true},{}])expect(commandSchema.safeParse({type:'playbackMode',payload}).success).toBe(false);
});
it('queue mode removes completed songs durably and drains in list order without looping',()=>{
 const s=setup();s.play();
 for(let i=0;i<s.tracks.length;i++){
  const current=s.snapshot().playback.sourceId;s.finish();
  expect(s.snapshot().playlist.some(t=>t.id===current)).toBe(false);
  expect(s.saved.at(-1)!.playlist!.map(t=>t.id)).toEqual(s.tracks.slice(i+1).map(t=>t.id));
  if(i<s.tracks.length-1){expect(s.snapshot().pending!.playback.sourceId).toBe(s.tracks[i+1].id);s.commit();}
 }
 expect(s.snapshot()).toMatchObject({playlist:[],pending:null,playback:{sourceId:null,playState:'stopped'}});
});
it('queue mode respects reordering, and skipping/stopping/pausing never removes unfinished songs',()=>{
 const s=setup();s.play();s.cmd({type:'reorder',payload:{trackIds:[s.tracks[2].id,s.tracks[0].id,s.tracks[3].id,s.tracks[1].id]}});
 s.cmd({type:'pause',payload:{}});s.commit();expect(s.snapshot().playlist).toHaveLength(4);
 s.cmd({type:'resume',payload:{}});s.commit();s.finish();expect(s.snapshot().pending!.playback.sourceId).toBe(s.tracks[3].id);s.commit();
 s.cmd({type:'next',payload:{}});s.commit();expect(s.snapshot().playlist).toHaveLength(3);
 s.cmd({type:'stop',payload:{}});expect(s.snapshot().playlist).toHaveLength(3);
});
it('list loop wraps to the first song after the last, with no deletion',()=>{
 const s=setup('loop',3);s.play();
 for(let i=1;i<=6;i++){s.finish();expect(s.snapshot().pending!.playback.sourceId).toBe(s.tracks[i%3].id);s.commit();}
 expect(s.snapshot().playlist).toHaveLength(3);
});
it('single repeat restarts the current song but manual next still changes tracks',()=>{
 const s=setup('single');s.play();const before=s.snapshot().playback;
 s.finish();expect(s.snapshot().pending!.playback).toMatchObject({sourceId:before.sourceId,positionMs:0,playState:'playing'});s.commit();
 expect(s.snapshot().playback.sourceEpoch).toBeGreaterThan(before.sourceEpoch);
 s.cmd({type:'next',payload:{}});expect(s.snapshot().pending!.playback.sourceId).toBe(s.tracks[1].id);s.commit();
 expect(s.snapshot().playlist).toHaveLength(4);
});
it('shuffle plays every song exactly once per round across several rounds, including manual next',()=>{
 const s=setup('shuffle',8);s.play();
 for(let round=0;round<4;round++){
  const heard:string[]=[];
  for(let i=0;i<8;i++){
   heard.push(s.snapshot().playback.sourceId!);
   if(i%2)s.cmd({type:'next',payload:{}});else s.finish();
   s.commit();
  }
  expect(new Set(heard).size).toBe(8);expect([...heard].sort()).toEqual(s.tracks.map(t=>t.id).sort());
 }
 expect(s.snapshot().playlist).toHaveLength(8);
});
it('shuffle includes newly added tracks and preserves the round across reorder and pause/resume',()=>{
 const s=setup('shuffle',4);s.play();s.finish();s.commit();
 const heard=[s.tracks[0].id,s.snapshot().playback.sourceId!];
 s.cmd({type:'pause',payload:{}});s.commit();s.cmd({type:'resume',payload:{}});s.commit();
 s.cmd({type:'reorder',payload:{trackIds:s.tracks.map(t=>t.id).reverse()}});
 const extra={...s.tracks[0],id:randomUUID(),name:'extra'};s.cmd({type:'enqueue',payload:extra});
 for(let i=0;i<3;i++){s.finish();s.commit();heard.push(s.snapshot().playback.sourceId!);}
 expect(new Set(heard).size).toBe(5);expect(heard).toContain(extra.id);
});
it.each(['queue','shuffle','single','loop'] as const)('handles a single song in %s mode',mode=>{
 const s=setup(mode,1);s.play();s.finish();
 if(mode==='queue')expect(s.snapshot()).toMatchObject({playlist:[],pending:null,playback:{playState:'stopped'}});
 else {expect(s.snapshot().pending!.playback.sourceId).toBe(s.tracks[0].id);s.commit();}
});
it('empty shuffle cannot create a fake pending track',()=>{
 const s=setup('shuffle',0);s.cmd({type:'next',payload:{}});expect(s.snapshot().pending).toBeNull();expect(s.snapshot().playback.playState).toBe('stopped');
});
it('mode changes are authorized, versioned, deduplicated, persistent and do not reset playback',()=>{
 const s=setup('loop');s.play();const before=s.snapshot().playback;
 s.cmd({type:'permission',payload:{memberId:s.member.id,overrides:{playbackMode:false}}});
 expect(()=>s.cmd({type:'playbackMode',payload:{mode:'shuffle'}},s.member.id)).toThrow('FORBIDDEN');
 s.cmd({type:'permission',payload:{memberId:s.member.id,overrides:{playbackMode:true}}});
 const command={roomId:s.room.id,commandId:randomUUID(),expectedStateVersion:s.snapshot().stateVersion,action:{type:'playbackMode' as const,payload:{mode:'shuffle' as const}}};
 const result=s.engine.command(s.member.id,command);expect(s.engine.command(s.member.id,command)).toBe(result);
 expect(()=>s.engine.command(s.member.id,{...command,commandId:randomUUID()})).toThrow('STATE_CONFLICT');
 expect(s.snapshot().playback).toEqual(before);expect(s.snapshot().pending).toBeNull();
 const db=new Database(':memory:');db.saveRoom(s.saved.at(-1)!);const records=db.rooms();
 const restored=new RoomEngine();restored.restore(records);expect(restored.snapshot(s.room.id).playbackMode).toBe('shuffle');db.db.close();
 s.cmd({type:'next',payload:{}});expect(()=>s.cmd({type:'playbackMode',payload:{mode:'single'}})).toThrow('PLAYBACK_TRANSITION_PENDING');
});
it('deleted shuffle songs never return, and clear does not resurrect removed entries',()=>{
 const s=setup('shuffle');s.play();s.cmd({type:'remove',payload:{trackId:s.tracks[1].id}});
 const heard=[s.tracks[0].id];for(let i=0;i<2;i++){s.finish();s.commit();heard.push(s.snapshot().playback.sourceId!);}
 expect(new Set(heard).size).toBe(3);expect(heard).not.toContain(s.tracks[1].id);
 s.cmd({type:'clear',payload:{}});s.finish();s.commit();expect(s.snapshot().playlist).toHaveLength(1);
});

it('a failed next-song preparation after queue completion does not leave deleted playback active',()=>{
 const s=setup();s.play();s.finish();const pending=s.snapshot().pending!;
 s.engine.sourceFailed(s.room.id,s.host.id,pending.playback.sourceEpoch);
 expect(s.snapshot()).toMatchObject({pending:null,playback:{sourceId:null,playState:'stopped'}});
 expect(s.snapshot().playlist).toHaveLength(3);
});
it('shuffle does not consume a failed or stopped preparation and skips unavailable songs',()=>{
 const s=setup('shuffle',3);s.play();
 s.cmd({type:'play',payload:{trackId:s.tracks[1].id}});const pending=s.snapshot().pending!;
 s.engine.sourceFailed(s.room.id,s.host.id,pending.playback.sourceEpoch);
 s.cmd({type:'reorder',payload:{trackIds:s.tracks.map(t=>t.id).reverse()}});
 const heard=[s.tracks[0].id];for(let i=0;i<2;i++){s.cmd({type:'next',payload:{}});s.commit();heard.push(s.snapshot().playback.sourceId!);}
 expect(new Set(heard).size).toBe(3);
 const current=s.snapshot().playback;s.engine.sourceFailed(s.room.id,s.host.id,current.sourceEpoch);
 expect(s.snapshot().pending!.playback.sourceId).not.toBe(current.sourceId);
});

it('mode modification is independent of both playback and playlist control',()=>{
 const s=setup('loop');s.play();
 s.cmd({type:'permission',payload:{memberId:s.member.id,overrides:{playbackMode:false,skip:true,enqueue:true}}});
 expect(()=>s.cmd({type:'playbackMode',payload:{mode:'single'}},s.member.id)).toThrow('FORBIDDEN');
 s.cmd({type:'pause',payload:{}},s.member.id);s.commit();
 s.cmd({type:'permission',payload:{memberId:s.member.id,overrides:{playbackMode:true,skip:false,enqueue:false}}});
 s.cmd({type:'playbackMode',payload:{mode:'shuffle'}},s.member.id);expect(s.snapshot().playbackMode).toBe('shuffle');
 expect(()=>s.cmd({type:'resume',payload:{}},s.member.id)).toThrow('FORBIDDEN');
 expect(()=>s.cmd({type:'clear',payload:{}},s.member.id)).toThrow('FORBIDDEN');
});
it('mode default, member allow/deny/follow-room and persisted overrides are enforced',()=>{
 const s=setup('loop');s.cmd({type:'defaults',payload:{...s.snapshot().defaults,playbackMode:false}});
 expect(()=>s.cmd({type:'playbackMode',payload:{mode:'single'}},s.member.id)).toThrow('FORBIDDEN');
 s.cmd({type:'permission',payload:{memberId:s.member.id,overrides:{playbackMode:true}}});
 s.cmd({type:'playbackMode',payload:{mode:'single'}},s.member.id);
 const records=[s.saved.at(-1)!],restored=new RoomEngine();restored.restore(records);restored.restoreOverrides(records);restored.join(s.room.id,s.member);
 expect(restored.snapshot(s.room.id).members[0].permissions.playbackMode).toBe(true);
 s.cmd({type:'permission',payload:{memberId:s.member.id,overrides:{}}});
 expect(()=>s.cmd({type:'playbackMode',payload:{mode:'loop'}},s.member.id)).toThrow('FORBIDDEN');
 s.cmd({type:'playbackMode',payload:{mode:'loop'}});expect(s.snapshot().playbackMode).toBe('loop');
});
it('legacy saved defaults and member skip overrides retain their former effective mode permission',()=>{
 const s=setup();const record=structuredClone(s.saved.at(-1)!);delete record.defaults.playbackMode;record.defaults.skip=false;record.overrides={[s.member.id]:{skip:true}};
 const restored=new RoomEngine();restored.restore([record]);restored.restoreOverrides([record]);restored.join(s.room.id,s.member);
 expect(restored.snapshot(s.room.id).defaults.playbackMode).toBe(false);
 expect(restored.snapshot(s.room.id).members[0].permissions.playbackMode).toBe(true);
 expect(record.overrides[s.member.id]).toEqual({skip:true});
 const modern={...record,defaults:{...record.defaults,playbackMode:false}};const fresh=new RoomEngine();fresh.restore([modern]);fresh.restoreOverrides([modern]);fresh.join(s.room.id,s.member);
 expect(fresh.snapshot(s.room.id).members[0].permissions.playbackMode).toBe(false);
});
it('legacy defaults requests do not silently overwrite the independent mode permission',()=>{
 const s=setup();s.cmd({type:'defaults',payload:{...s.snapshot().defaults,playbackMode:false}});
 const legacy={...s.snapshot().defaults};delete legacy.playbackMode;legacy.skip=true;
 s.cmd({type:'defaults',payload:legacy});expect(s.snapshot().defaults.playbackMode).toBe(false);
});
