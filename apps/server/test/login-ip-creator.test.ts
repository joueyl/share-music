import { expect, it, vi } from 'vitest';
import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../src/database';
import { Auth } from '../src/auth';
import { ApiController } from '../src/controller';
import type { AppService } from '../src/app.service';
import { DomainError, RoomEngine } from '../src/engine';

it('stores registration IP and replaces it only on successful login, without leaking it in sessions',async()=>{
 const db=new Database(':memory:'),auth=new Auth(db,'x'.repeat(32));
 try {
  const session=await auth.login('alice','correct-password',true,'::ffff:192.0.2.1');
  expect(db.getUser(session.user.id)?.lastLoginIp).toBe('192.0.2.1');
  expect(session.user).toEqual({id:session.user.id,name:'alice'});
  await expect(auth.login('alice','wrong-password',false,'192.0.2.2')).rejects.toThrow('INVALID_CREDENTIALS');
  await expect(auth.login('alice','correct-password',true,'192.0.2.2')).rejects.toThrow('NAME_TAKEN');
  expect(db.getUser(session.user.id)?.lastLoginIp).toBe('192.0.2.1');
  await auth.login('alice','correct-password',false,'2001:db8::2');
  expect(db.getUser(session.user.id)?.lastLoginIp).toBe('2001:db8::2');
  expect(await auth.verify(session.token)).not.toHaveProperty('lastLoginIp');
  await expect(auth.login('alice','correct-password',false,'not-an-ip')).rejects.toThrow('INVALID_IP');
  expect(db.getUser(session.user.id)?.lastLoginIp).toBe('2001:db8::2');
  vi.spyOn(db,'updateLoginIp').mockImplementation(()=>{throw new DomainError('DATABASE_UNAVAILABLE');});
  await expect(auth.login('alice','correct-password',false,'192.0.2.3')).rejects.toThrow('DATABASE_UNAVAILABLE');
 } finally { db.close(); }
});

it.each([false,['127.0.0.1']])('uses Express client IP with explicit trusted proxies: %j',async trust=>{
 const app=express(),login=vi.fn(async()=>({token:'test',user:{id:'id',name:'alice'}}));
 app.set('trust proxy',trust);app.use(express.json());
 const controller=new ApiController({limit:()=>{},auth:{login}} as unknown as AppService);
 app.post('/login',async(req,res,next)=>{try{res.json(await controller.login(req.body,req));}catch(e){next(e);}});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 try {
  const response=await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/login`,{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':'198.51.100.1, 192.0.2.1'},body:JSON.stringify({name:'alice',password:'correct-password'})});
  expect(response.status).toBe(200);
  expect(login).toHaveBeenCalledWith('alice','correct-password',false,trust?'192.0.2.1':'127.0.0.1');
 } finally {await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});

it('persists a separate creator across host transfers, restoration and later room saves',()=>{
 const db=new Database(':memory:');let now=1000;
 try {
  const engine=new RoomEngine(record=>db.saveRoom(record),()=>{},()=>now);
  const creatorInfo={name:'original-name',displayName:'创建时的名字',avatarUrl:'https://example.com/original.png'};
  const id=engine.create('room','creator',undefined,undefined,creatorInfo).id;
  creatorInfo.name='later-name';
  engine.join(id,{id:'creator',name:'creator'});engine.join(id,{id:'next',name:'next'});
  expect(db.rooms()[0].creatorId).toBe('creator');
  expect(engine.snapshot(id)).not.toHaveProperty('creatorId');expect(engine.snapshot(id)).not.toHaveProperty('creatorInfo');
  engine.leave(id,'creator');now+=60001;engine.tick();
  expect(db.rooms()[0]).toMatchObject({hostId:'next',creatorId:'creator'});
  const restored=new RoomEngine(record=>db.saveRoom(record));restored.restore(db.rooms());
  restored.updateSettings(id,'next','renamed',restored.snapshot(id).settings,0);
  expect(db.rooms()[0]).toMatchObject({name:'renamed',hostId:'next',creatorId:'creator',creatorInfo:{name:'original-name',displayName:'创建时的名字',avatarUrl:'https://example.com/original.png'}});
  db.saveRoom({...db.rooms()[0],creatorId:'replacement',creatorInfo:{name:'replacement',displayName:'replacement',avatarUrl:null}});
  expect(db.rooms()[0].creatorId).toBe('creator');
  expect(db.rooms()[0].creatorInfo?.name).toBe('original-name');
  db.saveRoom({...db.rooms()[0],id:'legacy',creatorId:undefined,creatorInfo:undefined});
  expect(db.rooms().find(r=>r.id==='legacy')?.creatorId).toBeNull();
  const legacy=db.rooms().find(r=>r.id==='legacy')!;db.saveRoom({...legacy,creatorInfo:{name:'guessed',displayName:'guessed',avatarUrl:null}});
  expect(db.rooms().find(r=>r.id==='legacy')?.creatorInfo).toBeNull();
 } finally {db.close();}
});

it('upgrades an old SQLite users table and retains login IP after reopening',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'music-share-login-ip-')),path=join(dir,'test.sqlite');
 let db:Database|undefined;
 try {
  const old=new DatabaseSync(path);
  old.exec('CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,salt TEXT NOT NULL)');old.close();
  db=new Database(path);const auth=new Auth(db,'x'.repeat(32));
  const session=await auth.login('alice','correct-password',true,'192.0.2.1');
  db.close();db=undefined;db=new Database(path);
  expect(db.getUser(session.user.id)?.lastLoginIp).toBe('192.0.2.1');
 } finally {db?.close();rmSync(dir,{recursive:true,force:true});}
});

it('uses the authenticated account as creator and rejects client-supplied creator/IP fields',async()=>{
 const db=new Database(':memory:'),auth=new Auth(db,'x'.repeat(32));
 try {
  const session=await auth.login('alice','correct-password',true,'192.0.2.1');
  const engine=new RoomEngine(record=>db.saveRoom(record));
  const controller=new ApiController({auth,engine,database:db,limit:()=>{},flush:async()=>{}} as unknown as AppService);
  const room=await controller.create({name:'room'},`Bearer ${session.token}`);
  expect(db.rooms()[0]).toMatchObject({id:room!.id,creatorId:session.user.id,creatorInfo:{name:'alice',displayName:'alice',avatarUrl:null}});
  expect(room).not.toHaveProperty('creatorInfo');
  await expect(controller.create({name:'room',creatorId:session.user.id},`Bearer ${session.token}`)).rejects.toMatchObject({status:400});
  await expect(controller.create({name:'room',creatorInfo:{name:'forged'}},`Bearer ${session.token}`)).rejects.toMatchObject({status:400});
  await expect(controller.login({name:'alice',password:'correct-password',ip:'192.0.2.2'},{ip:'127.0.0.1'} as any)).rejects.toMatchObject({status:400});
 } finally {db.close();}
});

it('snapshots only the creator public profile fields, not password hashes or login IP',async()=>{
 const db=new Database(':memory:'),auth=new Auth(db,'x'.repeat(32));
 try {
  const session=await auth.login('alice','correct-password',true,'192.0.2.1');
  const saved=db.getUser(session.user.id)!;
  vi.spyOn(db,'getUser').mockImplementation(()=>({...saved,displayName:'创建时显示名',avatarUrl:'https://example.com/creator.png'}));
  const engine=new RoomEngine(record=>db.saveRoom(record));
  const controller=new ApiController({auth,engine,database:db,limit:()=>{},flush:async()=>{}} as unknown as AppService);
  await controller.create({name:'room'},`Bearer ${session.token}`);
  expect(db.rooms()[0].creatorInfo).toEqual({name:'alice',displayName:'创建时显示名',avatarUrl:'https://example.com/creator.png'});
  const record=JSON.stringify(db.rooms()[0]);
  for(const value of [saved.passwordHash,saved.salt,'192.0.2.1','correct-password'])expect(record).not.toContain(value);
 } finally {db.close();}
});
