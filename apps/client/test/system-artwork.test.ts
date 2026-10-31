import { afterEach,expect,it,vi } from 'vitest';
import { createSystemArtworkSync,systemArtworkPixels } from '../src/system-artwork';
const request={roomId:'room',trackId:'song',sourceEpoch:1,source:'blob:cover'};
const pixels={width:1,height:1,rgba:[1,2,3,255]};
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('publishes only changed artwork identities and drops late results after switching or leaving',async()=>{
 const pending:Array<(value:typeof pixels)=>void>=[],load=vi.fn(()=>new Promise<typeof pixels>(resolve=>pending.push(resolve))),publish=vi.fn(async()=>{});
 const sync=createSystemArtworkSync(load,publish);
 const first=sync(request),next=sync({...request,trackId:'next'});
 pending[0](pixels);await first;expect(publish).not.toHaveBeenCalled();
 pending[1](pixels);await next;
 expect(publish).toHaveBeenCalledExactlyOnceWith({roomId:'room',trackId:'next',sourceEpoch:1,...pixels});
 await sync({...request,trackId:'next'});expect(load).toHaveBeenCalledTimes(2);
 const stale=sync({...request,source:'blob:new'});await sync(null);pending[2](pixels);await stale;
 expect(publish).toHaveBeenCalledOnce();
});
it('updates late-arriving embedded artwork and permits retry after native failure',async()=>{
 const load=vi.fn(async()=>pixels),publish=vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(undefined);
 const sync=createSystemArtworkSync(load,publish);
 await sync(request);await sync(request);expect(load).toHaveBeenCalledOnce();
 await sync({...request,source:'blob:embedded'});expect(publish).toHaveBeenCalledTimes(3);
 await sync({...request,source:'blob:embedded',sourceEpoch:2});expect(publish).toHaveBeenCalledTimes(4);
});
function canvas() {
 const context={fillStyle:'',strokeStyle:'',lineWidth:0,fillRect:vi.fn(),beginPath:vi.fn(),arc:vi.fn(),fill:vi.fn(),stroke:vi.fn(),drawImage:vi.fn(),getImageData:vi.fn(()=>({data:new Uint8ClampedArray(256*256*4)}))};
 vi.stubGlobal('document',{createElement:vi.fn(()=>({width:0,height:0,getContext:()=>context}))});
 const bitmap={width:400,height:200,close:vi.fn()};vi.stubGlobal('createImageBitmap',vi.fn(async()=>bitmap));
 return {context,bitmap};
}
it('loads approved network artwork via native HTTP, preserves aspect and closes decoded images',async()=>{
 const {context,bitmap}=canvas(),remote=vi.fn(async()=>[1,2,3]);
 const result=await systemArtworkPixels('http://p1.music.126.net/cover.jpg',remote);
 expect(remote).toHaveBeenCalledExactlyOnceWith('https://p1.music.126.net/cover.jpg');
 expect(context.drawImage).toHaveBeenCalledWith(bitmap,0,64,256,128);expect(bitmap.close).toHaveBeenCalledOnce();
 expect(result).toMatchObject({width:256,height:256});expect(result.rgba).toHaveLength(256*256*4);
});
it('reuses embedded Blob bytes without remote requests, and falls back safely on invalid or missing images',async()=>{
 const {context}=canvas(),remote=vi.fn(async()=>[1]);vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array([1,2]))));
 await systemArtworkPixels('blob:embedded',remote);expect(remote).not.toHaveBeenCalled();expect(context.drawImage).toHaveBeenCalledOnce();
 context.drawImage.mockClear();
 for(const source of [null,'https://evil.example/cover','file:///private','data:image/png;base64,AA=='])await systemArtworkPixels(source,remote);
 expect(remote).not.toHaveBeenCalled();expect(context.drawImage).not.toHaveBeenCalled();expect(context.arc).toHaveBeenCalled();
 remote.mockRejectedValueOnce(new Error('offline'));await systemArtworkPixels('https://p1.music.126.net/cover.jpg',remote);
 expect(context.drawImage).not.toHaveBeenCalled();
});
