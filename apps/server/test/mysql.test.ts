import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'mysql2/promise';
import { MySqlDatabase } from '../src/mysql';
import { MYSQL_SCHEMA } from '../src/mysql-schema';
import { DEFAULT_PERMISSIONS, type Track } from '../../../packages/shared/src';

function fixture() {
  const connection={execute:vi.fn(async()=>[[],[]]),query:vi.fn(async()=>[[],[]]),beginTransaction:vi.fn(),commit:vi.fn(),rollback:vi.fn(),release:vi.fn()};
  const pool={...connection,getConnection:vi.fn(async()=>connection),end:vi.fn()};
  return {db:new MySqlDatabase(pool as unknown as Pool),pool,connection};
}
it('applies only additive schema and binds untrusted input as SQL parameters',async()=>{
  const {db,pool}=fixture();await db.initialize();expect(pool.query).toHaveBeenCalledTimes(MYSQL_SCHEMA.length+15);
  const input="' OR 1=1 --";await db.findUser(input);
  expect(pool.execute).toHaveBeenLastCalledWith(expect.not.stringContaining(input),[input]);
});
it('does not repeat additive migrations when the columns and foreign key exist',async()=>{
 const {db,pool}=fixture();
 pool.query.mockImplementation(async(sql:any)=>[String(sql).includes('TABLE_CONSTRAINTS')?[{CONSTRAINT_NAME:'fk_rooms_creator'}]:String(sql).includes('information_schema.COLUMNS')?['source_url','source_expires_at','last_login_ip','creator_id','creator_name','creator_display_name','creator_avatar_url'].map(COLUMN_NAME=>({COLUMN_NAME})):[],[]] as any);
 await db.initialize();await db.initialize();
 expect(pool.query.mock.calls.some(args=>String(args[0]).startsWith('ALTER TABLE'))).toBe(false);
 expect(MYSQL_SCHEMA.join('\n')).toContain('FOREIGN KEY(creator_id) REFERENCES users(id)');
});
it('binds login IP updates and never overwrites the original room creator on subsequent saves',async()=>{
 const {db,connection}=fixture();const creatorId=randomUUID(),hostId=randomUUID();
 await db.updateLoginIp(creatorId,'2001:db8::1');
 expect(connection.execute).toHaveBeenCalledWith('UPDATE users SET last_login_ip=? WHERE id=?',['2001:db8::1',creatorId]);
 await db.saveRoom({id:randomUUID(),name:'room',hostId,creatorId,defaults:DEFAULT_PERMISSIONS,overrides:{}});
 const call=(connection.execute.mock.calls as unknown as [string,unknown[]][]).find(([sql])=>sql.startsWith('INSERT INTO rooms'))!;
 expect(call[1][11]).toBe(creatorId);
 expect(call[0].split('ON DUPLICATE KEY UPDATE')[1]).not.toContain('creator_id=');
});
it('binds creation-time names and avatar without updating them on room upserts',async()=>{
 const {db,connection}=fixture(),creatorInfo={name:"creator'",displayName:'创建者',avatarUrl:'https://example.com/avatar.png'};
 await db.saveRoom({id:randomUUID(),name:'room',hostId:randomUUID(),creatorId:randomUUID(),creatorInfo,defaults:DEFAULT_PERMISSIONS,overrides:{}});
 const [sql,params]=(connection.execute.mock.calls as unknown as [string,unknown[]][]).find(([sql])=>sql.startsWith('INSERT INTO rooms'))!;
 expect(params.slice(-3)).toEqual([creatorInfo.name,creatorInfo.displayName,creatorInfo.avatarUrl]);expect(sql).not.toContain(creatorInfo.name);
 for(const field of ['creator_name','creator_display_name','creator_avatar_url'])expect(sql.split('ON DUPLICATE KEY UPDATE')[1]).not.toContain(field+'=');
});
it('restores creation-time profile snapshots and leaves unknown historical profiles null',async()=>{
 const {db,pool}=fixture();
 pool.execute.mockImplementation(async(sql:any)=>[String(sql).includes('SELECT rooms.*')?[{id:'a',creator_id:'original',creator_name:'old-name',creator_display_name:'原显示名',creator_avatar_url:'https://example.com/old.png',defaults_json:'{}',overrides_json:'{}'},{id:'b',creator_id:'known-id',creator_name:null,defaults_json:'{}',overrides_json:'{}'}]:[],[]] as any);
 const rooms=await db.rooms();expect(rooms[0].creatorInfo).toEqual({name:'old-name',displayName:'原显示名',avatarUrl:'https://example.com/old.png'});expect(rooms[1].creatorInfo).toBeNull();
});
it('commits or rolls back and always releases a transaction connection',async()=>{
  const {db,connection}=fixture();await db.transaction(async tx=>tx.setSetting('test','value'));
  expect(connection.commit).toHaveBeenCalledOnce();expect(connection.release).toHaveBeenCalledOnce();
  await expect(db.transaction(async()=>{throw Error('failed');})).rejects.toThrow('failed');
  expect(connection.rollback).toHaveBeenCalledOnce();expect(connection.release).toHaveBeenCalledTimes(2);
});
it('never leaks SQL errors or credential material through the data adapter',async()=>{
  const {db,pool}=fixture();pool.execute.mockRejectedValueOnce(Error('secret connection details'));
  await expect(db.findUser('test')).rejects.toThrow('DATABASE_UNAVAILABLE');
  pool.execute.mockRejectedValueOnce({code:'ER_DUP_ENTRY'});
  await expect(db.insertUser({id:randomUUID(),name:'test',salt:'salt',passwordHash:'hash'})).rejects.toThrow('DUPLICATE_RECORD');
});
it('saves queues in room_tracks only, even for repeated saves and multiple rooms',async()=>{
  const {db,connection}=fixture(),hostId=randomUUID();
  const track:Track={id:randomUUID(),name:'晚风',durationMs:120000,sizeBytes:2048,spec:{sampleRate:44100,bits:16,channels:2},lossless:false,bitrateBps:128000,contentHash:'a'.repeat(64),neteaseId:'123',providerId:hostId,available:true};
  const room={id:randomUUID(),name:'房间',hostId,defaults:DEFAULT_PERMISSIONS,overrides:{},playlist:[track]};
  await db.saveRoom(room);await db.saveRoom(room);
  await db.saveRoom({...room,id:randomUUID(),playlist:[{...track,id:randomUUID()}]});
  const calls=connection.execute.mock.calls as unknown as [string,unknown[]][];
  expect(calls.some(([sql])=>/\bsongs\b/.test(sql))).toBe(false);
  const writes=calls.filter(([sql])=>sql.startsWith('INSERT INTO room_tracks'));
  expect(writes).toHaveLength(3);
  expect(JSON.parse(writes[0][1][4] as string)).toEqual(track);
  expect(connection.commit).toHaveBeenCalledTimes(3);
});
it('rolls back the entire room save when a queue write fails',async()=>{
  const {db,connection}=fixture();
  connection.execute.mockRejectedValueOnce(new Error('write failed'));
  await expect(db.saveRoom({id:randomUUID(),name:'房间',hostId:randomUUID(),defaults:DEFAULT_PERMISSIONS,overrides:{}})).rejects.toThrow('DATABASE_UNAVAILABLE');
  expect(connection.rollback).toHaveBeenCalledOnce();expect(connection.commit).not.toHaveBeenCalled();
});

it('saves the playback mode in existing settings within the room transaction',async()=>{
 const {db,connection}=fixture();const id=randomUUID();
 await db.saveRoom({id,name:'room',hostId:randomUUID(),defaults:DEFAULT_PERMISSIONS,overrides:{},playbackMode:'shuffle'});
 expect(connection.execute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO settings'),[`room.playbackMode.${id}`,'shuffle']);
 expect(connection.commit).toHaveBeenCalledOnce();
});
it('restores room playback modes and defaults legacy rooms to queue mode',async()=>{
 const {db,pool}=fixture();
 pool.execute.mockImplementation(async(sql:any)=>[String(sql).includes('SELECT rooms.*')?[{id:'a',playback_mode:'loop',defaults_json:'{}',overrides_json:'{}'},{id:'b',defaults_json:'{}',overrides_json:'{}'}]:[],[]] as any);
 expect((await db.rooms()).map(r=>r.playbackMode)).toEqual(['loop','queue']);
});
