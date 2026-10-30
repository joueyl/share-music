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
  const {db,pool}=fixture();await db.initialize();expect(pool.query).toHaveBeenCalledTimes(MYSQL_SCHEMA.length+4);
  const input="' OR 1=1 --";await db.findUser(input);
  expect(pool.execute).toHaveBeenLastCalledWith(expect.not.stringContaining(input),[input]);
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
