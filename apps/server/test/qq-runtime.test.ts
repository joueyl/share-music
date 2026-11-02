import { expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Database } from '../src/database';
import { EmbeddedQqRuntime } from '../src/qq-runtime';
import { QqMusicService } from '../src/qq';

async function cleanup(directory:string){
 const target=resolve(directory);
 if(!target.startsWith(resolve(tmpdir())+sep)||!target.split(sep).at(-1)?.startsWith('tone-qq-'))throw Error('Unsafe test cleanup path');
 await rm(target,{recursive:true,force:true});
}

it('runs the installed real package privately, coalesces startup and closes its listener',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'tone-qq-runtime-')),db=new Database(':memory:'),runtime=new EmbeddedQqRuntime(db,directory);
 const originalEnvironment=process.env.NODE_ENV;
 let url='';
 try{
  const first=runtime.url();expect(runtime.url()).toBe(first);url=await first;
  expect(new URL(url).hostname).toBe('127.0.0.1');expect(process.env.NODE_ENV).toBe(originalEnvironment);
  const response=await fetch(url+'/login/channels'),data=await response.json();
  expect(data).toMatchObject({code:200,data:{sessionMode:'stored'}});expect(data.data.channels).toContain('qq');expect(data.data.channels).toContain('qqmusic');
  expect(db.getSetting('qq.embedded.secret')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await runtime.close();await expect(fetch(url+'/login/channels')).rejects.toThrow();await expect(runtime.url()).rejects.toThrow('QQ_MUSIC_UNAVAILABLE');
 }finally{await runtime.close();db.close();await cleanup(directory);}
},20000);

it('defaults to the installed embedded package without requiring an API URL',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'tone-qq-service-')),db=new Database(':memory:');
 vi.stubEnv('QQ_MUSIC_API_URL','');vi.stubEnv('QQ_MUSIC_STATE_DIR',directory);
 const service=new QqMusicService(db);
 try{expect((await service.channels()).channels).toContain('qq');}finally{await service.close();db.close();vi.unstubAllEnvs();await cleanup(directory);}
},20000);
