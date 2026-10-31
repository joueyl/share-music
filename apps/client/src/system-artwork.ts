import { normalizeAlbumCover } from '@music-share/shared';

export type ArtworkRequest = {roomId:string;trackId:string;sourceEpoch:number;source:string|null};
export type ArtworkPixels = {width:number;height:number;rgba:number[]};
export type ArtworkFrame = Omit<ArtworkRequest,'source'> & ArtworkPixels;

/** One artwork update per identity/source; late decodes must never replace a newer song. */
export function createSystemArtworkSync(load:(source:string|null)=>Promise<ArtworkPixels>,publish:(frame:ArtworkFrame)=>Promise<unknown>) {
  let generation=0,key='';
  let cachedSource:string|null|undefined,cachedPixels:ArtworkPixels|undefined;
  return async (request:ArtworkRequest|null) => {
    const next=JSON.stringify(request);if(next===key)return;key=next;
    const current=++generation;if(!request)return;
    try {
      const pixels=cachedPixels&&cachedSource===request.source?cachedPixels:await load(request.source);
      if(current!==generation)return;
      cachedSource=request.source;cachedPixels=pixels;
      const {source:_,...identity}=request;
      await publish({...identity,...pixels});
    } catch { if(current===generation)key=''; /* Optional integration must not affect playback. */ }
  };
}

/** Rasterize the same embedded/network artwork used by AlbumArt; no audio data is involved. */
export async function systemArtworkPixels(source:string|null,remote:(url:string)=>Promise<ArrayBuffer|number[]>):Promise<ArtworkPixels> {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
  const context=canvas.getContext('2d');if(!context)throw new Error('SYSTEM_ARTWORK_UNAVAILABLE');
  context.fillStyle='#eef2f7';context.fillRect(0,0,256,256);
  let bitmap:ImageBitmap|undefined;
  try {
    if(source) {
      let data:ArrayBuffer|number[];
      if(source.startsWith('blob:')) {
        const response=await fetch(source,{signal:AbortSignal.timeout(10000)});
        if(!response.ok)throw new Error('SYSTEM_ARTWORK_UNAVAILABLE');
        const blob=await response.blob();if(blob.size>10*1024*1024)throw new Error('SYSTEM_ARTWORK_TOO_LARGE');
        data=await blob.arrayBuffer();
      } else {
        const url=normalizeAlbumCover(source);if(!url)throw new Error('SYSTEM_ARTWORK_URL_INVALID');
        data=await remote(url);
      }
      const bytes=new Uint8Array(data);if(!bytes.length||bytes.length>10*1024*1024)throw new Error('SYSTEM_ARTWORK_TOO_LARGE');
      bitmap=await createImageBitmap(new Blob([bytes]));
      if(!bitmap.width||!bitmap.height||bitmap.width>8192||bitmap.height>8192)throw new Error('SYSTEM_ARTWORK_TOO_LARGE');
      const scale=Math.min(256/bitmap.width,256/bitmap.height),width=bitmap.width*scale,height=bitmap.height*scale;
      context.drawImage(bitmap,(256-width)/2,(256-height)/2,width,height);
    } else throw new Error('NO_ARTWORK');
  } catch {
    // Same light record motif as the normal album placeholder, never a previous song's cover.
    context.fillStyle='#d6e2f3';context.beginPath();context.arc(128,128,94,0,Math.PI*2);context.fill();
    context.strokeStyle='#b4c7e3';context.lineWidth=2;
    for(const radius of [80,66,52]){context.beginPath();context.arc(128,128,radius,0,Math.PI*2);context.stroke();}
    context.fillStyle='#4f80db';context.beginPath();context.arc(128,128,30,0,Math.PI*2);context.fill();
    context.fillStyle='#eef2f7';context.beginPath();context.arc(128,128,7,0,Math.PI*2);context.fill();
  } finally {bitmap?.close();}
  return {width:256,height:256,rgba:Array.from(context.getImageData(0,0,256,256).data)};
}
