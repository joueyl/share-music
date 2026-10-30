import { expect, it, vi } from 'vitest';
import { resolvePlaylistShareLink } from '../src/playlist-link';
import { ApiController } from '../src/controller';
import type { AppService } from '../src/app.service';
const redirect=(location:string)=>new Response('redirect',{status:302,headers:{location}});
it('distinguishes the reported 302 album share from a playlist without fetching the album page',async()=>{
 const request=vi.fn().mockResolvedValue(redirect('https://music.163.com/album/38306/?userid=274950922'));
 await expect(resolvePlaylistShareLink('https://163cn.tv/bjPcTvty',request)).rejects.toThrow('PLAYLIST_LINK_IS_ALBUM');
 expect(request).toHaveBeenCalledOnce();
 const direct=vi.fn();await expect(resolvePlaylistShareLink('https://music.163.com/album/38306/',direct)).rejects.toThrow('PLAYLIST_LINK_IS_ALBUM');expect(direct).not.toHaveBeenCalled();
});
it('accepts both 301 and 302 playlist redirects',async()=>{
 for(const status of [301,302]){
  const request=vi.fn().mockResolvedValue(new Response(null,{status,headers:{location:'https://music.163.com/playlist?id=123'}}));
  expect(await resolvePlaylistShareLink('https://163cn.tv/Abc',request)).toEqual({id:'123'});
 }
});
it('resolves relative short redirects to a desktop/mobile playlist and never fetches the final page',async()=>{
 const request=vi.fn().mockResolvedValueOnce(redirect('/Other')).mockResolvedValueOnce(redirect('https://y.music.163.com/m/playlist?id=123&creatorId=456'));
 expect(await resolvePlaylistShareLink('分享歌单 http://163cn.tv/Abc (@网易云音乐)',request)).toEqual({id:'123'});
 expect(request).toHaveBeenCalledTimes(2);expect(String(request.mock.calls[0][0])).toBe('https://163cn.tv/Abc');
 expect(request.mock.calls[0][1]).toMatchObject({redirect:'manual',headers:{Accept:'text/html'},signal:expect.any(AbortSignal)});
 const direct=vi.fn();expect(await resolvePlaylistShareLink('https://music.163.com/#/playlist?id=789',direct)).toEqual({id:'789'});expect(direct).not.toHaveBeenCalled();
});
it('blocks foreign/private hosts, credentials and non-playlist redirects before fetching them',async()=>{
 for(const url of ['http://127.0.0.1/private','https://music.163.com.evil.test/playlist?id=1','https://music.163.com/song?id=1','file:///etc/passwd','https://user:pass@163cn.tv/a','https://163cn.tv:8443/a']){
  const request=vi.fn().mockResolvedValue(redirect(url));
  await expect(resolvePlaylistShareLink('https://163cn.tv/Abc',request)).rejects.toThrow('PLAYLIST_LINK_INVALID');expect(request).toHaveBeenCalledOnce();
 }
 const request=vi.fn();await expect(resolvePlaylistShareLink('http://127.0.0.1/a',request)).rejects.toThrow('PLAYLIST_LINK_INVALID');expect(request).not.toHaveBeenCalled();
});
it('bounds loops, hop count and failed or nonredirect responses',async()=>{
 const loop=vi.fn().mockResolvedValue(redirect('/Abc'));
 await expect(resolvePlaylistShareLink('https://163cn.tv/Abc',loop)).rejects.toThrow('PLAYLIST_LINK_REDIRECT_LIMIT');expect(loop).toHaveBeenCalledOnce();
 let n=0;const many=vi.fn(async()=>redirect('/Next'+(++n)));
 await expect(resolvePlaylistShareLink('https://163cn.tv/Abc',many)).rejects.toThrow('PLAYLIST_LINK_REDIRECT_LIMIT');expect(many).toHaveBeenCalledTimes(5);
 for(const response of [new Response('landing'),new Response(null,{status:302}),new Response(null,{status:404})]){
  await expect(resolvePlaylistShareLink('https://163cn.tv/Abc',vi.fn().mockResolvedValue(response))).rejects.toThrow('PLAYLIST_LINK_RESOLVE_FAILED');
 }
 await expect(resolvePlaylistShareLink('https://163cn.tv/Abc',vi.fn().mockRejectedValue(Error('private detail')))).rejects.toThrow(/^PLAYLIST_LINK_RESOLVE_FAILED$/);
});
it('requires authentication and a strict input body before resolution',async()=>{
 const app={flush:async()=>{},auth:{verify:vi.fn().mockResolvedValue({id:'user'})},limit:vi.fn()} as unknown as AppService;
 const controller=new ApiController(app);
 await expect(controller.resolvePlaylist({input:'123'})).rejects.toMatchObject({status:401});
 await expect(controller.resolvePlaylist({input:'123',proxy:'http://bad'},'Bearer token')).rejects.toMatchObject({status:400});
 expect(await controller.resolvePlaylist({input:'123'},'Bearer token')).toEqual({id:'123'});
 expect(app.limit).toHaveBeenCalledWith('playlist-resolve:user',20,60000);
});
