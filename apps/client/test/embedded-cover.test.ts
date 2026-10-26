import { expect, it } from 'vitest';
import { extractEmbeddedCover } from '../src/embedded-cover';
import { flacWithPicture, m4aWithCover, mp3WithPictures, png } from './fixtures/embedded-audio';

it.each([2,3,4] as const)('reads real ID3v2.%i attached-picture frames from MP3 bytes',async version=>{
  const cover=await extractEmbeddedCover(mp3WithPictures([{data:png}],version),'audio/mpeg');
  expect(cover?.type).toBe('image/png');expect(new Uint8Array(await cover!.arrayBuffer())).toEqual(png);
});
it('prefers the front cover over an earlier back-cover image',async()=>{
  const back=new Uint8Array([...png,0]);
  const cover=await extractEmbeddedCover(mp3WithPictures([{data:back,type:4},{data:png,type:3}]),'audio/mpeg');
  expect(new Uint8Array(await cover!.arrayBuffer())).toEqual(png);
});
it('reads the FLAC PICTURE metadata block',async()=>{
  const cover=await extractEmbeddedCover(flacWithPicture(),'audio/flac');
  expect(cover?.type).toBe('image/png');expect(new Uint8Array(await cover!.arrayBuffer())).toEqual(png);
});
it('reads the M4A covr atom',async()=>{
  const cover=await extractEmbeddedCover(m4aWithCover(),'audio/mp4');
  expect(cover?.type).toBe('image/png');expect(new Uint8Array(await cover!.arrayBuffer())).toEqual(png);
});
it('keeps playback safe for missing, malformed or non-raster artwork',async()=>{
  expect(await extractEmbeddedCover(mp3WithPictures([]),'audio/mpeg')).toBeNull();
  expect(await extractEmbeddedCover(new Uint8Array([1,2,3]))).toBeNull();
  expect(await extractEmbeddedCover(mp3WithPictures([{data:new TextEncoder().encode('<svg onload="alert(1)"/>')}]),'audio/mpeg')).toBeNull();
});
