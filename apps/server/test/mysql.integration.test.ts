import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { Database } from '../src/database';
import { Auth } from '../src/auth';
import { MySqlDatabase, mysqlPool } from '../src/mysql';
import { cleanupRoomSongCopies } from '../src/room-song-cleanup';
import { readLegacy, migrateLegacy } from '../src/migration';
import { DEFAULT_PERMISSIONS, roomSettingsSchema, type TrackMetadata } from '../../../packages/shared/src';

// Explicit opt-in; creates and drops ONLY the random database created by this test.
it.runIf(process.env.RUN_MYSQL_TESTS==='1')('real MySQL: SQLite import, restart, search, queue transaction, auth and nonempty-target refusal',async()=>{
  const url=new URL(process.env.DATABASE_URL!),schema='music_share_verify_'+randomUUID().replaceAll('-','');
  url.pathname='/information_schema';const admin=mysqlPool(url.href);
  let created=false,db:MySqlDatabase|undefined,child:ChildProcess|undefined;
  const dir=mkdtempSync(join(tmpdir(),'music-share-mysql-')),path=join(dir,'source.sqlite');
  try {
    await admin.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);created=true;
    url.pathname='/'+schema;db=new MySqlDatabase(mysqlPool(url.href));
    const legacy=new Database(path),auth=new Auth(legacy,'test-secret-'.repeat(4));
    const session=await auth.login('迁移用户','test-password-123',true),roomId=randomUUID();
    const track:TrackMetadata={id:randomUUID(),name:'晚风 🎵',artists:'测试歌手',album:'专辑',durationMs:120000,sizeBytes:2048,spec:{sampleRate:44100,bits:16,channels:2},lossless:false,bitrateBps:128000,contentHash:'a'.repeat(64),ossKey:'music/files/'+ 'a'.repeat(64)+'/晚风.mp3'};
    legacy.saveRoom({id:roomId,name:'迁移房间',hostId:session.user.id,defaults:DEFAULT_PERMISSIONS,overrides:{},settings:roomSettingsSchema.parse({visibility:'invite'}),inviteCode:'a'.repeat(12),playlist:[{...track,providerId:session.user.id,available:true}]});
    legacy.saveAsset('scope',track.contentHash,track.ossKey!);legacy.saveMusicSource('scope','netease:standard:123',track);
    legacy.saveMusicDetail('scope','netease:standard:123',{name:'晚风 🎵',ar:[{name:'测试歌手'}]});legacy.setSetting('private-cookie','not-logged');legacy.close();
    const source=readLegacy(path);expect(await migrateLegacy(db,source)).toMatchObject({users:1,rooms:1,sources:1,assets:1});
    expect(await db.uploadedMusic('scope','歌手',0,20)).toMatchObject({total:1,songs:[{name:'晚风 🎵',canAdd:true}]});
    expect(await db.uploadedMusic('scope','%',0,20)).toMatchObject({total:0});
    expect(await db.uploadedMusic('other','',0,20)).toMatchObject({total:0});
    expect(await db.uploadedTrack('scope',track.contentHash)).toMatchObject({neteaseId:'123'});
    expect(await db.getSetting('private-cookie')).toBe('not-logged');
    const direct={...track,ossKey:undefined,sourceUrl:'https://m801.music.126.net/song.mp3?test=1',sourceExpiresAt:200000,neteaseId:'123'};
    await db.saveMusicSource('netease','netease:standard:123',direct);
    const [stored]=await db.pool.query<any[]>('SELECT source_url,source_expires_at FROM songs WHERE scope=?',['netease']);
    expect(stored[0]).toMatchObject({source_url:direct.sourceUrl,source_expires_at:200000});
    expect(await db.musicLibrary('测试歌手',0,20)).toMatchObject({total:1,songs:[{neteaseId:'123',canAdd:true}]});
    const queueRoom=(await db.rooms())[0];
    await db.saveRoom(queueRoom);await db.saveRoom(queueRoom);
    const [noCopies]=await db.pool.query<any[]>("SELECT COUNT(*) AS total FROM songs WHERE scope LIKE 'room:%'");
    expect(Number(noCopies[0].total)).toBe(0);
    await db.saveMusicSource('room:'+roomId,track.id,direct);
    const uniqueId=randomUUID();await db.saveMusicSource('room:'+roomId,uniqueId,{...direct,id:uniqueId,contentHash:'b'.repeat(64)});
    expect(await cleanupRoomSongCopies(db.pool)).toMatchObject({candidates:1,removed:0});
    const cleaned=await cleanupRoomSongCopies(db.pool,true);expect(cleaned.removed).toBe(1);
    expect(await db.getMusicSource('room:'+roomId,track.id)).toBeUndefined();
    expect(await db.getMusicSource('room:'+roomId,uniqueId)).toBeDefined();
    expect((await db.rooms())[0].playlist).toEqual(queueRoom.playlist);
    const [backup]=await db.pool.query<any[]>(`SELECT track_json FROM \`${cleaned.backupTable}\``);
    expect(backup).toHaveLength(1);
    expect(await cleanupRoomSongCopies(db.pool)).toMatchObject({candidates:0});

    await db.close();db=new MySqlDatabase(mysqlPool(url.href));await db.initialize();
    const room=(await db.rooms())[0];expect(room).toMatchObject({name:'迁移房间',inviteCode:'a'.repeat(12),settings:{visibility:'invite'},playlist:[{id:track.id}]});
    const restoredAuth=new Auth(db,'test-secret-'.repeat(4));expect((await restoredAuth.login('迁移用户','test-password-123')).user.id).toBe(session.user.id);
    await db.pool.execute('UPDATE users SET email=? WHERE id=?',['alias@example.com',session.user.id]);
    await expect(restoredAuth.login('alias@example.com','test-password-123')).rejects.toThrow('INVALID_CREDENTIALS');
    const literal=await restoredAuth.login('Literal@example.com','test-password-123',true);
    expect((await db.getUser(literal.user.id))?.email).toBeNull();
    await expect(restoredAuth.login('literal@example.com','test-password-123')).rejects.toThrow('INVALID_CREDENTIALS');
    await expect(migrateLegacy(db,source)).rejects.toThrow('Target is not empty');
    await expect(db.transaction(async tx=>{await tx.setSetting('rollback','value');throw Error('abort');})).rejects.toThrow('abort');
    expect(await db.getSetting('rollback')).toBeUndefined();
    await db.saveRoom({...room,playlist:[]});expect((await db.rooms())[0].playlist).toEqual([]);
    await expect(db.saveRoom({...room,name:'must rollback',playlist:[{...track,id:'x'.repeat(37),providerId:session.user.id,available:true}]})).rejects.toThrow();
    expect((await db.rooms())[0].name).toBe('迁移房间');
    expect((await db.rooms())[0].playlist).toEqual([]);
    const listener=createServer();await new Promise<void>(r=>listener.listen(0,'127.0.0.1',r));
    const port=(listener.address() as {port:number}).port;await new Promise<void>(r=>listener.close(()=>r()));
    child=spawn(process.execPath,[resolve('apps/server/dist/apps/server/src/main.js')],{env:{...process.env,DATABASE_DRIVER:'mysql',DATABASE_URL:url.href,PORT:String(port),BIND_ADDRESS:'127.0.0.1',TOKEN_SECRET:'mysql-test-secret-'.repeat(3)},stdio:'ignore'});
    const base=`http://127.0.0.1:${port}/api`;
    let healthy=false;for(let i=0;i<100;i++){try{healthy=(await fetch(base+'/health')).ok;if(healthy)break;}catch{}await new Promise(r=>setTimeout(r,50));}
    expect(healthy).toBe(true);
    const login=await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'迁移用户',password:'test-password-123'})});
    expect(login.status).toBe(201);const {token}=await login.json() as {token:string};
    const rejectedEmail=await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'alias@example.com',password:'test-password-123'})});
    expect(rejectedEmail.status).toBe(400);
    const registered=await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'用户名注册',password:'test-password-123',register:true})});
    expect(registered.status).toBe(201);
    const headers={'Content-Type':'application/json',Authorization:'Bearer '+token};
    const createdRoom=await fetch(base+'/rooms',{method:'POST',headers,body:JSON.stringify({name:'API 房间',settings:{atmosphere:'night',visibility:'invite'}})});
    expect(createdRoom.status).toBe(201);const apiRoom=await createdRoom.json() as {id:string;stateVersion:number;inviteCode:string};
    expect((await db.rooms()).find(r=>r.id===apiRoom.id)?.settings?.atmosphere).toBe('night');
    expect((await fetch(base+'/rooms/resolve/'+apiRoom.inviteCode,{headers})).status).toBe(200);
    const profile=await fetch(base+'/me',{headers});expect(profile.status).toBe(200);expect(await profile.json()).not.toHaveProperty('email');
    const edited=await fetch(base+'/rooms/'+apiRoom.id+'/settings',{method:'PUT',headers,body:JSON.stringify({expectedStateVersion:apiRoom.stateVersion,settings:{visibility:'public'},name:'公开房间'})});
    expect(edited.status).toBe(200);expect((await db.rooms()).find(r=>r.id===apiRoom.id)?.name).toBe('公开房间');
    expect((await fetch(base+'/rooms/'+apiRoom.id+'/settings',{method:'PUT',headers,body:JSON.stringify({expectedStateVersion:0,settings:{}})})).status).toBe(400);
  } finally {
    if(child&&child.exitCode===null){const stopped=new Promise<void>(r=>child!.once('exit',()=>r()));child.kill();await stopped;}
    await db?.close();
    if(created)await admin.query(`DROP DATABASE \`${schema}\``);
    await admin.end();rmSync(dir,{recursive:true,force:true});
  }
},30000);
