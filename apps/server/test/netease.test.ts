import { expect, it, vi } from 'vitest';
import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from '../src/database';
import { NeteaseService, type MusicInvoker } from '../src/netease';
import { adminAllowed, loginOriginAllowed } from '../src/netease.controller';

function fixture() {
 const db = new Database(':memory:'); let now=10000, code=801, cookie='MUSIC_U=first; __csrf=test';
 const api = vi.fn(async (name: string, params: Record<string, unknown>) => {
  if(name==='login_qr_key') return {body:{data:{unikey:'qr-key'}}};
  if(name==='login_qr_create') return {body:{data:{qrimg:'data:image/png;base64,AA=='}}};
  if(name==='login_qr_check') return {body:{code,cookie}};
  return {body:{code:200,data:{ok:true,cookie:'hidden'},cookie:'hidden'}};
 });
 const service=new NeteaseService(db,api,()=>now);
 return { db,api,service,advance:()=>now+=2500,status:(n:number)=>code=n,cookie:(v:string)=>cookie=v };
}
it('polls QR states, persists the successful cookie, automatically injects it and never returns it', async()=>{
 const f=fixture(); try {
  const qr=await f.service.begin(); expect(qr.image).toMatch(/^data:image/);
  expect(await f.service.check(qr.sessionId)).toEqual({code:801});
  f.advance(); f.status(802); expect(await f.service.check(qr.sessionId)).toEqual({code:802});
  f.advance(); f.status(803); expect(await f.service.check(qr.sessionId)).toEqual({code:803});
  const result=await f.service.call('song_detail',{ids:'1',cookie:'attacker',proxy:'http://bad',realIP:'bad'});
  expect(result).toEqual({code:200,data:{ok:true}});
  expect(f.api.mock.calls.at(-1)?.[1]).toMatchObject({ids:'1',cookie:'MUSIC_U=first; __csrf=test'});
  expect(f.api.mock.calls.at(-1)?.[1]).not.toHaveProperty('proxy');
  expect(f.api.mock.calls.at(-1)?.[1]).not.toHaveProperty('realIP');
 } finally {f.db.close();}
});
it('keeps the previous login until a new QR is confirmed, then replaces it',async()=>{
 const f=fixture();try{
  const a=await f.service.begin();f.status(803);await f.service.check(a.sessionId);
  const b=await f.service.begin();expect(f.db.getSetting('netease.cookie')).toContain('first');
  f.cookie('MUSIC_U=second');await f.service.check(b.sessionId);
  expect(f.db.getSetting('netease.cookie')).toBe('MUSIC_U=second');
  await expect(f.service.check(a.sessionId)).rejects.toThrow('NETEASE_LOGIN_REPLACED');
  const restored=new NeteaseService(f.db,f.api);await restored.call('user_account',{});
  expect(f.api.mock.calls.at(-1)?.[1].cookie).toBe('MUSIC_U=second');
 }finally{f.db.close();}
});
it('rejects expired QR codes and never persists malformed credentials',async()=>{
 const f=fixture();try{
  const qr=await f.service.begin();f.status(803);f.cookie('invalid');
  await expect(f.service.check(qr.sessionId)).rejects.toThrow('NETEASE_INVALID_RESPONSE');
  expect(f.db.getSetting('netease.cookie')).toBeUndefined();
  for(let i=0;i<80;i++)f.advance();expect(await f.service.check(qr.sessionId)).toEqual({code:800});
 }finally{f.db.close();}
});
it('prevents a stale in-flight poll from overwriting a newer login attempt',async()=>{
 const db=new Database(':memory:');let resolve!: (value:any)=>void;
 const api:MusicInvoker=async name=> name==='login_qr_key'?{body:{data:{unikey:'key'}}}:name==='login_qr_create'?{body:{data:{qrimg:'data:image/png;base64,AA=='}}}:new Promise(r=>resolve=r);
 try{const s=new NeteaseService(db,api);const first=await s.begin();const pending=s.check(first.sessionId);await s.begin();resolve({body:{code:803,cookie:'MUSIC_U=stale'}});await expect(pending).rejects.toThrow('NETEASE_LOGIN_REPLACED');expect(db.getSetting('netease.cookie')).toBeUndefined();}finally{db.close();}
});
it('persists credentials across database close and reopen',()=>{
 const dir=mkdtempSync(join(tmpdir(),'music-netease-')),path=join(dir,'test.sqlite');
 let db=new Database(path);try{db.setSetting('netease.cookie','MUSIC_U=persisted');db.close();db=new Database(path);expect(db.getSetting('netease.cookie')).toBe('MUSIC_U=persisted');}finally{db.close();unlinkSync(path);rmdirSync(dir);}
});
it('does not expose dangerous library methods or upstream error contents',async()=>{
 const f=fixture();try{
  await expect(f.service.call('logout',{})).rejects.toThrow('NETEASE_METHOD_NOT_ALLOWED');
  f.api.mockRejectedValueOnce(new Error('secret cookie'));
  await expect(f.service.call('song_detail',{})).rejects.toThrow(/^NETEASE_UNAVAILABLE$/);
 }finally{f.db.close();}
});
it('restricts login management to local direct access or the configured Basic credential',()=>{
 const req=(ip:string,host:string,extra={})=>({headers:{host,...extra},socket:{remoteAddress:ip}}) as any;
 expect(adminAllowed(req('127.0.0.1','localhost:3000'),'')).toBe(true);
 expect(adminAllowed(req('127.0.0.1','public.example.com'),'')).toBe(false);
 expect(adminAllowed(req('127.0.0.1','localhost:3000',{'x-forwarded-for':'203.0.113.1'}),'')).toBe(false);
 expect(adminAllowed(req('203.0.113.1','localhost:3000'),'')).toBe(false);
 expect(adminAllowed(req('127.0.0.1','localhost:3000'),'secret')).toBe(false);
 expect(adminAllowed(req('203.0.113.1','public.example.com',{authorization:'Basic '+Buffer.from('admin:secret').toString('base64')}),'secret')).toBe(true);
});

it('allows keyword suggestions and injects the persisted cookie without accepting caller network overrides',async()=>{
 const f=fixture();try{f.db.setSetting('netease.cookie','MUSIC_U=saved');await f.service.call('search_suggest',{keywords:'晴天',type:'mobile',cookie:'wrong',proxy:'http://bad'});expect(f.api.mock.calls.at(-1)).toEqual(['search_suggest',expect.objectContaining({keywords:'晴天',type:'mobile',cookie:'MUSIC_U=saved'})]);expect(f.api.mock.calls.at(-1)?.[1]).not.toHaveProperty('proxy');}finally{f.db.close();}
});

const originReq=(origin:string|undefined,host='music.example.com:8443',ip='127.0.0.1',forwarded?:string)=>({protocol:'http',socket:{remoteAddress:ip},headers:{host,...(origin?{origin}:{}),...(forwarded?{'x-forwarded-proto':forwarded}:{})}}) as any;
it('accepts HTTPS termination by loopback proxies and preserves public nonstandard ports',()=>{
 expect(loginOriginAllowed(originReq('https://music.example.com:8443',undefined,undefined,'https'),'')).toBe(true);
 expect(loginOriginAllowed(originReq('https://music.example.com:8443',undefined,undefined,'https'),'   ')).toBe(true);
 expect(loginOriginAllowed(originReq('http://music.example.com:8443'),'')).toBe(true);
 expect(loginOriginAllowed(originReq('https://music.example.com:8443'),'')).toBe(false);
});
it('uses an explicit origin for Docker proxies, accepts trailing slash and rejects paths',()=>{
 const req=originReq('https://music.example.com:8443','api:3000','172.20.0.2');
 expect(loginOriginAllowed(req,'https://music.example.com:8443/')).toBe(true);
 expect(loginOriginAllowed(req,'https://music.example.com:8443/loginServe')).toBe(false);
 expect(loginOriginAllowed(req,'https://music.example.com')).toBe(false);
});
it('does not trust protocol headers from arbitrary peers or accept cross-site/null/malformed origins',()=>{
 expect(loginOriginAllowed(originReq('https://music.example.com:8443',undefined,'203.0.113.1','https'),'')).toBe(false);
 expect(loginOriginAllowed(originReq('https://music.example.com:8443',undefined,undefined,'https,http'),'')).toBe(false);
 for(const origin of ['null','https://evil.example.com','https://music.example.com.evil:8443','https://user:pass@music.example.com:8443','https://music.example.com:8443/path'])expect(loginOriginAllowed(originReq(origin),'https://music.example.com:8443')).toBe(false);
 const req=originReq('https://music.example.com:8443');req.headers['sec-fetch-site']='cross-site';expect(loginOriginAllowed(req,'https://music.example.com:8443')).toBe(false);
 expect(loginOriginAllowed(originReq(undefined),'')).toBe(true);
});
