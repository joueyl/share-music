import { afterEach,expect,it,vi } from 'vitest';
import { mkdtempSync,existsSync,unlinkSync,rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../src/database';
import { MusicProfile } from '../src/music-profile';
import { Auth } from '../src/auth';
const databases:Database[]=[];afterEach(()=>{for(const db of databases.splice(0))db.close();});
const upstream=()=>({call:vi.fn(async(_name:string,{uid}:{uid:string})=>({code:200,profile:{userId:uid,nickname:'真实资料',avatarUrl:'',signature:'签名'}}))});
function fixture(){const db=new Database(':memory:');databases.push(db);for(const id of ['a','b'])db.insertUser({id,name:id,passwordHash:'hash',salt:'salt'});return db;}
it('writes the canonical profile URL to the authenticated user row, not the settings collection or another user',async()=>{
 const db=fixture(),service=new MusicProfile(db,upstream());
 await service.set('a','https://music.163.com/#/user?id=123&tracking=discard');
 expect(db.db.prepare('SELECT netease_profile_url AS url FROM users WHERE id=?').get('a')?.url).toBe('https://music.163.com/user?id=123');expect(db.getUserMusicProfileUrl('b')).toBeNull();expect(db.getSetting('music.profile.a')).toBeUndefined();
 db.setSetting('music.profile.a','{"source":"netease","id":"999"}');await service.set('a',null);expect(db.getUserMusicProfileUrl('a')).toBeNull();expect(db.getSetting('music.profile.a')).toBeUndefined();expect(await new MusicProfile(db,upstream()).get('a')).toBeNull();
});
it('migrates legacy binding settings into the user information field and removes them atomically',async()=>{
 const db=fixture();db.setSetting('music.profile.a','{"source":"netease","id":"123"}');const service=new MusicProfile(db,upstream());expect(await service.get('a')).toMatchObject({id:'123'});expect(db.getUserMusicProfileUrl('a')).toBe('https://music.163.com/user?id=123');expect(db.getSetting('music.profile.a')).toBeUndefined();
 expect(await service.get('b')).toBeNull();expect(await new MusicProfile(db,upstream()).get('a')).toMatchObject({id:'123'});
});
it('rolls back the user update when legacy cleanup fails and does not discard prior binding data',()=>{
 const db=fixture();db.setUserMusicProfileUrl('a','https://music.163.com/user?id=123');db.setSetting('music.profile.a','{"source":"netease","id":"123"}');
 db.db.exec(`CREATE TRIGGER reject_profile_cleanup BEFORE DELETE ON settings WHEN OLD.key='music.profile.a' BEGIN SELECT RAISE(ABORT,'test failure'); END`);
 expect(()=>db.setUserMusicProfileUrl('a',null)).toThrow('DATABASE_UNAVAILABLE');expect(db.getUserMusicProfileUrl('a')).toBe('https://music.163.com/user?id=123');expect(db.getSetting('music.profile.a')).toContain('123');
 expect(()=>db.setUserMusicProfileUrl('not-a-user','https://music.163.com/user?id=123')).toThrow('UNAUTHORIZED');
});
it('restores the binding after the database file is closed and reopened',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tone-profile-binding-')),file=join(dir,'binding.sqlite');let db:Database|undefined;
 try{
  db=new Database(file);db.insertUser({id:'a',name:'a',passwordHash:'hash',salt:'salt'});await new MusicProfile(db,upstream()).set('a','https://music.163.com/user?id=123');db.close();db=undefined;
  db=new Database(file);expect(db.getUserMusicProfileUrl('a')).toBe('https://music.163.com/user?id=123');expect(await new MusicProfile(db,upstream()).get('a')).toMatchObject({id:'123'});
 }finally{db?.close();for(const suffix of ['','-wal','-shm'])if(existsSync(file+suffix))unlinkSync(file+suffix);rmdirSync(dir);}
});
it('retains binding across password logins without exposing private link fields in public auth data',async()=>{
 const db=new Database(':memory:');databases.push(db);const auth=new Auth(db,'test-only-secret-for-profile-binding-32');const first=await auth.login('profile-test','long-test-password',true);
 await new MusicProfile(db,upstream()).set(first.user.id,'https://music.163.com/user?id=123');const second=await auth.login('profile-test','long-test-password');expect(second.user).toEqual(first.user);expect(second.user).not.toHaveProperty('neteaseProfileUrl');expect(await auth.verify(second.token)).not.toHaveProperty('neteaseProfileUrl');expect(await new MusicProfile(db,upstream()).get(second.user.id)).toMatchObject({id:'123'});
});
