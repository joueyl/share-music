import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { RoomEngine, type RoomRecord } from '../src/engine';
import { roomSettingsSchema } from '../../../packages/shared/src';
it('excludes invite rooms from discovery and enforces owner/version for settings',()=>{
  const saved:RoomRecord[]=[],engine=new RoomEngine(r=>saved.push(structuredClone(r))),owner=randomUUID(),other=randomUUID();
  const room=engine.create('日落',owner,roomSettingsSchema.parse({visibility:'invite',category:'民谣'}));
  expect(engine.list(other)).toEqual([]);expect(engine.list(owner,'日落','民谣')).toHaveLength(1);
  expect(engine.resolveInvite(room.inviteCode!)).toMatchObject({id:room.id});
  expect(()=>engine.updateSettings(room.id,other,undefined,roomSettingsSchema.parse({}),0)).toThrow('HOST_ONLY');
  expect(()=>engine.updateSettings(room.id,owner,undefined,roomSettingsSchema.parse({}),1)).toThrow('STATE_CONFLICT');
  engine.updateSettings(room.id,owner,'新房间',roomSettingsSchema.parse({atmosphere:'night'}),0);
  const restored=new RoomEngine();restored.restore([saved.at(-1)!]);expect(restored.list(other)).toMatchObject([{name:'新房间',settings:{atmosphere:'night',visibility:'public'}}]);
});
