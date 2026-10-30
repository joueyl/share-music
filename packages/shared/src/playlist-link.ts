export function playlistReference(input:string):string {
  const value=input.trim();
  if(!value||value.length>4096)throw new Error('请输入有效的网易云歌单链接或歌单 ID');
  if(/^\d{1,20}$/.test(value))return value;
  if(/^https?:\/\/\S+$/.test(value))return value;
  const links=value.match(/https?:\/\/[^\s<>"'（）()，。！!]+/g);
  if(links?.length===1)return links[0];
  throw new Error('请输入有效的网易云歌单链接或歌单 ID');
}
function shareUrl(input:string):URL {
  let url:URL;try{url=new URL(playlistReference(input));}catch{throw new Error('请输入有效的网易云歌单链接或歌单 ID');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port)throw new Error('不支持此歌单链接');
  return url;
}
export function isPlaylistShortLink(input:string):boolean {
  try{const url=shareUrl(input);return url.hostname==='163cn.tv'&&/^\/[a-zA-Z0-9_-]{1,64}\/?$/.test(url.pathname)&&!url.hash;}catch{return false;}
}
export function parsePlaylistLink(input:string):{id:string;creatorId?:string} {
  const value=playlistReference(input);if(/^\d{1,20}$/.test(value))return {id:value};
  const url=shareUrl(value);
  if(!['music.163.com','y.music.163.com'].includes(url.hostname))throw new Error('仅支持网易云歌单链接');
  const path=url.hash.startsWith('#/')?new URL(url.hash.slice(1),url.origin):url;
  if(path.origin===url.origin&&/^\/(?:m\/)?album(?:\/\d{1,20})?\/?$/.test(path.pathname))throw new Error('PLAYLIST_LINK_IS_ALBUM');
  const id=path.searchParams.get('id'),creatorId=path.searchParams.get('creatorId')??url.searchParams.get('creatorId');
  if(path.origin!==url.origin||!/^\/(?:m\/)?playlist\/?$/.test(path.pathname)||!id||!/^\d{1,20}$/.test(id))throw new Error('链接中缺少有效的歌单 ID');
  return {id,...(creatorId&&/^\d{1,20}$/.test(creatorId)?{creatorId}:{})};
}
