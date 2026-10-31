import { randomUUID } from 'node:crypto';
import { DomainError, RoomEngine } from './engine';
import type { TrackMetadata } from '../../../packages/shared/src';
import { normalizeAlbumCover, trackSchema } from '../../../packages/shared/src';
import { NeteaseService } from './netease';
import type { DatabaseStore } from './database';
const MAX = 100 * 1024 * 1024;
export function musicDownloadUrl(input: string): URL {
  if(typeof input!=='string'||input.length>8192)throw new DomainError('MUSIC_SOURCE_INVALID');
  let url: URL; try { url = new URL(input); } catch { throw new DomainError('MUSIC_SOURCE_INVALID'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || url.hash || !/^[a-z0-9-]+\.music\.126\.net$/i.test(url.hostname)) throw new DomainError('MUSIC_SOURCE_INVALID');
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
      if([401,403,404,410].includes(res.status)){await res.body?.cancel();throw new DomainError('MUSIC_LINK_EXPIRED');}
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
  private jobs=new Map<string,Job>();private active=0;
  private sources=new Map<string,Promise<TrackMetadata>>();
  private reads=new Map<string,Promise<Buffer>>();
  private registeredSources=new Set<string>();
  constructor(private engine:RoomEngine,private netease:Pick<NeteaseService,'call'>,private request:typeof fetch=fetch,private db?:DatabaseStore,private now=Date.now) {}
  private remember(url:string,hash:string){this.registeredSources.add(hash+':'+url);if(this.registeredSources.size>10000)this.registeredSources.delete(this.registeredSources.values().next().value!);}
  registered(url:string,hash:string){return this.registeredSources.has(hash+':'+url);}
  async authorize(track:TrackMetadata) {
    if(!track.sourceUrl)return;
    const saved=track.neteaseId?await this.db?.getMusicSource('netease',`netease:standard:${track.neteaseId}`):undefined;
    if(saved?.sourceUrl===track.sourceUrl&&saved.contentHash===track.contentHash&&saved.sizeBytes===track.sizeBytes)this.remember(track.sourceUrl!,track.contentHash);
  }
  private memberTrack(roomId:string,userId:string,trackId:string) {
    const room=this.engine.snapshot(roomId);
    if(!room.members.some(m=>m.id===userId&&m.online))throw new DomainError('NOT_IN_ROOM');
    const track=room.playlist.find(t=>t.id===trackId);if(!track)throw new DomainError('TRACK_NOT_FOUND');return track;
  }
  async metadata(roomId:string,userId:string,trackId:string):Promise<TrackMetadata> {
    const track=this.memberTrack(roomId,userId,trackId),saved=await this.db?.findMusicByHash(track.contentHash);
    this.memberTrack(roomId,userId,trackId);
    const neteaseId=track.neteaseId??/^netease:standard:(\d{1,20})$/.exec(saved?.source??'')?.[1];
    return {...track,...(neteaseId?{neteaseId}:{}),...(saved?{artists:track.artists||saved.track.artists,album:track.album||saved.track.album,coverUrl:track.coverUrl||saved.track.coverUrl}:{})};
  }
  async cover(roomId:string,userId:string,trackId:string):Promise<string|null> {
    const track=await this.metadata(roomId,userId,trackId),current=normalizeAlbumCover(track.coverUrl);if(current)return current;
    if(!track.neteaseId)return null;
    const detail=await this.netease.call('song_detail',{ids:track.neteaseId});this.memberTrack(roomId,userId,trackId);
    return songCover(detail.songs?.find((s:any)=>String(s.id)===track.neteaseId));
  }
  private room(roomId:string,userId:string) {
    const room=this.engine.snapshot(roomId),member=room.members.find(m=>m.id===userId&&m.online);
    if(!member)throw new DomainError('NOT_IN_ROOM');
    if(!member.permissions.enqueue)throw new DomainError('FORBIDDEN');
    if(room.playlist.length>=200)throw new DomainError('PLAYLIST_FULL');return room;
  }
  add(roomId:string,userId:string,songId:string,requestId:string):Promise<TrackMetadata> {
    return this.enqueueJob(roomId,userId,songId,requestId,async()=>this.enqueue(roomId,userId,await this.importSong(songId),requestId));
  }
  addUploaded(roomId:string,userId:string,hash:string,requestId:string):Promise<TrackMetadata> {
    return this.enqueueJob(roomId,userId,`library:${hash}`,requestId,async()=>{
      const saved=await this.db?.findMusicByHash(hash),songId=/^netease:standard:(\d{1,20})$/.exec(saved?.source??'')?.[1];
      if(!songId)throw new DomainError('TRACK_NOT_FOUND');
      return this.enqueue(roomId,userId,await this.importSong(songId),requestId);
    });
  }
  private enqueue(roomId:string,userId:string,asset:TrackMetadata,requestId:string) {
    const room=this.room(roomId,userId),track={...asset,id:randomUUID()};
    this.engine.command(userId,{roomId,commandId:requestId,expectedStateVersion:room.stateVersion,action:{type:'enqueue',payload:track}});return track;
  }
  private enqueueJob(roomId:string,userId:string,songId:string,requestId:string,run:()=>Promise<TrackMetadata>):Promise<TrackMetadata> {
    const key=userId+':'+requestId,prior=this.jobs.get(key);
    if(prior){if(prior.songId!==songId||prior.roomId!==roomId)throw new DomainError('COMMAND_ID_REUSED');return prior.promise;}
    this.room(roomId,userId);if(this.active>=2)throw new DomainError('MUSIC_IMPORT_BUSY');
    for(const [k,j]of this.jobs)if(this.now()-j.at>3600000)this.jobs.delete(k);
    if(this.jobs.size>=1000)throw new DomainError('MUSIC_IMPORT_BUSY');this.active++;
    const promise=run().finally(()=>this.active--);this.jobs.set(key,{songId,roomId,promise,at:this.now()});
    void promise.catch(()=>this.jobs.delete(key));return promise;
  }
  importSong(songId:string,force=false):Promise<TrackMetadata> {
    if(!/^\d{1,20}$/.test(songId))return Promise.reject(new DomainError('INVALID_REQUEST'));
    const key=songId+(force?':refresh':':cached'),prior=this.sources.get(key);if(prior)return prior;
    if(this.sources.size>=2)return Promise.reject(new DomainError('MUSIC_IMPORT_BUSY'));
    const job=this.asset(songId,force).finally(()=>this.sources.delete(key));this.sources.set(key,job);return job;
  }
  private async asset(songId:string,force:boolean):Promise<TrackMetadata> {
    const sourceId=`netease:standard:${songId}`,cached=await this.db?.getMusicSource('netease',sourceId);
    if(!force&&cached?.sourceUrl&&/^[a-f0-9]{32}$/.test(cached.contentHash)&&(cached.sourceExpiresAt??0)>this.now()+30000) {
      const track=trackSchema.parse(cached);musicDownloadUrl(track.sourceUrl!);this.remember(track.sourceUrl!,track.contentHash);return track;
    }
    const fetchedAt=this.now();
    const [detail,source]=await Promise.all([this.netease.call('song_detail',{ids:songId}),this.netease.call('song_url_v1',{id:songId,level:'standard'})]);
    const song=detail.songs?.find((s:any)=>String(s.id)===songId),audio=source.data?.find((s:any)=>String(s.id)===songId);
    if(!song||!audio?.url||(audio.code&&audio.code!==200))throw new DomainError('MUSIC_NOT_AVAILABLE');
    if(audio.freeTrialInfo)throw new DomainError('MUSIC_TRIAL_ONLY');
    if(audio.type&&audio.type.toLowerCase()!=='mp3')throw new DomainError('MUSIC_AUDIO_UNSUPPORTED');
    const sourceUrl=musicDownloadUrl(audio.url).href;
    // Trust only validated provider metadata here; the client verifies the downloaded bytes.
    const contentHash=typeof audio.md5==='string'?audio.md5.toLowerCase():'',sizeBytes=audio.size,durationMs=Math.round(Number(song.dt??song.duration));
    if(!/^[a-f0-9]{32}$/.test(contentHash)||!Number.isSafeInteger(sizeBytes)||sizeBytes<1)throw new DomainError('MUSIC_SOURCE_INVALID');
    if(sizeBytes>MAX)throw new DomainError('MUSIC_TOO_LARGE');
    if(typeof song.name!=='string'||!song.name.trim()||!Number.isFinite(durationMs)||durationMs<1||durationMs>86400000)throw new DomainError('MUSIC_SOURCE_INVALID');
    const ttl=Number(audio.expi),seconds=Number.isFinite(ttl)&&ttl>0?Math.min(ttl,86400):300;
    const complete=trackSchema.parse({id:cached?.id??randomUUID(),name:song.name.slice(0,200),durationMs,sizeBytes,lossless:false,
      bitrateBps:Math.max(1,Math.min(20000000,Math.round(Number(audio.br)||sizeBytes*8000/durationMs))),contentHash,
      sourceUrl,sourceExpiresAt:Math.floor(fetchedAt+seconds*1000),coverUrl:songCover(song),neteaseId:songId,
      artists:(song.ar??song.artists??[]).map((a:any)=>a.name).filter(Boolean).join(' / ').slice(0,1000),album:String(song.al?.name??song.album?.name??'').slice(0,500)});
    await this.db?.saveMusicDetail('netease',sourceId,song);await this.db?.saveMusicSource('netease',sourceId,complete);
    this.remember(sourceUrl,complete.contentHash);return complete;
  }
  private async resolve(track:TrackMetadata,force=false):Promise<TrackMetadata> {
    const saved=track.neteaseId?undefined:await this.db?.findMusicByHash(track.contentHash);
    const songId=track.neteaseId??/^netease:standard:(\d{1,20})$/.exec(saved?.source??'')?.[1];
    if(!songId)throw new DomainError('MUSIC_SOURCE_UNREFRESHABLE');
    const current=await this.importSong(songId,force);
    return current;
  }
  async playbackSource(roomId:string,userId:string,trackId:string,force=false) {
    const track=this.memberTrack(roomId,userId,trackId),current=await this.resolve(track,force);
    this.memberTrack(roomId,userId,trackId);
    return {url:current.sourceUrl!,contentHash:current.contentHash,sizeBytes:current.sizeBytes};
  }
  async url(roomId:string,userId:string,trackId:string,force=false):Promise<string> {
    return (await this.playbackSource(roomId,userId,trackId,force)).url;
  }
  async readAudio(roomId:string,userId:string,trackId:string):Promise<Buffer> {
    const track=await this.resolve(this.memberTrack(roomId,userId,trackId));
    this.memberTrack(roomId,userId,trackId);
    if(track.sizeBytes>MAX)throw new DomainError('PLAYBACK_AUDIO_TOO_LARGE');
    let job=this.reads.get(track.contentHash);
    if(!job){
      if(this.reads.size>=2)throw new DomainError('PLAYBACK_AUDIO_BUSY');
      job=this.readSource(track).finally(()=>this.reads.delete(track.contentHash));this.reads.set(track.contentHash,job);
    }
    const bytes=await job;this.memberTrack(roomId,userId,trackId);return bytes;
  }
  private async readSource(track:TrackMetadata):Promise<Buffer> {
    let current=track,bytes:Buffer;
    try{bytes=await downloadMusic(current.sourceUrl!,this.request);}
    catch(e){if(!(e instanceof DomainError)||e.code!=='MUSIC_LINK_EXPIRED')throw e;current=await this.resolve(track,true);bytes=await downloadMusic(current.sourceUrl!,this.request);}
    // The proxy bounds traffic and rechecks membership; checksum comparison belongs to the client.
    return bytes;
  }
}
