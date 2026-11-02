import { normalizeAlbumCover } from '../../../packages/shared/src';
import { DomainError } from './engine';
export function coverImageUrl(value:string){
 const normalized=normalizeAlbumCover(value);
 if(!normalized||!value.startsWith('https://')||new URL(value).hash)throw new DomainError('COVER_IMAGE_INVALID');
 const url=new URL(normalized);
 // Preserve the stage's existing HD NetEase label artwork, without rewriting QQ paths.
 if(['.music.126.net','.music.163.com'].some(suffix=>url.hostname.endsWith(suffix)))url.searchParams.set('param','1024y1024');
 return url.href;
}
export async function downloadCoverImage(value:string,request:typeof fetch=fetch){
 try{
 const signal=AbortSignal.timeout(15000);let url=coverImageUrl(value);
 for(let redirects=0;redirects<5;redirects++){
  const response=await request(url,{redirect:'manual',signal});
  if(response.status>=300&&response.status<400){const location=response.headers.get('location');await response.body?.cancel();if(!location)break;url=coverImageUrl(new URL(location,url).href);continue;}
  const type=response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()??'';
  if(!response.ok||!['image/jpeg','image/png','image/webp','image/gif'].includes(type)||!response.body){await response.body?.cancel();throw new DomainError('COVER_IMAGE_UNAVAILABLE');}
  const max=10*1024*1024;
  if(Number(response.headers.get('content-length'))>max){await response.body.cancel();throw new DomainError('COVER_IMAGE_TOO_LARGE');}
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw new DomainError('COVER_IMAGE_TOO_LARGE');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  if(!size)throw new DomainError('COVER_IMAGE_UNAVAILABLE');
  return {bytes:Buffer.concat(chunks),type};
 }
 throw new DomainError('COVER_IMAGE_UNAVAILABLE');
 }catch(e){if(e instanceof DomainError)throw e;throw new DomainError('COVER_IMAGE_UNAVAILABLE');}
}
