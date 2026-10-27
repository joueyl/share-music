import { expect, it } from 'vitest';
import { activeLyric, parseLyrics, parsePlaylistLink } from '../src/music-library';

it('accepts mobile, desktop fragment and numeric playlist references without fetching arbitrary URLs',()=>{
 expect(parsePlaylistLink('https://music.163.com/m/playlist?id=2991837660&creatorId=288364640')).toEqual({id:'2991837660',creatorId:'288364640'});
 expect(parsePlaylistLink('https://music.163.com/#/playlist?id=123')).toEqual({id:'123'});
 expect(parsePlaylistLink(' 123 ')).toEqual({id:'123'});
 for(const input of ['https://music.163.com.evil.test/playlist?id=123','https://evil.test/?id=123','https://music.163.com/song?id=123','https://user@music.163.com/playlist?id=123','https://music.163.com/playlist?id=x','file:///playlist?id=123'])expect(()=>parsePlaylistLink(input)).toThrow();
});
it('parses LRC multi-time tags, millisecond fractions, offset and unsorted lines',()=>{
 const lines=parseLyrics({lrc:{lyric:'[ar:歌手]\n[offset:100]\n[00:05.12]第二行\n[00:01.5][00:03.005]重复行\n无时间文本'}});
 expect(lines.map(l=>[l.start,l.text])).toEqual([[1600,'重复行'],[3105,'重复行'],[5220,'第二行']]);
 expect(lines[0].end).toBe(3105);expect(activeLyric(lines,0)).toBe(-1);expect(activeLyric(lines,1600)).toBe(0);expect(activeLyric(lines,4000)).toBe(1);expect(activeLyric(lines,99999)).toBe(2);
});
it('prefers YRC absolute word timings and supports seeking backward',()=>{
 const lines=parseLyrics({yrc:{lyric:'[1000,2000](1000,500,0)你(1500,1500,0)好\n[4000,1000](4000,1000,0)世界'},lrc:{lyric:'[00:01]fallback'}});
 expect(lines[0]).toEqual({start:1000,end:3000,text:'你好',words:[{start:1000,duration:500,text:'你'},{start:1500,duration:1500,text:'好'}]});
 expect(activeLyric(lines,4500)).toBe(1);expect(activeLyric(lines,1200)).toBe(0);
 // A completed line remains active throughout the gap until the next line starts.
 for(const time of [3000,3500,3999])expect(activeLyric(lines,time)).toBe(0);
 expect(activeLyric(lines,4000)).toBe(1);expect(activeLyric(lines,99999)).toBe(1);
 expect(parseLyrics({yrc:{lyric:'{"t":0}'},lrc:{lyric:'[00:01]普通歌词'}})[0].text).toBe('普通歌词');
 expect(parseLyrics({})).toEqual([]);
});
