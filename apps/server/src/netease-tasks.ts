import type { Track } from '../../../packages/shared/src';
import type { DatabaseStore } from './database';
import type { NeteaseService } from './netease';
import { DomainError } from './engine';

const DAY=86400000;
export function shanghaiDay(now:number):string{return new Date(now+8*3600000).toISOString().slice(0,10);}
export function nextAccountRun(now:number):number {
 const today=Date.parse(shanghaiDay(now)+'T08:00:00+08:00');return today>now?today:today+DAY;
}
function accepted(body:any):void {if(Number(body?.code)!==200)throw new DomainError('NETEASE_BACKGROUND_REJECTED');}
export function unclaimedVipIds(body:any):string {
 let raw=body?.data?.unGetIds??body?.unGetIds;
 // hana exposes the actual VIP task groups, not a synthetic unGetIds field.
 if(raw===undefined&&Array.isArray(body?.data?.taskList)){
  if(body.data.taskList.length>100)throw new DomainError('NETEASE_INVALID_RESPONSE');
  const groups=body.data.taskList;
  if(groups.some((group:any)=>!Array.isArray(group?.taskItems)||group.taskItems.length>100))throw new DomainError('NETEASE_INVALID_RESPONSE');
  raw=groups.flatMap((group:any)=>group.taskItems.filter((task:any)=>task?.needReceive===true).map((task:any)=>task.taskId));
 }
 const values=Array.isArray(raw)?raw:typeof raw==='string'?(raw?raw.split(','):[]):null;
 if(!values||values.length>100)throw new DomainError('NETEASE_INVALID_RESPONSE');
 const ids=[...new Set(values.map(String))];
 if(ids.some(id=>!/^\d{1,20}(?:_\d{1,10})?$/.test(id)))throw new DomainError('NETEASE_INVALID_RESPONSE');
 return ids.join(',');
}
type ScrobbleJob={id:string;durationMs:number;session:Promise<string|null>};
/** Separate bounded background lanes; no controller, import or playback command awaits them. */
export class NeteaseAccountTasks {
 private timer?:ReturnType<typeof setTimeout>;
 private stopped=false;
 private dailyBusy=false;
 private queue:ScrobbleJob[]=[];
 private pumping=false;
 private inFlight=new Set<Promise<unknown>>();
 constructor(private netease:Pick<NeteaseService,'accountSessionKey'|'accountCall'>,private db:Pick<DatabaseStore,'getSetting'|'setSetting'>,private now=Date.now,private log:(message:string)=>void=message=>console.warn(message)){}
 private track<T>(work:Promise<T>):Promise<T>{this.inFlight.add(work);void work.then(()=>this.inFlight.delete(work),()=>this.inFlight.delete(work));return work;}
 start(){
  this.stopped=false;this.schedule();
  // Catch up today's run after a restart, but never backfill previous days.
  if(this.now()>=Date.parse(shanghaiDay(this.now())+'T08:00:00+08:00'))void this.track(this.runDaily());
 }
 private schedule(){
  clearTimeout(this.timer);if(this.stopped)return;
  this.timer=setTimeout(()=>{this.schedule();void this.track(this.runDaily());},nextAccountRun(this.now())-this.now());this.timer.unref?.();
 }
 async runDaily():Promise<void>{
  if(this.dailyBusy||this.stopped||this.now()<Date.parse(shanghaiDay(this.now())+'T08:00:00+08:00'))return;this.dailyBusy=true;
  try{
   const session=await this.netease.accountSessionKey();if(!session||this.stopped)return;
   const day=shanghaiDay(this.now());
   const runJob=async(job:'android'|'pc'|'yunbei'|'vip')=>{
    try{
     const key=`netease.daily.${session}.${job}`;
     if(await this.db.getSetting(key)===day||this.stopped)return;
     // Mark the attempt before a side effect: timeout/restart must not duplicate an ambiguous reward.
     await this.db.setSetting(key,day);if(this.stopped)return;
     if(job==='android'||job==='pc'){
      const body=await this.netease.accountCall('daily_signin',{type:job==='android'?0:1},session);
      const result=body?.[job]??body;
      if(Number(body?.code)!==-2&&Number(result?.code)!==-2)accepted(result);
     }else if(job==='yunbei')accepted(await this.netease.accountCall('yunbei_sign',{},session));
     else {
      const tasks=await this.netease.accountCall('vip_tasks',{},session);accepted(tasks);
      const ids=unclaimedVipIds(tasks);
      if(ids&&!this.stopped)accepted(await this.netease.accountCall('vip_growthpoint_get',{ids},session));
     }
     this.log(`网易云后台任务 ${job} 已完成或无待领取奖励`);
    }catch{this.log(`网易云后台任务 ${job} 未确认成功，当日不自动重复领取`);}
   };
   // Wait for all three attempts (including failures/timeouts) before inspecting rewards.
   await Promise.all((['android','pc','yunbei'] as const).map(runJob));
   if(!this.stopped)await runJob('vip');
  }catch{this.log('网易云后台任务无法读取登录态');}
  finally{this.dailyBusy=false;}
 }
 enqueueScrobble(track:Track){
  if(this.stopped||!track.neteaseId||!/^\d{1,20}$/.test(track.neteaseId)||!Number.isFinite(track.durationMs)||track.durationMs<1000)return;
  if(this.queue.length>=100){this.log('网易云听歌记录队列已满，本次记录未提交');return;}
  // Capture the credential identity now, so queued old playback never credits a newly logged-in account.
  const session=this.netease.accountSessionKey().catch(()=>null);
  this.queue.push({id:track.neteaseId,durationMs:track.durationMs,session});
  if(!this.pumping){this.pumping=true;setImmediate(()=>{void this.track(this.pump());});}
 }
 private async pump(){
  try{
   while(!this.stopped&&this.queue.length){
    const job=this.queue.shift()!;
    try{
     const session=await job.session;if(!session||this.stopped)continue;
     const detail=await this.netease.accountCall('song_detail',{ids:job.id},session);accepted(detail);
     const song=Array.isArray(detail.songs)?detail.songs.find((song:any)=>String(song?.id)===job.id):null;
     const album=song?.al?.id??song?.album?.id,total=Number(song?.dt??song?.duration);
     if(!/^\d{1,20}$/.test(String(album??''))||!Number.isFinite(total)||total<1000)throw new DomainError('NETEASE_INVALID_RESPONSE');
     const time=Math.floor(Math.min(job.durationMs,total)/1000);
     if(time<1||this.stopped)continue;
     const response=await this.netease.accountCall('scrobble',{id:job.id,sourceid:String(album),time},session);
     accepted(response);
    }catch{this.log('网易云听歌记录未确认成功，已跳过，不阻塞播放');}
   }
  }finally{this.pumping=false;}
 }
 async stop(){this.stopped=true;clearTimeout(this.timer);this.queue=[];await Promise.allSettled([...this.inFlight]);}
}
