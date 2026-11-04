import { z } from 'zod';
import { normalizeAlbumCover,type MusicCollection } from '../../../packages/shared/src';
import type { DatabaseStore } from './database';
import type { NeteaseService } from './netease';
import { DomainError } from './engine';
const savedSchema=z.array(z.object({kind:z.enum(['playlist','album']),id:z.string().regex(/^\d{1,20}$/),name:z.string().min(1).max(200),coverUrl:z.string().max(2048),trackCount:z.number().int().nonnegative(),creatorId:z.string().max(20),description:z.string().max(2000).optional()}).strict()).max(200);
/** Favorites belong to the authenticated TONE user, not the shared upstream account. */
export class MusicFavorites {
 private writes=new Map<string,Promise<unknown>>();
 constructor(private db:Pick<DatabaseStore,'getSetting'|'setSetting'>,private netease:Pick<NeteaseService,'call'>){}
 async list(userId:string):Promise<MusicCollection[]>{
  const value=await this.db.getSetting('music.favorites.'+userId);if(!value)return [];
  try{return savedSchema.parse(JSON.parse(value));}catch{throw new DomainError('MUSIC_FAVORITES_INVALID');}
 }
 set(userId:string,kind:'playlist'|'album',id:string,saved:boolean):Promise<MusicCollection[]>{
  const work=(this.writes.get(userId)??Promise.resolve()).catch(()=>{}).then(async()=>{
   let list=await this.list(userId);const existing=list.some(item=>item.kind===kind&&item.id===id);
   if(saved&&!existing){
    if(list.length>=200)throw new DomainError('MUSIC_FAVORITES_FULL');
    const data=await this.netease.call(kind==='playlist'?'playlist_detail':'album',{id});
    const item=kind==='playlist'?data.playlist:data.album;
    if(data.code!==200||!item||String(item.id)!==id||typeof item.name!=='string'||!item.name.trim())throw new DomainError('NETEASE_INVALID_RESPONSE');
    const count=Number(kind==='playlist'?item.trackCount:item.size??data.songs?.length??0);
    list=[{kind,id,name:item.name.trim().slice(0,200),coverUrl:normalizeAlbumCover(item.coverImgUrl??item.picUrl)??'',trackCount:Number.isSafeInteger(count)&&count>=0?count:0,creatorId:String(item.creator?.userId??''),description:String(item.description??'').slice(0,2000)},...list];
   }else if(!saved)list=list.filter(item=>item.kind!==kind||item.id!==id);
   await this.db.setSetting('music.favorites.'+userId,JSON.stringify(savedSchema.parse(list)));return list;
  });
  this.writes.set(userId,work);void work.finally(()=>{if(this.writes.get(userId)===work)this.writes.delete(userId);}).catch(()=>{});return work;
 }
}
