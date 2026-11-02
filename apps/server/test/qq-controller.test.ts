import { afterEach, expect, it, vi } from 'vitest';
import { QqController } from '../src/qq.controller';
import { DomainError } from '../src/engine';

afterEach(()=>vi.unstubAllEnvs());
function fixture(){
 const app={flush:vi.fn(),auth:{verify:vi.fn(async()=>({id:'user'}))},limit:vi.fn(),qq:{channels:vi.fn(async()=>({channels:['qq']})),begin:vi.fn(),check:vi.fn(),cancel:vi.fn(),status:vi.fn(),search:vi.fn(async()=>({songs:[],total:0})),lyrics:vi.fn()}};
 const controller=new QqController(app as any),req={method:'POST',protocol:'http',headers:{host:'localhost:3000',origin:'http://localhost:3000'},socket:{remoteAddress:'127.0.0.1'}},res={setHeader:vi.fn()};
 return {app,controller,req,res};
}
it('protects QQ administration with existing Basic auth, origin and rate limits',async()=>{
 vi.stubEnv('NETEASE_ADMIN_TOKEN','test-admin-only');vi.stubEnv('NETEASE_LOGIN_ORIGIN','http://localhost:3000');
 const f=fixture();
 await expect(f.controller.channels(f.req as any,f.res as any)).rejects.toMatchObject({status:401});expect(f.app.qq.channels).not.toHaveBeenCalled();
 Object.assign(f.req.headers,{authorization:'Basic '+Buffer.from('admin:test-admin-only').toString('base64'),origin:'http://untrusted.example'});
 await expect(f.controller.channels(f.req as any,f.res as any)).rejects.toMatchObject({status:403});expect(f.app.qq.channels).not.toHaveBeenCalled();
 f.req.headers.origin='http://localhost:3000';expect(await f.controller.channels(f.req as any,f.res as any)).toEqual({channels:['qq']});
 expect(f.res.setHeader).toHaveBeenCalledWith('Cache-Control','no-store');expect(f.app.limit).toHaveBeenCalledWith('netease-admin:127.0.0.1',60,60000);
 await expect(f.controller.qr(f.req as any,f.res as any,{channel:'other'})).rejects.toMatchObject({status:400});expect(f.app.qq.begin).not.toHaveBeenCalled();
 await expect(f.controller.check(f.req as any,f.res as any,{sessionId:'upstream-key'})).rejects.toMatchObject({status:400});expect(f.app.qq.check).not.toHaveBeenCalled();
});
it('requires project authentication and validates search pagination and lyric MIDs before upstream access',async()=>{
 const f=fixture();await expect(f.controller.search({keyword:'song'})).rejects.toMatchObject({status:401});expect(f.app.qq.search).not.toHaveBeenCalled();
 await expect(f.controller.search({keyword:'song',offset:1},'Bearer project-token')).rejects.toMatchObject({status:400});
 await expect(f.controller.search({keyword:'song',url:'http://localhost'},'Bearer project-token')).rejects.toMatchObject({status:400});
 expect(await f.controller.search({keyword:' song ',offset:'20'},'Bearer project-token')).toEqual({songs:[],total:0});
 expect(f.app.auth.verify).toHaveBeenCalledWith('project-token');expect(f.app.limit).toHaveBeenCalledWith('qq:user',60,60000);expect(f.app.qq.search).toHaveBeenCalledWith('song',20);
 await expect(f.controller.lyrics('../private','Bearer project-token')).rejects.toMatchObject({status:400});expect(f.app.qq.lyrics).not.toHaveBeenCalled();
});
it('keeps provider failures distinct from invalid user input and project authentication',async()=>{
 const f=fixture();
 for(const [code,status] of [['QQ_MUSIC_UNAVAILABLE',502],['QQ_INVALID_RESPONSE',502],['QQ_MUSIC_RATE_LIMITED',429],['QQ_LOGIN_REQUIRED',503]] as const){
  f.app.qq.search.mockRejectedValueOnce(new DomainError(code));
  await expect(f.controller.search({keyword:'song'},'Bearer project-token')).rejects.toMatchObject({status,response:{error:code}});
 }
});
