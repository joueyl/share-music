import { z } from 'zod';
import { favoriteSongSchema,favoriteSongRequestSchema,normalizeAlbumCover,type FavoriteSong } from '../../../packages/shared/src';
import type { DatabaseStore } from './database';
import type { NeteaseService } from './netease';
import type { QqMusicService } from './qq';
import { DomainError } from './engine';
/** Only metadata is stored. Favorites do not grant playback rights or hold signed audio URLs. */
export class FavoriteSongs {
 private writes=new Map<string,Promise<unknown>>();
 constructor(private db:Pick<DatabaseStore,'listFavoriteSongs'|'saveFavoriteSong'|'removeFavoriteSong'>,private netease:Pick<NeteaseService,'call'>,private qq:Pick<QqMusicService,'songDetail'>,private now=Date.now){}
 async list(userId:string):Promise<FavoriteSong[]>{
  const parsed=z.array(favoriteSongSchema).max(5000).safeParse(await this.db.listFavoriteSongs(userId));
  if(!parsed.success)throw new DomainError('FAVORITE_SONGS_INVALID');return parsed.data;
 }
 set(userId:string,source:FavoriteSong['source'],id:string,saved:boolean):Promise<FavoriteSong[]>{
  favoriteSongRequestSchema.parse({source,id,saved});
  const work=(this.writes.get(userId)??Promise.resolve()).catch(()=>{}).then(async()=>{
   const list=await this.list(userId);
   if(!saved)await this.db.removeFavoriteSong(userId,source,id);
   else if(!list.some(song=>song.source===source&&song.id===id)){
    if(list.length>=5000)throw new DomainError('FAVORITE_SONGS_FULL');
    let metadata;
    if(source==='qq')metadata=await this.qq.songDetail(id);
    else{
     const data=await this.netease.call('song_detail',{ids:id});
     const song=Array.isArray(data.songs)?data.songs.find((s:any)=>String(s?.id)===id):null;
     if(data.code!==200||!song||!Array.isArray(song.ar??song.artists??[])||typeof song.name!=='string'||!song.name.trim()||!Number.isSafeInteger(song.dt)||song.dt<0)throw new DomainError('NETEASE_INVALID_RESPONSE');
     metadata={name:song.name,artists:(song.ar??song.artists??[]).map((a:any)=>String(a?.name??'')).join(' / '),album:String(song.al?.name??song.album?.name??''),coverUrl:normalizeAlbumCover(song.al?.picUrl??song.album?.picUrl)??'',durationMs:song.dt};
    }
    const song=favoriteSongSchema.safeParse({source,id,name:metadata.name?.slice(0,200),artists:metadata.artists?.slice(0,1000),album:metadata.album?.slice(0,500),coverUrl:normalizeAlbumCover(metadata.coverUrl)??'',durationMs:metadata.durationMs,savedAt:this.now()});
    if(!song.success)throw new DomainError('FAVORITE_SONGS_INVALID');
    await this.db.saveFavoriteSong(userId,song.data);
   }
   return this.list(userId);
  });
  this.writes.set(userId,work);void work.finally(()=>{if(this.writes.get(userId)===work)this.writes.delete(userId);}).catch(()=>{});return work;
 }
}
