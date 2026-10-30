import { expect, it } from 'vitest';
import { isPlaylistShortLink, parsePlaylistLink, playlistReference } from '../src';
it('recognizes mobile shares and extracts one URL without trusting arbitrary hosts',()=>{
 expect(playlistReference('分享歌单 https://163cn.tv/Abc123 (@网易云音乐)')).toBe('https://163cn.tv/Abc123');
 expect(isPlaylistShortLink('http://163cn.tv/Abc123')).toBe(true);
 expect(parsePlaylistLink('https://y.music.163.com/m/playlist?id=123&creatorId=456')).toEqual({id:'123',creatorId:'456'});
 expect(parsePlaylistLink('分享歌单 https://music.163.com/#/playlist?id=123 (@网易云音乐)')).toEqual({id:'123'});
 for(const value of ['https://163cn.tv.evil.test/a','https://user:pass@163cn.tv/a','https://163cn.tv:8443/a','http://127.0.0.1/a','https://163cn.tv/','https://163cn.tv/a#x'])expect(isPlaylistShortLink(value)).toBe(false);
 expect(()=>playlistReference('https://163cn.tv/a https://163cn.tv/b')).toThrow();
});
