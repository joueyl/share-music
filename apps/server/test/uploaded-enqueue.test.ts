import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Database } from '../src/database';
import { RoomEngine } from '../src/engine';
import { MusicImport } from '../src/music-import';
import { trackSchema } from '../../../packages/shared/src';

function fixture(){
 const db=new Database(':memory:'),scope='region:bucket',hash='f'.repeat(64),key=`music/files/${hash}/歌曲.mp3`;
 const engine=new RoomEngine(undefined,undefined,Date.now,(key,hash)=>db.getAsset(scope,hash)===key);
 const user=randomUUID(),member=randomUUID(),room=engine.create('room',user);
 engine.join(room.id,{id:user,name:'host'});engine.join(room.id,{id:member,name:'member'});
 const track=trackSchema.parse({id:randomUUID(),name:'歌曲',durationMs:120000,sizeBytes:4096,spec:{sampleRate:44100,bits:16,channels:2},lossless:false,bitrateBps:128000,contentHash:hash,ossKey:key});
 db.saveAsset(scope,hash,key);db.saveMusicSource(scope,'netease:standard:123',track);
 db.saveMusicDetail(scope,'netease:standard:123',{ar:[{name:'歌手'}],al:{name:'专辑'}});
 const exists=vi.fn(async()=>true),upload=vi.fn(),call=vi.fn(),request=vi.fn();
 const importer=new MusicImport(engine,{call},{upload,exists,scope:()=>scope},request,db);
 return {db,engine,user,member,room,track,hash,key,exists,upload,call,request,importer};
}
it('reuses a registered OSS file, preserves details and deduplicates concurrent and completed retries',async()=>{
 const f=fixture();try{
  const requestId=randomUUID();const [a,b]=await Promise.all([f.importer.addUploaded(f.room.id,f.member,f.hash,requestId),f.importer.addUploaded(f.room.id,f.member,f.hash,requestId)]);
  expect(a).toEqual(b);expect(a.id).not.toBe(f.track.id);expect(a).toMatchObject({ossKey:f.key,neteaseId:'123',artists:'歌手',album:'专辑'});
  expect(f.engine.snapshot(f.room.id).playlist).toHaveLength(1);
  expect(await f.importer.addUploaded(f.room.id,f.member,f.hash,requestId)).toEqual(a);
  expect(f.exists).toHaveBeenCalledOnce();expect(f.upload).not.toHaveBeenCalled();expect(f.call).not.toHaveBeenCalled();expect(f.request).not.toHaveBeenCalled();
  expect(()=>f.importer.addUploaded(f.room.id,f.member,'a'.repeat(64),requestId)).toThrow('COMMAND_ID_REUSED');
  expect(()=>f.importer.add(f.room.id,f.member,'123',requestId)).toThrow('COMMAND_ID_REUSED');
  expect(f.db.uploadedMusic('region:bucket','',0,20).songs[0].canAdd).toBe(true);
 }finally{f.db.close();}
});
it('rejects missing files, incomplete metadata, wrong storage and non-members without enqueueing',async()=>{
 const f=fixture();try{
  expect(()=>f.importer.addUploaded(f.room.id,randomUUID(),f.hash,randomUUID())).toThrow('NOT_IN_ROOM');
  f.exists.mockResolvedValueOnce(false);const id=randomUUID();
  await expect(f.importer.addUploaded(f.room.id,f.member,f.hash,id)).rejects.toThrow('UPLOADED_MUSIC_NOT_FOUND');
  await expect(f.importer.addUploaded(f.room.id,f.member,'a'.repeat(64),randomUUID())).rejects.toThrow('TRACK_NOT_FOUND');
  f.db.saveAsset('region:bucket','b'.repeat(64),'music/old');
  await expect(f.importer.addUploaded(f.room.id,f.member,'b'.repeat(64),randomUUID())).rejects.toThrow('UPLOADED_MUSIC_METADATA_MISSING');
  f.db.saveAsset('other:bucket','c'.repeat(64),f.key);
  await expect(f.importer.addUploaded(f.room.id,f.member,'c'.repeat(64),randomUUID())).rejects.toThrow('TRACK_NOT_FOUND');
  expect(f.engine.snapshot(f.room.id).playlist).toHaveLength(0);
  await expect(f.importer.addUploaded(f.room.id,f.member,f.hash,id)).resolves.toHaveProperty('ossKey',f.key);
 }finally{f.db.close();}
});
it('rechecks enqueue permission after the OSS existence request',async()=>{
 const f=fixture();try{
  let complete!:(value:boolean)=>void;f.exists.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
  const pending=f.importer.addUploaded(f.room.id,f.member,f.hash,randomUUID());
  const room=f.engine.snapshot(f.room.id);
  f.engine.command(f.user,{roomId:room.id,commandId:randomUUID(),expectedStateVersion:room.stateVersion,action:{type:'defaults',payload:{...room.defaults,enqueue:false}}});
  complete(true);await expect(pending).rejects.toThrow('FORBIDDEN');
  expect(()=>f.importer.addUploaded(f.room.id,f.member,f.hash,randomUUID())).toThrow('FORBIDDEN');
  expect(f.engine.snapshot(room.id).playlist).toHaveLength(0);
 }finally{f.db.close();}
});
