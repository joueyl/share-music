import { expect, it, vi } from 'vitest';
import { coverImageUrl, downloadCoverImage } from '../src/cover-image';
it('bounds provider image downloads and never forwards project authentication',async()=>{
 expect(coverImageUrl('https://p1.music.126.net/a?param=130y130')).toBe('https://p1.music.126.net/a?param=1024y1024');
 const request=vi.fn(async()=>new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/jpeg'}}));
 const image=await downloadCoverImage('https://y.gtimg.cn/cover.jpg',request);expect(image.bytes.length).toBe(3);expect(image.type).toBe('image/jpeg');expect(request.mock.calls[0]).toHaveLength(2);expect((request.mock.calls[0] as any)[1]).not.toHaveProperty('headers');
});
it('rejects private targets, lookalikes, unsafe redirects, non-images and oversized declarations',async()=>{
 for(const url of ['https://127.0.0.1/a','https://y.gtimg.cn.evil.test/a','http://y.gtimg.cn/a','https://user:pass@y.gtimg.cn/a','https://y.gtimg.cn/a#hash'])expect(()=>coverImageUrl(url)).toThrow('COVER_IMAGE_INVALID');
 const redirect=vi.fn(async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/secret'}}));await expect(downloadCoverImage('https://y.gtimg.cn/a',redirect)).rejects.toThrow('COVER_IMAGE_INVALID');expect(redirect).toHaveBeenCalledTimes(1);
 await expect(downloadCoverImage('https://y.gtimg.cn/a',async()=>new Response('svg',{headers:{'content-type':'image/svg+xml'}}))).rejects.toThrow('COVER_IMAGE_UNAVAILABLE');
 await expect(downloadCoverImage('https://y.gtimg.cn/a',async()=>new Response('large',{headers:{'content-type':'image/png','content-length':String(11*1024*1024)}}))).rejects.toThrow('COVER_IMAGE_TOO_LARGE');
});
