import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ApiController } from '../src/controller';
import { DomainError } from '../src/engine';
import type { AppService } from '../src/app.service';
const bytes=Buffer.from([255,251,144,0]);
it('authenticates and checks membership before and after reading audio',async()=>{
 const metadata=vi.fn(()=>({})),readAudio=vi.fn(async()=>bytes);
 const controller=new ApiController({flush:async()=>{},limit:()=>{},auth:{verify:()=>({id:'user'})},musicImport:{metadata,readAudio}} as unknown as AppService);
 const room=randomUUID(),song=randomUUID();
 await expect(controller.browserAudio(room,song)).rejects.toThrow();expect(readAudio).not.toHaveBeenCalled();
 const file=await controller.browserAudio(room,song,'Bearer token');const chunks:Buffer[]=[];
 for await(const chunk of file!.getStream())chunks.push(chunk);
 expect(Buffer.concat(chunks)).toEqual(bytes);expect(metadata).toHaveBeenCalledTimes(1);
 metadata.mockClear();readAudio.mockRejectedValueOnce(new DomainError('NOT_IN_ROOM'));
 await expect(controller.browserAudio(room,song,'Bearer token')).rejects.toThrow();
 metadata.mockImplementationOnce(()=>{throw new DomainError('NOT_IN_ROOM');});
 await expect(controller.browserAudio(room,song,'Bearer token')).rejects.toThrow();expect(readAudio).toHaveBeenCalledTimes(3);
});
