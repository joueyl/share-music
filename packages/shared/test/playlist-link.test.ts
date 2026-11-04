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

it('classifies profile, playlist and album by resource path, never by userid or creatorId',async()=>{
 const {parseMusicReference}=await import('../src');
 expect(parseMusicReference('https://music.163.com/#/user?id=274950922是个人主页')).toEqual({kind:'user',id:'274950922'});
 expect(parseMusicReference('https://music.163.com/#/album/38306/?userid=274950922')).toEqual({kind:'album',id:'38306'});
 expect(parseMusicReference('https://music.163.com/m/playlist?id=804180248&creatorId=274950922')).toEqual({kind:'playlist',id:'804180248'});
 expect(parseMusicReference('https://music.163.com/user/home?id=123')).toEqual({kind:'user',id:'123'});
 expect(parseMusicReference('123')).toEqual({kind:'playlist',id:'123'});
 for(const input of ['https://music.163.com.evil.com/user?id=1','https://music.163.com/#//evil.com/user?id=1','https://user:pass@music.163.com/user?id=1','https://music.163.com:8443/user?id=1','https://music.163.com/user?id=1&id=2','https://music.163.com/album/1?id=2','https://music.163.com/song?id=1'])expect(()=>parseMusicReference(input)).toThrow();
});
