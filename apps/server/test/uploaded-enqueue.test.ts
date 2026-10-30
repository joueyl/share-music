import { expect, it, vi } from 'vitest';
import { ApiController } from '../src/controller';
import type { AppService } from '../src/app.service';
it('registers music by song id and never accepts a raw audio upload',async()=>{
 const importSong=vi.fn(async()=>({sourceUrl:'https://m801.music.126.net/a'}));
 const controller=new ApiController({flush:async()=>{},limit:()=>{},auth:{verify:()=>({id:'user'})},musicImport:{importSong}} as unknown as AppService);
 await expect(controller.upload({songId:'123'},'Bearer token','application/json')).resolves.toHaveProperty('track.sourceUrl');expect(importSong).toHaveBeenCalledWith('123');
 await expect(controller.upload(undefined,'Bearer token','application/octet-stream')).rejects.toMatchObject({status:410});
 await expect(controller.upload({url:'http://localhost/private'},'Bearer token','application/json')).rejects.toMatchObject({status:400});expect(importSong).toHaveBeenCalledOnce();
});
