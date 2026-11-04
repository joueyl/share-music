import { playlistReference } from './playlist-link';
export type MusicReference={kind:'user'|'playlist'|'album';id:string};
export type MusicCollection={kind:'playlist'|'album';id:string;name:string;coverUrl:string;trackCount:number;creatorId:string;description?:string};
/** The resource path decides its type; creatorId/userid never changes that type. */
export function parseMusicReference(input:string):MusicReference {
 const value=playlistReference(input).replace(/(?:是个人主页|是歌单|是专辑)$/u,'');
 if(/^\d{1,20}$/.test(value))return {kind:'playlist',id:value};
 let url:URL;try{url=new URL(value);}catch{throw new Error('MUSIC_LINK_INVALID');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port||!['music.163.com','y.music.163.com'].includes(url.hostname))throw new Error('MUSIC_LINK_INVALID');
 const resource=url.hash.startsWith('#/')?new URL(url.hash.slice(1),url.origin):url;
 if(resource.origin!==url.origin)throw new Error('MUSIC_LINK_INVALID');
 const path=/^\/(?:m\/)?(user(?:\/home)?|playlist|album)(?:\/(\d{1,20}))?\/?$/.exec(resource.pathname);
 if(!path||resource.searchParams.getAll('id').length>1)throw new Error('MUSIC_LINK_INVALID');
 const queryId=resource.searchParams.get('id'),id=path[2]??queryId;
 if(!id||!/^\d{1,20}$/.test(id)||(path[2]&&queryId&&path[2]!==queryId))throw new Error('MUSIC_LINK_INVALID');
 return {kind:path[1].startsWith('user')?'user':path[1] as 'playlist'|'album',id};
}
