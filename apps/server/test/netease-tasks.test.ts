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
  if(name==='vip_tasks')return {body:{code:200,data:{taskList:[{taskItems:[{taskId:'123_7',needReceive:true},{taskId:'124_1',needReceive:true},{taskId:'123_7',needReceive:true},{taskId:'125_1',needReceive:false}]}]}}};
  if(name==='song_detail')return {body:{code:200,songs:[{id:42,dt:185400,al:{id:7}}]}};
  return {body:{code:200}};
 });
 const service=new NeteaseService(db,api,()=>now),log=vi.fn(),tasks=new NeteaseAccountTasks(service,db,()=>now,log);
 drains.push(async()=>{await tasks.stop();db.close();});
 let sequence=0;const report=(source=track,listenedMs=12000)=>{const id=String(++sequence);tasks.observePlayback({type:'start',id,track:source});tasks.observePlayback({type:'finish',id,track:source,listenedMs});};
 return {db,api,service,log,tasks,report,time:(value:number)=>now=value};
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
it('runs Android/PC/yunbei then VIP rewards once per saved credential/day and repeats on the next day',async()=>{
 const f=fixture();await f.tasks.runDaily();await f.tasks.runDaily();
 expect(f.api.mock.calls.map(c=>c[0]).sort()).toEqual(['daily_signin','daily_signin','yunbei_sign','vip_tasks','vip_growthpoint_get'].sort());
 expect(f.api).toHaveBeenCalledWith('daily_signin',expect.objectContaining({type:0,cookie:'MUSIC_U=test-session'}));
 expect(f.api).toHaveBeenCalledWith('daily_signin',expect.objectContaining({type:1,cookie:'MUSIC_U=test-session'}));
 expect(f.api).toHaveBeenCalledWith('vip_growthpoint_get',expect.objectContaining({ids:'123_7,124_1'}));
 f.time(morning+86400000);await f.tasks.runDaily();expect(f.api).toHaveBeenCalledTimes(10);
});
it('schedules 08:00 precisely, persists attempts across service restarts, and stops its timer',async()=>{
 vi.useFakeTimers();const f=fixture();f.time(morning-1000);f.tasks.start();await vi.advanceTimersByTimeAsync(999);expect(f.api).not.toHaveBeenCalled();
 f.time(morning);await vi.advanceTimersByTimeAsync(1);expect(f.api).toHaveBeenCalledTimes(5);await f.tasks.stop();
 const restarted=new NeteaseAccountTasks(f.service,f.db,()=>morning,f.log);restarted.start();await settle();await restarted.stop();
 expect(f.api).toHaveBeenCalledTimes(5);expect(vi.getTimerCount()).toBe(0);
});
it('runs three sign-ins concurrently and waits for all outcomes before fetching rewards',async()=>{
 const f=fixture(),finish=new Map<string,(value:any)=>void>();
 f.api.mockImplementation(async(name,params)=>name==='vip_tasks'?{body:{code:200,data:{unGetIds:[]}}}:new Promise(resolve=>finish.set(name==='daily_signin'?String(params.type):'yunbei',resolve)));
 const work=f.tasks.runDaily();await settle();
 expect([...finish.keys()].sort()).toEqual(['0','1','yunbei']);expect(f.api).toHaveBeenCalledTimes(3);
 expect(f.api.mock.calls.map(c=>c[0])).not.toContain('vip_tasks');
 finish.get('0')!({body:{code:200}});await settle();expect(f.api).toHaveBeenCalledTimes(3);
 finish.get('1')!({body:{code:-2}});await settle();expect(f.api).toHaveBeenCalledTimes(3);
 finish.get('yunbei')!({body:{code:500,cookie:'must-not-log'}});await work;
 expect(f.api.mock.calls.map(c=>c[0])).toEqual(['daily_signin','daily_signin','yunbei_sign','vip_tasks']);
 expect(f.log).toHaveBeenCalledWith(expect.stringContaining('pc 已完成'));
 expect(f.log).toHaveBeenCalledWith(expect.stringContaining('yunbei 未确认成功'));
 expect(f.log.mock.calls.flat().join(' ')).not.toContain('must-not-log');
 await f.tasks.runDaily();expect(f.api).toHaveBeenCalledTimes(4);
});
it('waits for a stalled sign-in timeout, then fetches and claims rewards without retrying the sign-in',async()=>{
 vi.useFakeTimers();const f=fixture(),api=f.api.getMockImplementation()!;
 f.api.mockImplementation(async(name,params)=>name==='daily_signin'&&params.type===0?new Promise(()=>{}):api(name,params));
 const work=f.tasks.runDaily();await settle();
 expect(f.api).toHaveBeenCalledTimes(3);expect(f.api.mock.calls.some(([name])=>name==='vip_tasks')).toBe(false);
 await vi.advanceTimersByTimeAsync(20001);await work;
 expect(f.api.mock.calls.map(([name])=>name)).toEqual(['daily_signin','daily_signin','yunbei_sign','vip_tasks','vip_growthpoint_get']);
 expect(f.log).toHaveBeenCalledWith(expect.stringContaining('android 未确认成功'));
 await f.tasks.runDaily();expect(f.api).toHaveBeenCalledTimes(5);
});
it('adds only the new PC attempt on upgrade when the other daily jobs were already attempted',async()=>{
 const f=fixture(),session=await f.service.accountSessionKey();
 for(const job of ['android','yunbei','vip'])f.db.setSetting(`netease.daily.${session}.${job}`,shanghaiDay(morning));
 await f.tasks.runDaily();expect(f.api).toHaveBeenCalledExactlyOnceWith('daily_signin',expect.objectContaining({type:1}));
 await f.tasks.runDaily();expect(f.api).toHaveBeenCalledOnce();
});
it('does not claim with replacement credentials after the sign-ins have completed',async()=>{
 const f=fixture(),api=f.api.getMockImplementation()!;
 f.api.mockImplementation(async(name,params)=>{const result=await api(name,params);if(name==='yunbei_sign')f.db.setSetting('netease.cookie','MUSIC_U=replacement');return result;});
 await f.tasks.runDaily();expect(f.api).toHaveBeenCalledTimes(3);
 expect(f.api.mock.calls.some(([name])=>name==='vip_tasks'||name==='vip_growthpoint_get')).toBe(false);
});
it('accepts only genuine unclaimed VIP task IDs and does not invent rewards',()=>{
 expect(unclaimedVipIds({data:{taskList:[{taskItems:[{taskId:'12_7',needReceive:true},{taskId:'13_1',needReceive:false},{taskId:'14_2'}]},{taskItems:[{taskId:'12_7',needReceive:true}]}]}})).toBe('12_7');
 expect(unclaimedVipIds({data:{taskList:[]}})).toBe('');
 for(const body of [{data:{taskList:[{}]}},{data:{taskList:[{taskItems:[{taskId:'bad',needReceive:true}]}]}}])expect(()=>unclaimedVipIds(body)).toThrow('NETEASE_INVALID_RESPONSE');
 expect(unclaimedVipIds({data:{unGetIds:[]}})).toBe('');expect(unclaimedVipIds({unGetIds:'12_7,13_1'})).toBe('12_7,13_1');
 for(const body of [{data:{}},{data:{unGetIds:['http://evil']}},{data:{unGetIds:Array(101).fill('1_7')}}])expect(()=>unclaimedVipIds(body)).toThrow('NETEASE_INVALID_RESPONSE');
});
it('submits measured listening time after playback finishes, in an independent queue',async()=>{
 const f=fixture();f.report(track);await new Promise<void>(resolve=>setImmediate(resolve));await settle();
 expect(f.api).toHaveBeenCalledWith('song_detail',expect.objectContaining({ids:'42'}));
 expect(f.api).toHaveBeenCalledWith('scrobble_v1',expect.objectContaining({id:'42',sourceid:'7',time:12,total:185}));
 expect(f.log).toHaveBeenCalledExactlyOnceWith('网易云听歌打卡响应 {"code":200}');
});
it('does not report at start, ignores duplicate completion and skips sub-second listening',async()=>{
 const f=fixture(),event={type:'start' as const,id:'play-1',track};f.tasks.observePlayback(event);f.tasks.observePlayback(event);
 await settle();expect(f.api).not.toHaveBeenCalled();
 f.tasks.observePlayback({type:'finish',id:event.id,track,listenedMs:12345});
 f.tasks.observePlayback({type:'finish',id:event.id,track,listenedMs:12345});f.report(track,999);
 await new Promise<void>(resolve=>setImmediate(resolve));await settle();
 expect(f.api.mock.calls.filter(([name])=>name==='scrobble_v1')).toHaveLength(1);
 expect(f.api).toHaveBeenCalledWith('scrobble_v1',expect.objectContaining({time:12}));
});
it('uses the credential captured at start and never credits a newly logged-in account at finish',async()=>{
 const f=fixture();f.tasks.observePlayback({type:'start',id:'old',track});await settle();
 f.db.setSetting('netease.cookie','MUSIC_U=new-account');
 f.tasks.observePlayback({type:'finish',id:'old',track,listenedMs:12000});
 await new Promise<void>(resolve=>setImmediate(resolve));await settle();expect(f.api).not.toHaveBeenCalled();
});
it('caps reported seconds to both metadata durations and never accepts a missing start',async()=>{
 const f=fixture();f.tasks.observePlayback({type:'finish',id:'missing',track,listenedMs:10000});
 f.report({...track,durationMs:10000},20000);f.report(track,999999);
 await new Promise<void>(resolve=>setImmediate(resolve));await settle();
 expect(f.api.mock.calls.filter(([name])=>name==='scrobble_v1').map(([,params])=>params.time)).toEqual([10,185]);
});
it('prints rejected scrobble responses with credential redaction before the failure notice',async()=>{
 const f=fixture();f.api.mockImplementation(async name=>name==='song_detail'
  ?{body:{code:200,songs:[{id:42,dt:185400,al:{id:7}}]}}
  :{body:{code:502,message:'需要重新登录',cookie:'private-cookie',data:{access_token:'private-token',headers:{'set-cookie':'private-header',Authorization:'private-auth'},note:'MUSIC_U=private-inline;'}}});
 f.report(track);await new Promise<void>(resolve=>setImmediate(resolve));await settle();
 const logs=f.log.mock.calls.flat().join('\n');
 expect(f.log).toHaveBeenCalledTimes(2);
 expect(f.log.mock.calls[0][0]).toContain('网易云听歌打卡响应 {"code":502,"message":"需要重新登录"');
 expect(f.log).toHaveBeenLastCalledWith('网易云听歌记录未确认成功，已跳过，不阻塞播放');
 expect(logs).not.toContain('private-');expect(logs).not.toContain('test-session');
});
it('bounds large response logs and does not drop later listening jobs',async()=>{
 const f=fixture();f.api.mockImplementation(async name=>name==='song_detail'
  ?{body:{code:200,songs:[{id:42,dt:185400,al:{id:7}}]}}
  :{body:{code:200,data:'x'.repeat(10000)}});
 f.report(track);f.report(track);
 await new Promise<void>(resolve=>setImmediate(resolve));await settle();
 expect(f.log).toHaveBeenCalledTimes(2);
 for(const [line] of f.log.mock.calls){expect(line.length).toBeLessThanOrEqual(2060);expect(line).toContain('[TRUNCATED]');}
 expect(f.api.mock.calls.filter(([name])=>name==='scrobble_v1')).toHaveLength(2);
});
it('a stalled scrobble neither serializes search nor blocks daily tasks and has a bounded timeout',async()=>{
 vi.useFakeTimers();const f=fixture();f.api.mockImplementation(async(name)=>{
  if(name==='scrobble_v1')return new Promise(()=>{});
  if(name==='song_detail')return {body:{code:200,songs:[{id:42,dt:185400,al:{id:7}}]}};
  return {body:name==='vip_tasks'?{code:200,data:{unGetIds:[]}}:{code:200}};
 });
 f.report(track);await vi.advanceTimersByTimeAsync(0);
 expect(f.api.mock.calls.some(c=>c[0]==='scrobble_v1')).toBe(true);
 await expect(f.service.call('search',{keywords:'still responsive'})).resolves.toEqual({code:200});
 await f.tasks.runDaily();expect(f.api.mock.calls.some(c=>c[0]==='yunbei_sign')).toBe(true);
 await vi.advanceTimersByTimeAsync(20001);expect(f.log).toHaveBeenCalledWith(expect.stringContaining('听歌记录未确认成功'));
 expect(f.log.mock.calls.some(([line])=>line.startsWith('网易云听歌打卡响应'))).toBe(false);
 expect(f.api.mock.calls.filter(([name])=>name.startsWith('scrobble')).map(([name])=>name)).toEqual(['scrobble_v1']);
});
it('drops queued playback after credential replacement and never reports QQ/unknown-source tracks',async()=>{
 const f=fixture();f.report(track);f.db.setSetting('netease.cookie','MUSIC_U=new-account');
 f.report({...track,neteaseId:undefined,qqId:'QQMID'});
 await new Promise<void>(resolve=>setImmediate(resolve));await settle();expect(f.api).not.toHaveBeenCalled();
});
it('bounds the listening queue and discards waiting jobs on shutdown',async()=>{
 const f=fixture();for(let i=0;i<101;i++)f.report(track);
 expect(f.log).toHaveBeenCalledWith(expect.stringContaining('队列已满'));await f.tasks.stop();
 await new Promise<void>(resolve=>setImmediate(resolve));expect(f.api).not.toHaveBeenCalled();
});
it('keeps maintenance/scrobble private, validates parameters and strips credential/network overrides',async()=>{
 const f=fixture(),session=(await f.service.accountSessionKey())!;
 for(const method of ['daily_signin','yunbei_sign','vip_tasks','vip_growthpoint_get','scrobble','scrobble_v1','scrobble/v1'])await expect(f.service.call(method,{})).rejects.toThrow('NETEASE_METHOD_NOT_ALLOWED');
 await f.service.accountCall('daily_signin',{type:1,cookie:'wrong',proxy:'http://evil'},session);
 expect(f.api).toHaveBeenLastCalledWith('daily_signin',{type:1,cookie:'MUSIC_U=test-session',timestamp:morning});
 await f.service.accountCall('scrobble_v1',{id:'42',sourceid:'7',time:12,total:185,cookie:'wrong',proxy:'http://evil'},session);
 expect(f.api).toHaveBeenLastCalledWith('scrobble_v1',{id:'42',sourceid:'7',time:12,total:185,cookie:'MUSIC_U=test-session',timestamp:morning});
 for(const params of [{id:'42',sourceid:'7',time:Infinity},{id:'bad',sourceid:'7',time:1},{id:'42',sourceid:'7',time:86401,total:86401},{id:'9007199254740993',sourceid:'7',time:2,total:10},{id:'42',sourceid:'7',time:10,total:9}])await expect(f.service.accountCall('scrobble_v1',params,session)).rejects.toThrow('INVALID_REQUEST');
 for(const type of [-1,2,'1',null])await expect(f.service.accountCall('daily_signin',{type},session)).rejects.toThrow('INVALID_REQUEST');
 expect(session).not.toContain('test-session');
});

it('does not begin reward lookup when shutdown starts while sign-ins are pending',async()=>{
 const f=fixture(),api=f.api.getMockImplementation()!;let finish!:(value:any)=>void;
 f.api.mockImplementation(async(name,params)=>name==='daily_signin'&&params.type===0?new Promise(resolve=>finish=resolve):api(name,params));
 f.tasks.start();await settle();expect(f.api).toHaveBeenCalledTimes(3);
 const stopped=f.tasks.stop();finish({body:{code:200}});await stopped;
 expect(f.api).toHaveBeenCalledTimes(3);expect(f.api.mock.calls.some(([name])=>name==='vip_tasks')).toBe(false);
});
