import { randomUUID } from 'node:crypto';
import type { DatabaseStore } from './database';
import { DomainError } from './engine';
import { EmbeddedQqRuntime } from './qq-runtime';
import { setTimeout as delay } from 'node:timers/promises';

class QqUpstreamFailure extends DomainError {
 constructor(readonly retryable:boolean,readonly status?:number,readonly upstreamCode?:number){super('QQ_MUSIC_UNAVAILABLE');}
}

export const qqMid = /^[A-Za-z0-9]{1,80}$/;
export type QqChannel = 'qq' | 'wechat' | 'qqmusic';
export class QqMusicService {
 private generation = 0;
 private attempt?: { id:string; key:string; expiresAt:number; lastCheck:number; code:number; pending?:Promise<{code:number}> };
 private runtime?:EmbeddedQqRuntime;
 private searches=new Map<string,Promise<ReturnType<typeof qqSearchResult>>>();
 private searchCache=new Map<string,{at:number;result:ReturnType<typeof qqSearchResult>}>();
 constructor(private db:DatabaseStore, private endpoint:string|undefined=process.env.QQ_MUSIC_API_URL?.trim()||undefined, private request:typeof fetch=fetch, private now=Date.now) {
  if(endpoint===undefined)this.runtime=new EmbeddedQqRuntime(db);
 }
 async close(){await this.runtime?.close();}
 private async call(path:string, params:Record<string,string>={}, token?:string,signal=AbortSignal.timeout(20000)) {
  if(this.endpoint==='')throw new DomainError('QQ_MUSIC_NOT_CONFIGURED');
  try {
   const base=new URL(this.endpoint??await this.runtime!.url());
   if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash)throw Error();
   const url=new URL(base.href.replace(/\/$/,'')+path);url.search=new URLSearchParams(params).toString();
   const response=await this.request(url,{redirect:'error',signal,headers:token?{'X-QQ-Session':token}:{}});
   if(response.status===401){await response.body?.cancel();throw new DomainError('QQ_LOGIN_REQUIRED');}
   if(response.status===429){await response.body?.cancel();throw new DomainError('QQ_MUSIC_RATE_LIMITED');}
   if(!response.body)throw new QqUpstreamFailure(!response.ok&&[502,503,504].includes(response.status));
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
   try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024)throw new DomainError('QQ_INVALID_RESPONSE');chunks.push(value);}}
   finally{await reader.cancel().catch(()=>{});}
   let data:any;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{if(!response.ok)throw new QqUpstreamFailure([502,503,504].includes(response.status));throw new DomainError('QQ_INVALID_RESPONSE');}
   if(path==='/search/suggest'&&response.status===422&&data?.errorKey==='resource.not-found')return {code:200,suggestions:[]};
   if(!response.ok)throw new QqUpstreamFailure(data?.retryable!==false&&[502,503,504].includes(response.status),response.status,Number.isSafeInteger(data?.upstreamCode)?data.upstreamCode:undefined);
   return data;
  }catch(e){if(e instanceof DomainError)throw e;throw new QqUpstreamFailure(true);}
 }
 private async session(){return await this.db.getSetting('qq.session')||undefined;}
 async channels(){
  const data=await this.call('/login/channels');
  if(data.code!==200||!Array.isArray(data.data?.channels))throw new DomainError('QQ_INVALID_RESPONSE');
  return {channels:data.data.channels.filter((v:unknown)=>['qq','wechat','qqmusic'].includes(String(v))) as QqChannel[]};
 }
 async suggest(keyword:string){
  const data=await this.call('/search/suggest',{keyword});
  if(data?.code!==200||!Array.isArray(data.suggestions))throw new DomainError('QQ_INVALID_RESPONSE');
  return {suggestions:[...new Set<string>(data.suggestions.filter((v:unknown):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=60).map((v:string)=>v.trim()))].slice(0,8)};
 }
 async begin(channel:QqChannel){
  const version=++this.generation,previous=this.attempt;this.attempt=undefined;
  if(previous&&previous.code!==803)void this.call('/login/qr/cancel',{key:previous.key}).catch(()=>{});
  const available=await this.channels();if(!available.channels.includes(channel))throw new DomainError('QQ_CHANNEL_UNAVAILABLE');
  const key=(await this.call('/login/qr/key',{channel}))?.data?.unikey;
  if(typeof key!=='string'||!key||key.length>2000)throw new DomainError('QQ_INVALID_RESPONSE');
  const image=(await this.call('/login/qr/create',{key}))?.data?.qrimg;
  if(version!==this.generation){void this.call('/login/qr/cancel',{key}).catch(()=>{});throw new DomainError('QQ_LOGIN_REPLACED');}
  if(typeof image!=='string'||image.length>500000||!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image))throw new DomainError('QQ_INVALID_RESPONSE');
  this.attempt={id:randomUUID(),key,expiresAt:this.now()+180000,lastCheck:-Infinity,code:801};
  return {sessionId:this.attempt.id,image,expiresAt:this.attempt.expiresAt};
 }
 async cancel(id:string){
  const a=this.attempt;if(!a||a.id!==id)return {ok:true};
  ++this.generation;this.attempt=undefined;
  await this.call('/login/qr/cancel',{key:a.key});return {ok:true};
 }
 async status(){
  const token=await this.session();if(!token)return {loggedIn:false};
  const data=await this.call('/login/status',{},token);return {loggedIn:data.code===200&&!!data.data?.profile};
 }
 async check(id:string):Promise<{code:number}>{
  const a=this.attempt,version=this.generation;
  if(!a||a.id!==id)throw new DomainError('QQ_LOGIN_REPLACED');
  if(a.code===803)return {code:803};
  if(a.expiresAt<=this.now())return {code:800};
  if(a.pending)return a.pending;
  if(this.now()-a.lastCheck<2000)return {code:a.code};
  a.lastCheck=this.now();
  a.pending=(async()=>{
   const result=await this.call('/login/qr/check',{key:a.key});
   if(version!==this.generation||this.attempt!==a)throw new DomainError('QQ_LOGIN_REPLACED');
   if(![800,801,802,803].includes(result.code))throw new DomainError('QQ_INVALID_RESPONSE');
   if(result.code===803){
    const cookie=typeof result.cookie==='string'?result.cookie:'';
    const token=/\bqqmusic_session=([^;\s]+)/.exec(cookie)?.[1];
    if(!token||token.length>16000||!/^[-\w.~]+$/.test(token))throw new DomainError('QQ_INVALID_RESPONSE');
    const status=await this.call('/login/status',{},token);
    if(status.code!==200||!status.data?.profile)throw new DomainError('QQ_LOGIN_REQUIRED');
    if(version!==this.generation||this.attempt!==a)throw new DomainError('QQ_LOGIN_REPLACED');
    await this.db.setSetting('qq.session',token);
   }
   a.code=result.code;return {code:a.code};
  })().finally(()=>{a.pending=undefined;});return a.pending;
 }
 async search(keyword:string,offset:number){
  const key=JSON.stringify([keyword,offset]),cached=this.searchCache.get(key);
  if(cached&&this.now()-cached.at<15000)return cached.result;
  const prior=this.searches.get(key);if(prior)return prior;
  if(this.searches.size>=32)throw new DomainError('QQ_MUSIC_UNAVAILABLE');
  const job=this.searchCatalog(keyword,offset).then(result=>{
   this.searchCache.delete(key);this.searchCache.set(key,{at:this.now(),result});
   if(this.searchCache.size>64)this.searchCache.delete(this.searchCache.keys().next().value!);
   return result;
  }).finally(()=>this.searches.delete(key));
  this.searches.set(key,job);return job;
 }
 private async searchCatalog(keyword:string,offset:number){
  // This is public catalog metadata. Do not send the global playback session:
  // 3.3.5 uses a different upstream song search mode for authenticated sessions.
  const signal=AbortSignal.timeout(20000),params={keyword,type:'song',page:String(offset/20+1),limit:'20'};
  for(let attempt=0;;attempt++){
   try{return qqSearchResult(await this.call('/search',params,undefined,signal),offset);}
   catch(error){
    if(attempt||!(error instanceof QqUpstreamFailure)||!error.retryable||signal.aborted){
     console.warn('QQ catalog search failed',{code:error instanceof DomainError?error.code:'QQ_MUSIC_UNAVAILABLE',...(error instanceof QqUpstreamFailure?{upstreamStatus:error.status,upstreamCode:error.upstreamCode}:{})});
     throw error;
    }
    try{await delay(200,undefined,{signal});}catch{throw error;}
   }
  }
 }
 async songDetail(mid:string){
  if(!qqMid.test(mid))throw new DomainError('INVALID_REQUEST');
  const detail=await this.call('/getSongInfo',{songmid:mid},await this.session());
  const song=detail.response?.songinfo?.data?.track_info;
  if(detail.response?.code!==0||detail.response?.songinfo?.code!==0||!song||String(song.mid??song.songmid)!==mid)throw new DomainError('QQ_INVALID_RESPONSE');
  return qqSong(song);
 }
 async audio(mid:string){
  const [detail,source]=await Promise.all([this.call('/getSongInfo',{songmid:mid},await this.session()),this.call('/getMusicPlay/'+mid,{quality:'128'},await this.session())]);
  const song=detail.response?.songinfo?.data?.track_info;
  if(detail.response?.code!==0||detail.response?.songinfo?.code!==0||!song||String(song.mid??song.songmid)!==mid)throw new DomainError('QQ_INVALID_RESPONSE');
  const audio=source.data?.playUrl?.[mid];
  if(audio?.preview)throw new DomainError('MUSIC_TRIAL_ONLY');
  if(!audio?.url||audio.error)throw new DomainError('MUSIC_NOT_AVAILABLE');
  return {song:qqSong(song),url:String(audio.url),detail:song};
 }
 async lyrics(mid:string){
  const data=await this.call('/getLyric',{songmid:mid,trans:'1'},await this.session());
  if(data.response?.code!==0)throw new DomainError('QQ_MUSIC_UNAVAILABLE');
  return {lrc:{lyric:typeof data.response.lyric==='string'?data.response.lyric:''},tlyric:{lyric:typeof data.response.trans==='string'?data.response.trans:''}};
 }
}
function qqSearchResult(data:any,offset:number){
 if(data?.code!==200||!Array.isArray(data.items))throw new DomainError('QQ_INVALID_RESPONSE');
 const songs=data.items.map((song:any)=>qqSong(song));
 return {songs,total:Number.isSafeInteger(data.total)&&data.total>=0?data.total:offset+songs.length+(data.more?1:0)};
}
export function qqSong(song:any){
 const id=String(song?.mid??song?.songmid??song?.songMID??'');
 if(!qqMid.test(id)||typeof (song.name??song.songname)!=='string'||!(song.name??song.songname).trim()||!Array.isArray(song.singer)||!Number.isFinite(Number(song.interval))||Number(song.interval)<=0)throw new DomainError('QQ_INVALID_RESPONSE');
 const album=song.album??{},albumMid=String(album.mid??song.albummid??'');
 return {id,name:String(song.name??song.songname??''),artists:(song.singer??[]).map((s:any)=>s.name).filter((s:unknown)=>typeof s==='string').join(' / '),
  album:String(album.name??song.albumname??''),durationMs:Math.round(Number(song.interval)*1000),
  coverUrl:qqMid.test(albumMid)?`https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`:''};
}
