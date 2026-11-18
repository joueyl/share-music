import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Database } from '../src/database';
import { QqSessionKeepalive } from '../src/qq-keepalive';
import { QqMusicService } from '../src/qq';

const interval=30*60*1000;
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
it('starts once, checks immediately and every 30 minutes without overlapping requests',async()=>{
 let finish!:()=>void;
 const run=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;})),task=new QqSessionKeepalive(run);
 try{
  task.start();task.start();await vi.advanceTimersByTimeAsync(0);expect(run).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(interval*2);expect(run).toHaveBeenCalledOnce();
  finish();await vi.advanceTimersByTimeAsync(interval-1);expect(run).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);expect(run).toHaveBeenCalledTimes(2);finish();
 }finally{finish?.();await task.stop();}
});
it('logs only fixed text, preserves the schedule after failures and never loops retries',async()=>{
 const log=vi.fn(),run=vi.fn().mockRejectedValue(new Error('token=private upstream error')),task=new QqSessionKeepalive(run,log);
 task.start();await vi.advanceTimersByTimeAsync(0);expect(run).toHaveBeenCalledOnce();expect(log).toHaveBeenCalledOnce();
 expect(JSON.stringify(log.mock.calls)).not.toContain('private');
 await vi.advanceTimersByTimeAsync(interval-1);expect(run).toHaveBeenCalledOnce();
 await vi.advanceTimersByTimeAsync(1);expect(run).toHaveBeenCalledTimes(2);
 await task.stop();await vi.advanceTimersByTimeAsync(interval*2);expect(run).toHaveBeenCalledTimes(2);
});
it('aborts in-flight work, drains it and does not reschedule during shutdown',async()=>{
 let signal!:AbortSignal;
 const log=vi.fn(),run=vi.fn((s:AbortSignal)=>new Promise<void>((_,reject)=>{signal=s;s.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});})),task=new QqSessionKeepalive(run,log);
 task.start();await vi.advanceTimersByTimeAsync(0);await task.stop();
 expect(signal.aborted).toBe(true);expect(log).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(interval*2);expect(run).toHaveBeenCalledOnce();
});
it('does not start a request when stopped before its startup microtask',async()=>{
 const run=vi.fn(async()=>{}),task=new QqSessionKeepalive(run);task.start();await task.stop();expect(run).not.toHaveBeenCalled();
});
function fixture(){
 const db=new Database(':memory:');
 const request=vi.fn(async(_input:any,options:any)=>Response.json({code:200,data:{token:options.headers['X-QQ-Session'],rotated:false,expiresAt:Date.now()+86400000}}));
 const service=new QqMusicService(db,'http://127.0.0.1:3200',request as typeof fetch);
 return {db,request,service};
}
it('keeps idle stored sessions alive with POST, header-only credentials and no database rewrite',async()=>{
 const f=fixture();f.db.setSetting('qq.session','private-session');const write=vi.spyOn(f.db,'setSetting');
 try{
  f.service.start();await vi.advanceTimersByTimeAsync(0);
  expect(f.request).toHaveBeenCalledOnce();const [url,options]=f.request.mock.calls[0];
  expect(String(url)).toBe('http://127.0.0.1:3200/login/refresh');
  expect(options).toMatchObject({method:'POST',redirect:'error',headers:{'X-QQ-Session':'private-session'}});
  expect(write).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(interval);expect(f.request).toHaveBeenCalledTimes(2);
 }finally{await f.service.close();f.db.close();}
});
it('does not contact QQ without a session and picks up a subsequent login',async()=>{
 const f=fixture();try{
  f.service.start();await vi.advanceTimersByTimeAsync(0);expect(f.request).not.toHaveBeenCalled();
  f.db.setSetting('qq.session','new-login');await vi.advanceTimersByTimeAsync(interval);expect(f.request).toHaveBeenCalledOnce();
 }finally{await f.service.close();f.db.close();}
});
it('never overwrites a newer login with a stale refresh response or rotated external token',async()=>{
 const f=fixture();vi.spyOn(console,'warn').mockImplementation(()=>{});
 let finish!:(response:Response)=>void;f.request.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 try{
  f.db.setSetting('qq.session','old-login');f.service.start();await vi.advanceTimersByTimeAsync(0);
  f.db.setSetting('qq.session','new-login');finish(Response.json({code:200,data:{token:'old-login',rotated:false,expiresAt:Date.now()+86400000}}));await vi.advanceTimersByTimeAsync(0);
  expect(f.db.getSetting('qq.session')).toBe('new-login');
  f.request.mockResolvedValueOnce(Response.json({code:200,data:{token:'unexpected-rotation',rotated:true,expiresAt:Date.now()+86400000}}));
  await vi.advanceTimersByTimeAsync(interval);expect(f.db.getSetting('qq.session')).toBe('new-login');expect(console.warn).toHaveBeenCalledOnce();
 }finally{await f.service.close();f.db.close();}
});
it.each([401,429,503])('retains saved credentials after upstream HTTP %s without an immediate retry',async status=>{
 const f=fixture();vi.spyOn(console,'warn').mockImplementation(()=>{});f.request.mockResolvedValueOnce(Response.json({code:status},{status}));
 try{
  f.db.setSetting('qq.session','saved-login');f.service.start();await vi.advanceTimersByTimeAsync(0);
  expect(f.request).toHaveBeenCalledOnce();expect(f.db.getSetting('qq.session')).toBe('saved-login');
  await vi.advanceTimersByTimeAsync(interval-1);expect(f.request).toHaveBeenCalledOnce();
 }finally{await f.service.close();f.db.close();}
});
