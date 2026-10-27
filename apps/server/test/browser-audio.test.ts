import { expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { OssStorage } from '../src/oss';
import { ApiController } from '../src/controller';
import { DomainError } from '../src/engine';
import type { AppService } from '../src/app.service';

const bytes=Buffer.from([255,251,144,0]),hash=createHash('sha256').update(bytes).digest('hex'),key=`music/files/${hash}/song.mp3`;
function fixture(){
 const request=vi.fn(async()=>new Response(bytes)),oss=new OssStorage({},request);
 vi.spyOn(oss,'url').mockResolvedValue('https://bucket.oss-cn-hangzhou.aliyuncs.com/music/test?signature=not-public');
 return {request,oss};
}
it('reads and verifies original OSS bytes without redirects or leaking URLs',async()=>{
 const f=fixture();expect(await f.oss.readAudio(key,bytes.length,hash)).toEqual(bytes);
 expect(f.request).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({redirect:'error',signal:expect.any(AbortSignal)}));
});
it('rejects excessive sizes, wrong lengths and hashes, and sanitizes transport errors',async()=>{
 const f=fixture();
 await expect(f.oss.readAudio(key,101*1024*1024,hash)).rejects.toThrow('PLAYBACK_AUDIO_METADATA_INVALID');expect(f.request).not.toHaveBeenCalled();
 f.request.mockResolvedValueOnce(new Response(bytes,{headers:{'content-length':'99'}}));
 await expect(f.oss.readAudio(key,bytes.length,hash)).rejects.toThrow('PLAYBACK_AUDIO_INTEGRITY_FAILED');
 await expect(f.oss.readAudio(key,bytes.length-1,hash)).rejects.toThrow('PLAYBACK_AUDIO_INTEGRITY_FAILED');
 await expect(f.oss.readAudio(key,bytes.length+1,hash)).rejects.toThrow('PLAYBACK_AUDIO_INTEGRITY_FAILED');
 await expect(f.oss.readAudio(key,bytes.length,'a'.repeat(64))).rejects.toThrow('PLAYBACK_AUDIO_INTEGRITY_FAILED');
 f.request.mockRejectedValueOnce(new Error('https://secret-url/signature'));
 await expect(f.oss.readAudio(key,bytes.length,hash)).rejects.toThrow(/^PLAYBACK_AUDIO_DOWNLOAD_FAILED$/);
});
it('deduplicates simultaneous reads and limits concurrent distinct files',async()=>{
 const f=fixture(),complete:((response:Response)=>void)[]=[];
 f.request.mockImplementation(()=>new Promise(resolve=>complete.push(resolve)));
 const a=f.oss.readAudio(key,bytes.length,hash),again=f.oss.readAudio(key,bytes.length,hash);
 const b=f.oss.readAudio(key.replace('song.mp3','second.mp3'),bytes.length,hash);
 expect(a).toBe(again);
 await expect(f.oss.readAudio(key.replace('song.mp3','third.mp3'),bytes.length,hash)).rejects.toThrow('PLAYBACK_AUDIO_BUSY');
 await Promise.resolve();for(const done of complete)done(new Response(bytes));
 await expect(a).resolves.toEqual(bytes);await expect(b).resolves.toEqual(bytes);
 expect(f.request).toHaveBeenCalledTimes(2);
});
it('authenticates and checks membership before and after reading audio',async()=>{
 const metadata=vi.fn(()=>({ossKey:key,sizeBytes:bytes.length,contentHash:hash})),readAudio=vi.fn(async()=>bytes);
 const controller=new ApiController({limit:()=>{},auth:{verify:()=>({id:'user'})},musicImport:{metadata},oss:{readAudio}} as unknown as AppService);
 const room=randomUUID(),song=randomUUID();
 await expect(controller.browserAudio(room,song)).rejects.toThrow();expect(readAudio).not.toHaveBeenCalled();
 const file=await controller.browserAudio(room,song,'Bearer token');const chunks:Buffer[]=[];
 for await(const chunk of file!.getStream())chunks.push(chunk);
 expect(Buffer.concat(chunks)).toEqual(bytes);expect(metadata).toHaveBeenCalledTimes(2);
 metadata.mockClear();metadata.mockImplementationOnce(()=>{throw new DomainError('NOT_IN_ROOM');});
 await expect(controller.browserAudio(room,song,'Bearer token')).rejects.toThrow();expect(readAudio).toHaveBeenCalledTimes(1);
 metadata.mockImplementationOnce(()=>({ossKey:key,sizeBytes:bytes.length,contentHash:hash})).mockImplementationOnce(()=>{throw new DomainError('NOT_IN_ROOM');});
 await expect(controller.browserAudio(room,song,'Bearer token')).rejects.toThrow();expect(readAudio).toHaveBeenCalledTimes(2);
});
