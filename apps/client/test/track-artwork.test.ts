import { afterEach, beforeEach, expect, it, vi } from 'vitest';
let storage:Map<string,string>;
beforeEach(()=>{
 vi.resetModules();storage=new Map();
 vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)});
});
afterEach(()=>vi.unstubAllGlobals());
it('keeps exact-hash search artwork across restarts while isolating server environments',async()=>{
 let artwork=await import('../src/track-artwork');const track={contentHash:'a'.repeat(64)};
 artwork.rememberTrackArtwork('https://share.jouei.cn',track.contentHash,'http://p1.music.126.net/cover.jpg');
 expect(artwork.trackArtwork('https://share.jouei.cn',track)).toBe('https://p1.music.126.net/cover.jpg');
 expect(artwork.trackArtwork('http://127.0.0.1:3000',track)).toBe('');
 vi.resetModules();artwork=await import('../src/track-artwork');
 expect(artwork.trackArtwork('https://share.jouei.cn',track)).toBe('https://p1.music.126.net/cover.jpg');
 expect(artwork.trackArtwork('https://share.jouei.cn',{...track,coverUrl:'https://p2.music.126.net/new.jpg'})).toBe('https://p2.music.126.net/new.jpg');
});
it('ignores untrusted artwork and remains functional without writable storage',async()=>{
 const artwork=await import('../src/track-artwork'),track={contentHash:'b'.repeat(64)};
 artwork.rememberTrackArtwork('https://share.jouei.cn',track.contentHash,'https://evil.test/cover.jpg');
 expect(artwork.trackArtwork('https://share.jouei.cn',track)).toBe('');
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{throw new Error('quota');}});
 artwork.rememberTrackArtwork('https://share.jouei.cn',track.contentHash,'https://p1.music.163.com/cover.jpg');
 expect(artwork.trackArtwork('https://share.jouei.cn',track)).toBe('https://p1.music.163.com/cover.jpg');
});
it('prioritizes embedded artwork and does not remove a newer image when an old load is released',async()=>{
 const artwork=await import('../src/track-artwork'),track={contentHash:'c'.repeat(64),coverUrl:'https://p1.music.126.net/network.jpg'};
 artwork.setEmbeddedTrackArtwork(track.contentHash,'blob:first');
 expect(artwork.trackArtwork('https://share.jouei.cn',track)).toBe('blob:first');
 artwork.setEmbeddedTrackArtwork(track.contentHash,'blob:second');
 artwork.releaseEmbeddedTrackArtwork(track.contentHash,'blob:first');
 expect(artwork.trackArtwork('https://share.jouei.cn',track)).toBe('blob:second');
 artwork.releaseEmbeddedTrackArtwork(track.contentHash,'blob:second');
 expect(artwork.trackArtwork('https://share.jouei.cn',track)).toBe(track.coverUrl);
});
