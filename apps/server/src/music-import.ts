import { randomUUID } from 'node:crypto';
import { DomainError, RoomEngine } from './engine';
import type { TrackMetadata } from '../../../packages/shared/src';
import { musicAudioHost, normalizeAlbumCover, trackSchema } from '../../../packages/shared/src';
import { NeteaseService } from './netease';
import type { DatabaseStore } from './database';
import { qqMid, type QqMusicService } from './qq';
import { downloadCoverImage } from './cover-image';
const MAX = 100 * 1024 * 1024;
export function musicDownloadUrl(input: string): URL {
  if(typeof input!=='string'||input.length>8192)throw new DomainError('MUSIC_SOURCE_INVALID');
  let url: URL; try { url = new URL(input); } catch { throw new DomainError('MUSIC_SOURCE_INVALID'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || url.hash || !musicAudioHost(url.hostname)) throw new DomainError('MUSIC_SOURCE_INVALID');
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
export type MusicBatchItem={songId:string;requestId:string};
export type MusicBatchResult=MusicBatchItem&({ok:true;track:TrackMetadata}|{ok:false;error:string});
type Job={songId:string;roomId:string;promise:Promise<TrackMetadata>;at:number};
export function songCover(song:any):string|null {
  return normalizeAlbumCover(song?.al?.picUrl??song?.album?.picUrl);
}
export class MusicImport {
  private jobs=new Map<string,Job>();private active=0;private batchActive=0;
  private sources=new Map<string,Promise<TrackMetadata>>();
  private reads=new Map<string,Promise<Buffer>>();
  private coverReads=new Map<string,ReturnType<typeof downloadCoverImage>>();
  private registeredSources=new Set<string>();
  constructor(private engine:RoomEngine,private netease:Pick<NeteaseService,'call'>&Partial<Pick<NeteaseService,'songBatch'>>,private request:typeof fetch=fetch,private db?:DatabaseStore,private now=Date.now,private qq?:Pick<QqMusicService,'audio'>) {}
  private remember(url:string,hash:string){this.registeredSources.add(hash+':'+url);if(this.registeredSources.size>10000)this.registeredSources.delete(this.registeredSources.values().next().value!);}
  registered(url:string,hash:string){return this.registeredSources.has(hash+':'+url);}
  async authorize(track:TrackMetadata) {
    if(!track.sourceUrl)return;
    const saved=track.qqId?await this.db?.getMusicSource('qq',`qq:128:${track.qqId}`):track.neteaseId?await this.db?.getMusicSource('netease',`netease:standard:${track.neteaseId}`):undefined;
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
    const qqId=track.qqId??/^qq:128:([A-Za-z0-9]{1,80})$/.exec(saved?.source??'')?.[1];
    return {...track,...(neteaseId?{neteaseId}:{}),...(qqId?{qqId}:{}),...(saved?{artists:track.artists||saved.track.artists,album:track.album||saved.track.album,coverUrl:track.coverUrl||saved.track.coverUrl}:{})};
  }
  async cover(roomId:string,userId:string,trackId:string):Promise<string|null> {
    const track=await this.metadata(roomId,userId,trackId),current=normalizeAlbumCover(track.coverUrl);if(current)return current;
    if(!track.neteaseId)return null;
    const detail=await this.netease.call('song_detail',{ids:track.neteaseId});this.memberTrack(roomId,userId,trackId);
    return songCover(detail.songs?.find((s:any)=>String(s.id)===track.neteaseId));
  }
  async coverImage(roomId:string,userId:string,trackId:string){
    const url=await this.cover(roomId,userId,trackId);if(!url)throw new DomainError('COVER_IMAGE_UNAVAILABLE');
    let job=this.coverReads.get(url);
    if(!job){if(this.coverReads.size>=2)throw new DomainError('COVER_IMAGE_UNAVAILABLE');job=downloadCoverImage(url,this.request).finally(()=>this.coverReads.delete(url));this.coverReads.set(url,job);}
    const image=await job;this.memberTrack(roomId,userId,trackId);return image;
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
  private batchItems(roomId:string,userId:string,items:MusicBatchItem[],source:'netease'|'qq') {
    if(!Array.isArray(items)||!items.length||items.length>50||items.some(item=>!(source==='qq'?qqMid:/^\d{1,20}$/).test(item.songId)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(item.requestId))||new Set(items.map(item=>item.songId)).size!==items.length||new Set(items.map(item=>item.requestId)).size!==items.length)throw new DomainError('INVALID_REQUEST');
    const fresh=items.filter(item=>{
      const prior=this.jobs.get(userId+':'+item.requestId);
      if(prior&&(prior.songId!==(source==='qq'?'qq:':'')+item.songId||prior.roomId!==roomId))throw new DomainError('COMMAND_ID_REUSED');
      return !prior;
    });
    if(fresh.length){const room=this.room(roomId,userId);if(fresh.length>200-room.playlist.length)throw new DomainError('PLAYLIST_FULL');}
    return fresh;
  }
  async addQqBatch(roomId:string,userId:string,items:MusicBatchItem[]):Promise<MusicBatchResult[]> {
    this.batchItems(roomId,userId,items,'qq');
    if(this.batchActive>=2)throw new DomainError('MUSIC_IMPORT_BUSY');this.batchActive++;
    try {
      const results:MusicBatchResult[]=[];
      // QQ has no Hana batch endpoint: retain bounded existing provider calls server-side.
      for(const item of items)try{results.push({...item,ok:true,track:await this.addQq(roomId,userId,item.songId,item.requestId)});}
      catch(error){results.push({...item,ok:false,error:error instanceof DomainError?error.code:'MUSIC_IMPORT_FAILED'});}
      return results;
    }finally{this.batchActive--;}
  }
  async addBatch(roomId:string,userId:string,items:MusicBatchItem[]):Promise<MusicBatchResult[]> {
    const fresh=this.batchItems(roomId,userId,items,'netease');
    if(this.batchActive>=2)throw new DomainError('MUSIC_IMPORT_BUSY');this.batchActive++;
    try {
      const missing=new Set<string>(),cachedAssets=new Map<string,TrackMetadata>();
      for(const item of fresh){
        const cached=await this.db?.getMusicSource('netease',`netease:standard:${item.songId}`);
        if(!cached?.sourceUrl||(cached.sourceExpiresAt??0)<=this.now()+30000)missing.add(item.songId);
        else cachedAssets.set(item.songId,cached);
      }
      let prepared:{detail:any;source:any;fetchedAt?:number}|undefined,batchError:unknown;
      if(missing.size)try{
        this.room(roomId,userId);
        if(!this.netease.songBatch)throw new DomainError('NETEASE_UNAVAILABLE');
        const fetchedAt=this.now();prepared={...await this.netease.songBatch([...missing]),fetchedAt};
      }catch(error){batchError=error;}
      const results:MusicBatchResult[]=[];
      for(const item of items){
        try {
          const track=await this.enqueueJob(roomId,userId,item.songId,item.requestId,async()=>{
            this.room(roomId,userId);
            if(missing.has(item.songId)&&batchError)throw batchError;
            const cached=cachedAssets.get(item.songId),asset=cached?trackSchema.parse(cached):await this.asset(item.songId,false,prepared);
            musicDownloadUrl(asset.sourceUrl!);this.remember(asset.sourceUrl!,asset.contentHash);
            return this.enqueue(roomId,userId,asset,item.requestId);
          });
          results.push({...item,ok:true,track});
        }catch(error){results.push({...item,ok:false,error:error instanceof DomainError?error.code:'MUSIC_IMPORT_FAILED'});}
      }
      return results;
    }finally{this.batchActive--;}
  }
  addQq(roomId:string,userId:string,mid:string,requestId:string):Promise<TrackMetadata>{
    return this.enqueueJob(roomId,userId,'qq:'+mid,requestId,async()=>this.enqueue(roomId,userId,await this.importQqSong(mid),requestId));
  }
  addUploaded(roomId:string,userId:string,hash:string,requestId:string):Promise<TrackMetadata> {
    return this.enqueueJob(roomId,userId,`library:${hash}`,requestId,async()=>{
      const saved=await this.db?.findMusicByHash(hash),songId=/^netease:standard:(\d{1,20})$/.exec(saved?.source??'')?.[1];
      const qqId=/^qq:128:([A-Za-z0-9]{1,80})$/.exec(saved?.source??'')?.[1];
      if(qqId)return this.enqueue(roomId,userId,await this.importQqSong(qqId),requestId);
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
  private async asset(songId:string,force:boolean,prepared?:{detail:any;source:any;fetchedAt?:number}):Promise<TrackMetadata> {
    const sourceId=`netease:standard:${songId}`,cached=await this.db?.getMusicSource('netease',sourceId);
    if(!force&&cached?.sourceUrl&&(cached.sourceExpiresAt??0)>this.now()+30000) {
      const track=trackSchema.parse(cached);musicDownloadUrl(track.sourceUrl!);this.remember(track.sourceUrl!,track.contentHash);return track;
    }
    const fetchedAt=prepared?.fetchedAt??this.now();
    const [detail,source]=prepared?[prepared.detail,prepared.source]:await Promise.all([this.netease.call('song_detail',{ids:songId}),this.netease.call('song_url_v1',{id:songId,level:'standard'})]);
    const song=detail.songs?.find((s:any)=>String(s.id)===songId),audio=source.data?.find((s:any)=>String(s.id)===songId);
    if(!song||!audio?.url||(audio.code&&audio.code!==200))throw new DomainError('MUSIC_NOT_AVAILABLE');
    if(audio.freeTrialInfo)throw new DomainError('MUSIC_TRIAL_ONLY');
    if(audio.type&&audio.type.toLowerCase()!=='mp3')throw new DomainError('MUSIC_AUDIO_UNSUPPORTED');
    const sourceUrl=musicDownloadUrl(audio.url).href;
    // contentHash is a persistent cache/library key, not a downloaded-byte checksum.
    const contentHash=cached?.contentHash??(typeof audio.md5==='string'&&/^[a-f0-9]{32}$/i.test(audio.md5)?audio.md5.toLowerCase():randomUUID().replaceAll('-','')),sizeBytes=audio.size,durationMs=Math.round(Number(song.dt??song.duration));
    if(!Number.isSafeInteger(sizeBytes)||sizeBytes<1)throw new DomainError('MUSIC_SOURCE_INVALID');
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
  importQqSong(mid:string,force=false):Promise<TrackMetadata>{
    if(!qqMid.test(mid))return Promise.reject(new DomainError('INVALID_REQUEST'));
    const key='qq:'+mid+(force?':refresh':':cached'),prior=this.sources.get(key);if(prior)return prior;
    if(this.sources.size>=2)return Promise.reject(new DomainError('MUSIC_IMPORT_BUSY'));
    const job=this.qqAsset(mid,force).finally(()=>this.sources.delete(key));this.sources.set(key,job);return job;
  }
  private async qqAsset(mid:string,force:boolean):Promise<TrackMetadata>{
    if(!this.qq)throw new DomainError('QQ_MUSIC_NOT_CONFIGURED');
    const sourceId=`qq:128:${mid}`,cached=await this.db?.getMusicSource('qq',sourceId);
    if(!force&&cached?.sourceUrl&&(cached.sourceExpiresAt??0)>this.now()+30000){
      const track=trackSchema.parse(cached);musicDownloadUrl(track.sourceUrl!);this.remember(track.sourceUrl!,track.contentHash);return track;
    }
    const {song,url,detail}=await this.qq.audio(mid),sourceUrl=musicDownloadUrl(url).href;
    // Import/refresh only reads provider metadata; never download a song to hash it.
    const sizeBytes=detail?.file?.size_128mp3;
    if(!Number.isSafeInteger(sizeBytes)||sizeBytes<1)throw new DomainError('MUSIC_SOURCE_INVALID');
    if(sizeBytes>MAX)throw new DomainError('MUSIC_TOO_LARGE');
    const track=trackSchema.parse({id:cached?.id??randomUUID(),name:song.name.slice(0,200),artists:song.artists.slice(0,1000),album:song.album.slice(0,500),coverUrl:normalizeAlbumCover(song.coverUrl),
      durationMs:song.durationMs,sizeBytes,lossless:false,bitrateBps:Math.max(1,Math.min(20000000,Math.round(sizeBytes*8000/song.durationMs))),
      contentHash:cached?.contentHash??randomUUID().replaceAll('-',''),sourceUrl,sourceExpiresAt:this.now()+300000,qqId:mid});
    await this.db?.saveMusicDetail('qq',sourceId,detail);await this.db?.saveMusicSource('qq',sourceId,track);
    this.remember(sourceUrl,track.contentHash);return track;
  }
  private async resolve(track:TrackMetadata,force=false):Promise<TrackMetadata> {
    const saved=track.neteaseId||track.qqId?undefined:await this.db?.findMusicByHash(track.contentHash);
    const qqId=track.qqId??/^qq:128:([A-Za-z0-9]{1,80})$/.exec(saved?.source??'')?.[1];
    if(qqId)return this.importQqSong(qqId,force);
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
    // The proxy bounds traffic and rechecks membership; no audio digest is computed.
    return bytes;
  }
}
