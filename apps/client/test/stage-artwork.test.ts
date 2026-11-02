import { afterEach, expect, it, vi } from 'vitest';
import { createStageArtworkLoader } from '../src/stage-artwork';
afterEach(()=>vi.restoreAllMocks());
function fixture(){
 const images:any[]=[],publish=vi.fn(),load=vi.fn(async()=>new Blob(['image']));
 const create=vi.spyOn(URL,'createObjectURL').mockImplementation(()=>`blob:stage-${images.length}`),revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 const loader=createStageArtworkLoader(load,publish,()=>{const image={naturalWidth:300,naturalHeight:300};images.push(image);return image as HTMLImageElement;});
 return {images,publish,load,create,revoke,loader};
}
it('decodes origin-clean local blobs and releases owned URLs after load',async()=>{
 const f=fixture();await f.loader.set('https://y.gtimg.cn/cover.jpg');expect(f.images[0].src).toBe('blob:stage-0');f.images[0].onload();expect(f.publish).toHaveBeenLastCalledWith(f.images[0]);expect(f.revoke).toHaveBeenCalledWith('blob:stage-0');f.loader.dispose();expect(f.publish).toHaveBeenLastCalledWith(null);
});
it('ignores old song decodes, never reuses old cover on failure and preserves externally owned embedded blobs',async()=>{
 const f=fixture();await f.loader.set('https://y.gtimg.cn/old.jpg');await f.loader.set('blob:embedded');f.images[0].onload();expect(f.publish).toHaveBeenLastCalledWith(null);f.images[1].onload();expect(f.publish).toHaveBeenLastCalledWith(f.images[1]);expect(f.load).toHaveBeenCalledTimes(1);expect(f.revoke).not.toHaveBeenCalledWith('blob:embedded');
 await f.loader.set('https://y.gtimg.cn/bad.jpg');f.images[2].onerror();expect(f.publish).toHaveBeenLastCalledWith(null);f.loader.dispose();
});
it('does not create textures or URLs from downloads resolved after disposal',async()=>{
 const f=fixture();let finish!:(b:Blob)=>void;f.load.mockImplementationOnce(()=>new Promise(r=>finish=r));const pending=f.loader.set('https://y.gtimg.cn/late.jpg');f.loader.dispose();finish(new Blob(['late']));await pending;expect(f.create).not.toHaveBeenCalled();expect(f.images).toEqual([]);
});
it('does not clear, reload or decode identical artwork during repeated same-song snapshots',async()=>{
 const f=fixture();let finish!:(b:Blob)=>void;f.load.mockImplementationOnce(()=>new Promise(r=>finish=r));
 const first=f.loader.set('https://y.gtimg.cn/one.jpg','room/one');
 for(let i=0;i<20;i++)await f.loader.set('https://y.gtimg.cn/one.jpg','room/one');
 expect(f.load).toHaveBeenCalledTimes(1);expect(f.publish).toHaveBeenCalledTimes(1);
 finish(new Blob(['one']));await first;f.images[0].onload();
 for(let i=0;i<20;i++)await f.loader.set('https://y.gtimg.cn/one.jpg','room/one');
 expect(f.load).toHaveBeenCalledTimes(1);expect(f.images).toHaveLength(1);expect(f.publish.mock.calls.map(call=>call[0])).toEqual([null,f.images[0]]);
 f.loader.dispose();
});
it('atomically upgrades same-song artwork, but clears immediately on a real track or room change',async()=>{
 const f=fixture();await f.loader.set('https://y.gtimg.cn/one.jpg','room/one');f.images[0].onload();f.publish.mockClear();
 await f.loader.set('blob:embedded-one','room/one');expect(f.publish).not.toHaveBeenCalled();f.images[1].onload();expect(f.publish.mock.calls.map(call=>call[0])).toEqual([f.images[1]]);
 f.publish.mockClear();await f.loader.set('https://y.gtimg.cn/failed-upgrade.jpg','room/one');f.images[2].onerror();expect(f.publish).not.toHaveBeenCalled();
 await f.loader.set('https://y.gtimg.cn/failed-upgrade.jpg','different-room/one');expect(f.publish).toHaveBeenLastCalledWith(null);
 f.loader.dispose();f.publish.mockClear();await f.loader.set('blob:after-disposal','room/two');expect(f.publish).not.toHaveBeenCalled();
});
