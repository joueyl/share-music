import { isPlaylistShortLink, parsePlaylistLink, playlistReference } from '../../../packages/shared/src';
import { DomainError } from './engine';

/** Resolve only provider-owned short links. Never forward login tokens/cookies. */
export async function resolvePlaylistShareLink(input:string,request:typeof fetch=fetch):Promise<{id:string}> {
  try{return {id:parsePlaylistLink(input).id};}catch(error){if(error instanceof Error&&error.message==='PLAYLIST_LINK_IS_ALBUM')throw new DomainError('PLAYLIST_LINK_IS_ALBUM');}
  if(!isPlaylistShortLink(input))throw new DomainError('PLAYLIST_LINK_INVALID');
  let url=new URL(playlistReference(input));url.protocol='https:';
  const signal=AbortSignal.timeout(10000),seen=new Set<string>();
  try{
    for(let hop=0;hop<5;hop++){
      try{return {id:parsePlaylistLink(url.href).id};}catch{}
      if(!isPlaylistShortLink(url.href))throw new DomainError('PLAYLIST_LINK_INVALID');
      if(seen.has(url.href))throw new DomainError('PLAYLIST_LINK_REDIRECT_LIMIT');seen.add(url.href);
      const response=await request(url,{redirect:'manual',signal,headers:{Accept:'text/html'}});
      const location=response.headers.get('location');await response.body?.cancel();
      if(![301,302,303,307,308].includes(response.status)||!location)throw new DomainError('PLAYLIST_LINK_RESOLVE_FAILED');
      try{url=new URL(location,url);}catch{throw new DomainError('PLAYLIST_LINK_INVALID');}
      // Validate immediately, including the final redirect; no wildcard hosts or ports.
      if(!isPlaylistShortLink(url.href)){
        try{return {id:parsePlaylistLink(url.href).id};}catch(error){throw new DomainError(error instanceof Error&&error.message==='PLAYLIST_LINK_IS_ALBUM'?'PLAYLIST_LINK_IS_ALBUM':'PLAYLIST_LINK_INVALID');}
      }
      url.protocol='https:';
    }
    throw new DomainError('PLAYLIST_LINK_REDIRECT_LIMIT');
  }catch(error){if(error instanceof DomainError)throw error;throw new DomainError('PLAYLIST_LINK_RESOLVE_FAILED');}
}
