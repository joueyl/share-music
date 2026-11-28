import { expect, it, vi } from 'vitest';
import { ApiController } from '../src/controller';
import type { AppService } from '../src/app.service';
import type { DatabaseStore } from '../src/database';
import { DomainError } from '../src/engine';
import { NeteaseService } from '../src/netease';

it('reads real upstream comment fields without using saved login credentials',async()=>{
 const getSetting=vi.fn();
 const hot={commentId:7,content:'精彩评论',likedCount:99,user:{nickname:'热评作者'}};
 const sdk=vi.fn(async()=>({body:{code:200,total:32,more:true,hotComments:[hot,hot,{commentId:8}],comments:[
  {commentId:15,content:'<b>纯文本</b>',likedCount:0,time:1700000000000,user:{nickname:'听众',avatarUrl:'http://p1.music.126.net/avatar.jpg',userId:7,extra:'ignored'}},
  {commentId:16,content:'匿名',user:{avatarUrl:'https://unrelated.test/image'}},
 ]}}));
 const service=new NeteaseService({getSetting} as unknown as DatabaseStore,sdk,()=>123);
 expect(await service.songComments('42',0)).toEqual({hotComments:[
  {id:'7',content:'精彩评论',nickname:'热评作者',avatarUrl:null,time:null,likedCount:99},
 ],comments:[
  {id:'15',content:'<b>纯文本</b>',nickname:'听众',avatarUrl:'https://p1.music.126.net/avatar.jpg',time:1700000000000,likedCount:0},
  {id:'16',content:'匿名',nickname:null,avatarUrl:null,time:null,likedCount:null},
 ],total:32,nextOffset:20});
 expect(sdk).toHaveBeenCalledExactlyOnceWith('comment_music',{id:'42',limit:20,offset:0,cookie:'',timestamp:123});
 expect((await service.songComments('42',20)).hotComments).toEqual([]);
 expect(getSetting).not.toHaveBeenCalled();
 await expect(service.songComments('42',10001)).rejects.toThrow('INVALID_REQUEST');
});

it('does not pass a rejected or malformed upstream response off as empty',async()=>{
 const sdk=vi.fn().mockResolvedValueOnce({body:{code:301}}).mockResolvedValueOnce({body:{code:200}}).mockResolvedValueOnce({body:{code:200,comments:[],total:0}});
 const service=new NeteaseService({} as DatabaseStore,sdk);
 await expect(service.songComments('42',0)).rejects.toThrow('NETEASE_INVALID_RESPONSE');
 await expect(service.songComments('42',0)).rejects.toThrow('NETEASE_INVALID_RESPONSE');
 await expect(service.songComments('42',0)).resolves.toEqual({hotComments:[],comments:[],total:0,nextOffset:null});
});

it('requires credentials and online membership, limits inputs, and rechecks membership after fetching',async()=>{
 const track=vi.fn(async()=>({neteaseId:'42'})),songComments=vi.fn(async()=>({hotComments:[],comments:[],total:0,nextOffset:null}));
 const controller=new ApiController({flush:async()=>{},auth:{verify:async()=>({id:'user'})},limit:()=>{},musicImport:{metadata:track},netease:{songComments}} as unknown as AppService);
 const room='00000000-0000-4000-8000-000000000001',song='00000000-0000-4000-8000-000000000002';
 await expect(controller.comments(room,song,undefined,{})).rejects.toMatchObject({status:401,response:{error:'UNAUTHORIZED'}});
 await expect(controller.comments(room,song,'Bearer fixture',{offset:'10001'})).rejects.toMatchObject({status:400,response:{error:'INVALID_REQUEST'}});
 track.mockRejectedValueOnce(new DomainError('NOT_IN_ROOM'));
 await expect(controller.comments(room,song,'Bearer fixture',{})).rejects.toMatchObject({response:{error:'NOT_IN_ROOM'}});
 track.mockResolvedValueOnce({neteaseId:''});
 await expect(controller.comments(room,song,'Bearer fixture',{})).rejects.toMatchObject({response:{error:'COMMENTS_SOURCE_UNSUPPORTED'}});
 expect(songComments).not.toHaveBeenCalled();
 track.mockResolvedValueOnce({neteaseId:'42'}).mockRejectedValueOnce(new DomainError('NOT_IN_ROOM'));
 await expect(controller.comments(room,song,'Bearer fixture',{offset:'20'})).rejects.toMatchObject({response:{error:'NOT_IN_ROOM'}});
 expect(songComments).toHaveBeenCalledExactlyOnceWith('42',20);
 await expect(controller.comments(room,song,'Bearer fixture',{})).resolves.toEqual({hotComments:[],comments:[],total:0,nextOffset:null});
});
