import { createHash, randomUUID } from 'node:crypto';
import { DomainError, RoomEngine } from './engine';
import type { TrackMetadata } from '../../../packages/shared/src';
import { normalizeAlbumCover, trackSchema } from '../../../packages/shared/src';
import { NeteaseService } from './netease';
import type { Database } from './database';
import { OssStorage } from './oss';
const MAX = 100 * 1024 * 1024;
export function musicDownloadUrl(input: string): URL {
  let url: URL; try { url = new URL(input); } catch { throw new DomainError('MUSIC_SOURCE_INVALID'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || !/^[a-z0-9-]+\.music\.126\.net$/i.test(url.hostname)) throw new DomainError('MUSIC_SOURCE_INVALID');
  url.protocol = 'https:'; return url;
}
export async function downloadMusic(input: string, request: typeof fetch = fetch): Promise<Buffer> {
  const signal = AbortSignal.timeout(60000); let url = musicDownloadUrl(input);
  try {
    for (let i=0;i<4;i++) {
      const res = await request(url, { redirect: 'manual', signal });
      if ([301,302,303,307,308].includes(res.status)) {
        const location=res.headers.get('location'); await res.body?.cancel();
        if (!location) throw new DomainError('MUSIC_DOWNLOAD_FAILED');
        url=musicDownloadUrl(new URL(location,url).href); continue;
      }
      if (!res.ok || !res.body) { await res.body?.cancel(); throw new DomainError('MUSIC_DOWNLOAD_FAILED'); }
      const length=Number(res.headers.get('content-length') ?? 0);
      if (length > MAX) { await res.body.cancel(); throw new DomainError('MUSIC_TOO_LARGE'); }
      const reader=res.body.getReader(), chunks:Uint8Array[]=[];let size=0;
      try { while(true) {const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX)throw new DomainError('MUSIC_TOO_LARGE');chunks.push(value);} }
      finally { await reader.cancel().catch(()=>{}); }
      if (!size) throw new DomainError('MUSIC_DOWNLOAD_FAILED');
      return Buffer.concat(chunks);
    }
    throw new DomainError('MUSIC_DOWNLOAD_FAILED');
  } catch(error) { if (error instanceof DomainError) throw error; throw new DomainError('MUSIC_DOWNLOAD_FAILED'); }
}
/** Read MP3 frame metadata without invoking third-party file parsers. */
export function mp3Spec(bytes: Buffer) {
  let start=0;
  if(bytes.subarray(0,3).toString()==='ID3' && bytes.length>=10) start=10+((bytes[6]&127)<<21)+((bytes[7]&127)<<14)+((bytes[8]&127)<<7)+(bytes[9]&127);
  for(let i=start;i<Math.min(bytes.length-4,start+65536);i++) {
    if(bytes[i]!==255 || (bytes[i+1]&224)!==224)continue;
    const version=(bytes[i+1]>>3)&3,layer=(bytes[i+1]>>1)&3,index=(bytes[i+2]>>2)&3,bitrate=(bytes[i+2]>>4)&15;
    if(version===1 || layer!==1 || index===3 || !bitrate || bitrate===15)continue;
    return {sampleRate:[44100,48000,32000][index]/(version===3?1:version===2?2:4),bits:16,channels:(bytes[i+3]>>6)===3?1:2};
  }
  throw new DomainError('MUSIC_AUDIO_UNSUPPORTED');
}
export function songFilename(song:{name?:unknown;ar?:unknown;artists?:unknown}):string {
  const raw=Array.isArray(song.ar)&&song.ar.length?song.ar:song.artists;
  const artists=Array.isArray(raw)?[...new Set(raw.map(a=>a?.name).filter((name:unknown):name is string=>typeof name==='string'&&!!name.trim()).map(name=>name.trim()))]:[];
  if(typeof song.name!=='string'||!song.name.trim()||!artists.length)throw new DomainError('MUSIC_SOURCE_INVALID');
  return `${song.name.trim()} - ${artists.join('、')}.mp3`;
}
type Job={songId:string;roomId:string;promise:Promise<TrackMetadata>;at:number};
export function songCover(song:any):string|null {
  return normalizeAlbumCover(song?.al?.picUrl??song?.album?.picUrl);
}
export class MusicImport {
  private jobs=new Map<string,Job>(); private active=0;
  private sources=new Map<string,Promise<TrackMetadata>>();
  constructor(private engine:RoomEngine, private netease:Pick<NeteaseService,'call'>, private oss:Pick<OssStorage,'upload'> & Partial<Pick<OssStorage,'exists'|'scope'|'staticUrl'>>, private request:typeof fetch=fetch, private db?:Database) {}
  metadata(roomId:string,userId:string,trackId:string):TrackMetadata {
    const room=this.engine.snapshot(roomId);
    if(!room.members.some(m=>m.id===userId&&m.online))throw new DomainError('NOT_IN_ROOM');
    const track=room.playlist.find(t=>t.id===trackId);if(!track)throw new DomainError('TRACK_NOT_FOUND');
    const saved=this.db?.getMusicSourceByHash(this.oss.scope?.()??'default',track.contentHash);
    if(!saved||saved.track.ossKey!==track.ossKey)return track;
    const neteaseId=/^netease:standard:(\d{1,20})$/.exec(saved.source)?.[1];
    return {...saved.track,id:track.id,...(neteaseId?{neteaseId}:{})};
  }
  async cover(roomId:string,userId:string,trackId:string):Promise<string|null> {
    const room=this.engine.snapshot(roomId);
    if(!room.members.some(m=>m.id===userId&&m.online))throw new DomainError('NOT_IN_ROOM');
    const track=room.playlist.find(t=>t.id===trackId);
    if(!track)throw new DomainError('TRACK_NOT_FOUND');
    const current=normalizeAlbumCover(track.coverUrl);if(current)return current;
    const scope=this.oss.scope?.()??'default',cached=this.db?.getMusicSourceByHash(scope,track.contentHash);
    if(!cached||cached.track.ossKey!==track.ossKey)return null;
    const saved=normalizeAlbumCover(cached.track.coverUrl);if(saved)return saved;
    const songId=/^netease:standard:(\d{1,20})$/.exec(cached.source)?.[1];if(!songId)return null;
    const detail=await this.netease.call('song_detail',{ids:songId});
    const song=detail.songs?.find((s:any)=>String(s.id)===songId);if(!song)return null;
    const coverUrl=songCover(song);
    this.db?.saveMusicSource(scope,cached.source,{...cached.track,coverUrl});return coverUrl;
  }
  private room(roomId:string,userId:string) {
    const room=this.engine.snapshot(roomId),member=room.members.find(m=>m.id===userId&&m.online);
    if(!member)throw new DomainError('NOT_IN_ROOM');
    if(!member.permissions.enqueue)throw new DomainError('FORBIDDEN');
    if(room.playlist.length>=200)throw new DomainError('PLAYLIST_FULL');return room;
  }
  add(roomId:string,userId:string,songId:string,requestId:string):Promise<TrackMetadata> {
    return this.enqueueJob(roomId,userId,songId,requestId,()=>this.perform(roomId,userId,songId,requestId));
  }
  addUploaded(roomId:string,userId:string,hash:string,requestId:string):Promise<TrackMetadata> {
    return this.enqueueJob(roomId,userId,`uploaded:${hash}`,requestId,async()=>{
      const scope=this.oss.scope?.()??'default';
      if(!this.db?.getAsset(scope,hash))throw new DomainError('TRACK_NOT_FOUND');
      const asset=this.db.uploadedTrack(scope,hash);
      if(!asset?.ossKey)throw new DomainError('UPLOADED_MUSIC_METADATA_MISSING');
      if(!this.oss.exists||!await this.oss.exists(asset.ossKey))throw new DomainError('UPLOADED_MUSIC_NOT_FOUND');
      const room=this.room(roomId,userId),track=trackSchema.parse({...asset,id:randomUUID(),
        ...(this.oss.staticUrl?{ossUrl:this.oss.staticUrl(asset.ossKey)}:{})});
      this.engine.command(userId,{roomId,commandId:requestId,expectedStateVersion:room.stateVersion,action:{type:'enqueue',payload:track}});
      return track;
    });
  }
  private enqueueJob(roomId:string,userId:string,songId:string,requestId:string,run:()=>Promise<TrackMetadata>):Promise<TrackMetadata> {
    const key=userId+':'+requestId,prior=this.jobs.get(key);
    if(prior) {if(prior.songId!==songId||prior.roomId!==roomId)throw new DomainError('COMMAND_ID_REUSED');return prior.promise;}
    this.room(roomId,userId);
    if(this.active>=2)throw new DomainError('MUSIC_IMPORT_BUSY');
    for(const [k,j]of this.jobs)if(Date.now()-j.at>3600000)this.jobs.delete(k);
    if(this.jobs.size>=1000)throw new DomainError('MUSIC_IMPORT_BUSY');
    this.active++;
    const promise=run().finally(()=>this.active--);
    this.jobs.set(key,{songId,roomId,promise,at:Date.now()});
    void promise.catch(()=>this.jobs.delete(key));return promise;
  }
  private async perform(roomId:string,userId:string,songId:string,requestId:string):Promise<TrackMetadata> {
    const scope=this.oss.scope?.() ?? 'default',sourceId=`netease:standard:${songId}`,lock=scope+':'+sourceId;
    let job=this.sources.get(lock);
    if(!job){job=this.asset(roomId,userId,songId,scope,sourceId).finally(()=>this.sources.delete(lock));this.sources.set(lock,job);}
    const asset=await job;
    const room=this.room(roomId,userId),complete={...asset,id:randomUUID()};
    this.engine.command(userId,{roomId,commandId:requestId,expectedStateVersion:room.stateVersion,action:{type:'enqueue',payload:complete}});
    return complete;
  }
  private async asset(roomId:string,userId:string,songId:string,scope:string,sourceId:string):Promise<TrackMetadata> {
    const cached=this.db?.getMusicSource(scope,sourceId);
    if(cached?.ossKey && this.oss.exists && await this.oss.exists(cached.ossKey)){
      const track=trackSchema.parse(cached);
      track.neteaseId=songId;
      if(this.oss.staticUrl)track.ossUrl=this.oss.staticUrl(track.ossKey!);
      // Backfill older cached assets without downloading or uploading audio again.
      if(track.coverUrl===undefined){
        try{
          const detail=await this.netease.call('song_detail',{ids:songId});
          const song=detail.songs?.find((s:any)=>String(s.id)===songId);
          if(song){track.coverUrl=songCover(song);this.db?.saveMusicDetail(scope,sourceId,song);}
        }catch{/* Optional artwork must not prevent playback of a cached asset. */}
      }
      this.db?.saveMusicSource(scope,sourceId,track);return track;
    }
    const [detail,source]=await Promise.all([this.netease.call('song_detail',{ids:songId}),this.netease.call('song_url_v1',{id:songId,level:'standard'})]);
    const song=detail.songs?.find((s:any)=>String(s.id)===songId),audio=source.data?.find((s:any)=>String(s.id)===songId);
    if(!song || !audio?.url || (audio.code && audio.code!==200))throw new DomainError('MUSIC_NOT_AVAILABLE');
    if(audio.freeTrialInfo)throw new DomainError('MUSIC_TRIAL_ONLY');
    if(audio.type && audio.type.toLowerCase()!=='mp3')throw new DomainError('MUSIC_AUDIO_UNSUPPORTED');
    const filename=songFilename(song);
    const bytes=await downloadMusic(audio.url,this.request),spec=mp3Spec(bytes);
    const durationMs=Math.round(Number(song.dt ?? song.duration));
    if(typeof song.name!=='string' || !song.name.trim() || !Number.isFinite(durationMs) || durationMs<1 || durationMs>86400000)throw new DomainError('MUSIC_SOURCE_INVALID');
    const track=trackSchema.parse({id:randomUUID(),name:String(song.name).slice(0,200),durationMs,sizeBytes:bytes.length,spec,lossless:false,bitrateBps:Math.max(1,Math.min(20000000,Math.round(Number(audio.br)||bytes.length*8000/durationMs))),contentHash:createHash('sha256').update(bytes).digest('hex')});
    this.room(roomId,userId); // Permissions may have changed while downloading.
    const {ossKey}=await this.oss.upload(userId,bytes,filename);
    const complete=trackSchema.parse({...track,ossKey,coverUrl:songCover(song),neteaseId:songId,
      artists:(song.ar??song.artists??[]).map((a:any)=>a.name).filter(Boolean).join(' / ').slice(0,1000),
      album:String(song.al?.name??song.album?.name??'').slice(0,500),
      ...(this.oss.staticUrl?{ossUrl:this.oss.staticUrl(ossKey)}:{})});
    this.db?.saveMusicDetail(scope,sourceId,song);
    this.db?.saveMusicSource(scope,sourceId,complete);
    return complete;
  }
}
