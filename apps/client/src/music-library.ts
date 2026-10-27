export function parsePlaylistLink(input:string):{id:string;creatorId?:string} {
  const value=input.trim();
  if(/^\d{1,20}$/.test(value))return {id:value};
  let url:URL;try{url=new URL(value);}catch{throw new Error('请输入有效的网易云歌单链接或歌单 ID');}
  if(!['https:','http:'].includes(url.protocol)||url.hostname!=='music.163.com'||url.username||url.password||url.port)throw new Error('仅支持 music.163.com 的歌单链接');
  // Desktop share URLs use /#/playlist?id=..., mobile uses /m/playlist?id=... .
  const path=url.hash.startsWith('#/')?new URL(url.hash.slice(1),url.origin):url;
  const id=path.searchParams.get('id'),creatorId=path.searchParams.get('creatorId')??url.searchParams.get('creatorId');
  if(!/^\/(?:m\/)?playlist\/?$/.test(path.pathname)||!id||!/^\d{1,20}$/.test(id))throw new Error('链接中缺少有效的歌单 ID');
  return {id,...(creatorId&&/^\d{1,20}$/.test(creatorId)?{creatorId}:{})};
}

export type LyricWord={start:number;duration:number;text:string};
export type LyricLine={start:number;end:number;text:string;words:LyricWord[]};
export function parseLyrics(data:{yrc?:{lyric?:string};lrc?:{lyric?:string}}):LyricLine[] {
  const words:LyricLine[]=[];
  for(const raw of (data.yrc?.lyric??'').split(/\r?\n/)){
    const head=/^\[(\d+),(\d+)\]/.exec(raw);if(!head)continue;
    const start=Number(head[1]),duration=Number(head[2]);
    const parts=[...raw.slice(head[0].length).matchAll(/\((\d+),(\d+),\d+\)([\s\S]*?)(?=\(\d+,\d+,\d+\)|$)/g)].map(m=>({start:Number(m[1]),duration:Number(m[2]),text:m[3]}));
    if(parts.length)words.push({start,end:start+duration,text:parts.map(w=>w.text).join(''),words:parts});
  }
  if(words.length)return words.sort((a,b)=>a.start-b.start);
  const text=data.lrc?.lyric??'',offset=Number(/\[offset:([+-]?\d+)\]/i.exec(text)?.[1]??0),lines:LyricLine[]=[];
  for(const raw of text.split(/\r?\n/)){
    const tags=[...raw.matchAll(/\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if(!tags.length)continue;
    const content=raw.replace(/\[[^\]]*\]/g,'').trim();
    for(const t of tags)lines.push({start:Math.max(0,(Number(t[1])*60+Number(t[2]))*1000+Number((t[3]??'').padEnd(3,'0'))+offset),end:Infinity,text:content,words:[]});
  }
  lines.sort((a,b)=>a.start-b.start);lines.forEach((line,i)=>line.end=lines[i+1]?.start??Infinity);return lines;
}
export function activeLyric(lines:LyricLine[],time:number):number {
  let low=0,high=lines.length;
  while(low<high){const mid=(low+high)>>>1;if(lines[mid].start<=time)low=mid+1;else high=mid;}return low-1;
}
