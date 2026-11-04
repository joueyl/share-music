import { afterEach,expect,it,vi } from 'vitest';
import { Database } from '../src/database';
import { NeteaseService } from '../src/netease';
import { NeteaseAccountTasks,nextAccountRun,shanghaiDay,unclaimedVipIds } from '../src/netease-tasks';
import type { Track } from '../../../packages/shared/src';
const morning=Date.parse('2026-11-04T08:00:00+08:00');
const track={id:'track',name:'歌曲',neteaseId:'42',durationMs:185400,available:true,providerId:'member'} as Track;
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const drains:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of drains.splice(0))await close();vi.useRealTimers();});
function fixture(cookie='MUSIC_U=test-session'){
 const db=new Database(':memory:');db.setSetting('netease.cookie',cookie);let now=morning;
 const api=vi.fn(async(name:string,_params:Record<string,unknown>):Promise<any>=>{
  if(name==='vip_tasks')return {body:{code:200,data:{unGetIds:['123_7','124_1','123_7']}}};
  if(name==='song_detail')return {body:{code:200,songs:[{id:42,dt:185400,al:{id:7}}]}};
  return {body:{code:200}};
 });
 const service=new NeteaseService(db,api,()=>now),log=vi.fn(),tasks=new NeteaseAccountTasks(service,db,()=>now,log);
 drains.push(async()=>{await tasks.stop();db.close();});
 return {db,api,service,log,tasks,time:(value:number)=>now=value};
}
it('calculates 08:00 Asia/Shanghai independently of the host timezone and rolls over dates',()=>{
 expect(nextAccountRun(morning-1)).toBe(morning);expect(nextAccountRun(morning)).toBe(morning+86400000);
 expect(shanghaiDay(Date.parse('2026-12-31T16:00:00Z'))).toBe('2027-01-01');
 expect(nextAccountRun(Date.parse('2026-12-31T16:00:00Z'))).toBe(Date.parse('2027-01-01T00:00:00Z'));
});
it('does not call authenticated jobs without MUSIC_U or before 08:00',async()=>{
 const f=fixture('__csrf=test');await f.tasks.runDaily();expect(f.api).not.toHaveBeenCalled();
 f.db.setSetting('netease.cookie','MUSIC_U=test-session');f.time(morning-1);await f.tasks.runDaily();expect(f.api).not.toHaveBeenCalled();
});
it('runs Android/yunbei/VIP rewards once per saved credential/day and repeats on the next day',async()=>{
 const f=fixture();await f.tasks.runDaily();await f.tasks.runDaily();
 expect(f.api.mock.calls.map(c=>c[0]).sort()).toEqual(['daily_signin','yunbei_sign','vip_tasks','vip_growthpoint_get'].sort());
 expect(f.api).toHaveBeenCalledWith('daily_signin',expect.objectContaining({type:0,cookie:'MUSIC_U=test-session'}));
 expect(f.api).toHaveBeenCalledWith('vip_growthpoint_get',expect.objectContaining({ids:'123_7,124_1'}));
 f.time(morning+86400000);await f.tasks.runDaily();expect(f.api).toHaveBeenCalledTimes(8);
});
it('schedules 08:00 precisely, persists attempts across service restarts, and stops its timer',async()=>{
 vi.useFakeTimers();const f=fixture();f.time(morning-1000);f.tasks.start();await vi.advanceTimersByTimeAsync(999);expect(f.api).not.toHaveBeenCalled();
 f.time(morning);await vi.advanceTimersByTimeAsync(1);expect(f.api).toHaveBeenCalledTimes(4);await f.tasks.stop();
 const restarted=new NeteaseAccountTasks(f.service,f.db,()=>morning,f.log);restarted.start();await settle();await restarted.stop();
 expect(f.api).toHaveBeenCalledTimes(4);expect(vi.getTimerCount()).toBe(0);
});
it('one stalled daily job does not block the other tasks, and a timeout is not treated as success',async()=>{
 const f=fixture();let finish!:(value:any)=>void;
 f.api.mockImplementation(async name=>name==='daily_signin'?new Promise(resolve=>finish=resolve):{body:name==='vip_tasks'?{code:200,data:{unGetIds:[]}}:{code:200}});
 const work=f.tasks.runDaily();await settle();
 expect(f.api.mock.calls.map(c=>c[0])).toContain('yunbei_sign');expect(f.api.mock.calls.map(c=>c[0])).toContain('vip_tasks');
 finish({body:{code:500,cookie:'must-not-log'}});await work;
 expect(f.log.mock.calls.flat().join(' ')).not.toContain('must-not-log');
 expect(f.log).toHaveBeenCalledWith(expect.stringContaining('android 未确认成功'));await f.tasks.runDaily();expect(f.api).toHaveBeenCalledTimes(3);
});
it('accepts only genuine unclaimed VIP task IDs and does not invent rewards',()=>{
 expect(unclaimedVipIds({data:{unGetIds:[]}})).toBe('');expect(unclaimedVipIds({unGetIds:'12_7,13_1'})).toBe('12_7,13_1');
 for(const body of [{data:{}},{data:{unGetIds:['http://evil']}},{data:{unGetIds:Array(101).fill('1_7')}}])expect(()=>unclaimedVipIds(body)).toThrow('NETEASE_INVALID_RESPONSE');
});
it('submits full song duration while playback is ongoing, in an independent queue',async()=>{
 const f=fixture();f.tasks.enqueueScrobble(track);await new Promise<void>(resolve=>setImmediate(resolve));await settle();
 expect(f.api).toHaveBeenCalledWith('song_detail',expect.objectContaining({ids:'42'}));
 expect(f.api).toHaveBeenCalledWith('scrobble',expect.objectContaining({id:'42',sourceid:'7',time:185}));
});
it('a stalled scrobble neither serializes search nor blocks daily tasks and has a bounded timeout',async()=>{
 vi.useFakeTimers();const f=fixture();f.api.mockImplementation(async(name)=>{
  if(name==='scrobble')return new Promise(()=>{});
  if(name==='song_detail')return {body:{code:200,songs:[{id:42,dt:185400,al:{id:7}}]}};
  return {body:name==='vip_tasks'?{code:200,data:{unGetIds:[]}}:{code:200}};
 });
 f.tasks.enqueueScrobble(track);await vi.advanceTimersByTimeAsync(0);
 expect(f.api.mock.calls.some(c=>c[0]==='scrobble')).toBe(true);
 await expect(f.service.call('search',{keywords:'still responsive'})).resolves.toEqual({code:200});
 await f.tasks.runDaily();expect(f.api.mock.calls.some(c=>c[0]==='yunbei_sign')).toBe(true);
 await vi.advanceTimersByTimeAsync(20001);expect(f.log).toHaveBeenCalledWith(expect.stringContaining('听歌记录未确认成功'));
});
it('drops queued playback after credential replacement and never reports QQ/unknown-source tracks',async()=>{
 const f=fixture();f.tasks.enqueueScrobble(track);f.db.setSetting('netease.cookie','MUSIC_U=new-account');
 f.tasks.enqueueScrobble({...track,neteaseId:undefined,qqId:'QQMID'});
 await new Promise<void>(resolve=>setImmediate(resolve));await settle();expect(f.api).not.toHaveBeenCalled();
});
it('bounds the listening queue and discards waiting jobs on shutdown',async()=>{
 const f=fixture();for(let i=0;i<101;i++)f.tasks.enqueueScrobble(track);
 expect(f.log).toHaveBeenCalledWith(expect.stringContaining('队列已满'));await f.tasks.stop();
 await new Promise<void>(resolve=>setImmediate(resolve));expect(f.api).not.toHaveBeenCalled();
});
it('keeps maintenance/scrobble private, validates parameters and strips credential/network overrides',async()=>{
 const f=fixture(),session=(await f.service.accountSessionKey())!;
 for(const method of ['daily_signin','yunbei_sign','vip_tasks','vip_growthpoint_get','scrobble'])await expect(f.service.call(method,{})).rejects.toThrow('NETEASE_METHOD_NOT_ALLOWED');
 await f.service.accountCall('daily_signin',{type:1,cookie:'wrong',proxy:'http://evil'},session);
 expect(f.api).toHaveBeenLastCalledWith('daily_signin',{type:0,cookie:'MUSIC_U=test-session',timestamp:morning});
 for(const params of [{id:'42',sourceid:'7',time:Infinity},{id:'bad',sourceid:'7',time:1},{id:'42',sourceid:'7',time:86401}])await expect(f.service.accountCall('scrobble',params,session)).rejects.toThrow('INVALID_REQUEST');
 expect(session).not.toContain('test-session');
});
