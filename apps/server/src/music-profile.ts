import { z } from 'zod';
import { normalizeAlbumCover, playlistReference } from '../../../packages/shared/src';
import type { DatabaseStore } from './database';
import type { NeteaseService } from './netease';
import { resolveMusicReference } from './playlist-link';
import { DomainError } from './engine';

const bindingSchema=z.object({source:z.literal('netease'),id:z.string().regex(/^\d{1,20}$/)}).strict();
/** A public-profile bookmark, not proof of upstream account ownership or login. */
export class MusicProfile {
 private writes=new Map<string,Promise<unknown>>();
 constructor(private db:Pick<DatabaseStore,'getSetting'|'getUserMusicProfileUrl'|'setUserMusicProfileUrl'>,private netease:Pick<NeteaseService,'call'>){}
 private async detail(id:string){
  const data=await this.netease.call('user_detail',{uid:id}),p=data.profile;
  if(data.code!==200||!p||String(p.userId)!==id||typeof p.nickname!=='string'||!p.nickname.trim())throw new DomainError('MUSIC_PROFILE_UNAVAILABLE');
  return {source:'netease' as const,id,nickname:p.nickname.trim().slice(0,200),avatarUrl:normalizeAlbumCover(p.avatarUrl)??'',signature:typeof p.signature==='string'?p.signature.slice(0,2000):''};
 }
 private serial<T>(userId:string,task:()=>Promise<T>):Promise<T>{
  const work=(this.writes.get(userId)??Promise.resolve()).catch(()=>{}).then(task);
  this.writes.set(userId,work);void work.finally(()=>{if(this.writes.get(userId)===work)this.writes.delete(userId);}).catch(()=>{});return work;
 }
 async get(userId:string){const id=await this.serial(userId,async()=>{
  const url=await this.db.getUserMusicProfileUrl(userId);
  if(url!==null){
   const match=/^https:\/\/music\.163\.com\/user\?id=(\d{1,20})$/.exec(url);
   if(!match)throw new DomainError('MUSIC_PROFILE_INVALID');
   return match[1];
  }
  // Older versions stored an already-verified reference in settings. Move it once,
  // in the same per-user queue as replacement/unlink, without depending on upstream uptime.
  const value=await this.db.getSetting('music.profile.'+userId);if(!value)return null;
  let binding:z.infer<typeof bindingSchema>;
  try{binding=bindingSchema.parse(JSON.parse(value));}catch{throw new DomainError('MUSIC_PROFILE_INVALID');}
  await this.db.setUserMusicProfileUrl(userId,'https://music.163.com/user?id='+binding.id);
  return binding.id;
 });return id===null?null:this.detail(id);}
 set(userId:string,input:string|null){
  return this.serial(userId,async()=>{
   if(input===null){await this.db.setUserMusicProfileUrl(userId,null);return null;}
   // The installed QQ API only reads its authenticated account, never a supplied public UID.
   let url:URL|undefined;try{url=new URL(playlistReference(input));}catch{}
   if(url&&['y.qq.com','i.y.qq.com','c.y.qq.com'].includes(url.hostname)&&['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.port)throw new DomainError('QQ_PUBLIC_PROFILE_UNSUPPORTED');
   const reference=await resolveMusicReference(input);
   if(reference.kind!=='user')throw new DomainError('MUSIC_PROFILE_LINK_REQUIRED');
   const profile=await this.detail(reference.id);
   await this.db.setUserMusicProfileUrl(userId,'https://music.163.com/user?id='+profile.id);
   return profile;
  });
 }
}
