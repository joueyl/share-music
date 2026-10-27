import { expect, it, vi } from 'vitest';
import { createUpdates, type UpdateProgress } from '../src/app-updates';
function fixture(){
 const adapter={desktop:()=>true,status:vi.fn(async()=>({configured:true,supported:true})),check:vi.fn(async()=>({version:'0.1.2',currentVersion:'0.1.1',body:'新增功能'})),install:vi.fn(async(_progress:(event:UpdateProgress)=>void)=>{}),restart:vi.fn(async()=>{})};
 return {adapter,controller:createUpdates(adapter)};
}
it('does not check GitHub from the web, unconfigured clients or unsupported package formats',async()=>{
 for(const mode of ['web','disabled','deb']){
  const f=fixture();if(mode==='web')f.adapter.desktop=()=>false;
  f.adapter.status.mockResolvedValue({configured:mode!=='disabled',supported:mode!=='deb'});
  const controller=createUpdates(f.adapter);await controller.check();
  expect(f.adapter.check).not.toHaveBeenCalled();expect(f.adapter.install).not.toHaveBeenCalled();
  expect(controller.state.phase).toBe(mode==='disabled'?'disabled':'unsupported');
 }
});
it('requires an explicit install confirmation, reports download progress and waits for successful installation',async()=>{
 const f=fixture();await f.controller.check();expect(f.controller.state.phase).toBe('available');
 await f.controller.install(false);expect(f.adapter.install).not.toHaveBeenCalled();
 let finish!:()=>void;
 f.adapter.install.mockImplementation(async progress=>{progress({event:'Started'});progress({event:'Progress',chunkLength:50,contentLength:100});await new Promise<void>(r=>finish=r);progress({event:'Finished'});});
 const pending=f.controller.install(true);expect(f.controller.locked.value).toBe(true);expect(f.controller.percent.value).toBe(50);
 await f.controller.install(true);expect(f.adapter.install).toHaveBeenCalledOnce();
 finish();await pending;expect(f.controller.state.phase).toBe('installed');
 await f.controller.restart();expect(f.adapter.restart).toHaveBeenCalledOnce();
});
it('does not claim installation succeeded after verification or network failure and can retry checking',async()=>{
 const f=fixture();await f.controller.check();f.adapter.install.mockRejectedValueOnce('UPDATER_INSTALL_FAILED');
 await f.controller.install(true);expect(f.controller.state.phase).toBe('error');expect(f.controller.state.update).toBeNull();expect(f.controller.locked.value).toBe(false);
 await f.controller.check();expect(f.controller.state.phase).toBe('available');
});
it('prevents duplicate checks and safely displays errors without raw URLs or tokens',async()=>{
 const f=fixture();let finish!:(value:any)=>void;f.adapter.check.mockImplementation(()=>new Promise(r=>finish=r));
 const pending=f.controller.check();await Promise.resolve();await f.controller.check();expect(f.adapter.check).toHaveBeenCalledOnce();finish(null);await pending;
 expect(f.controller.state.phase).toBe('current');
 f.adapter.check.mockRejectedValueOnce('secret signed URL');await f.controller.check();expect(f.controller.state.message).not.toContain('secret');
});
