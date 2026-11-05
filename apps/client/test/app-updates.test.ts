import { expect, it, vi } from 'vitest';
import { createUpdates, type UpdateProgress } from '../src/app-updates';
import { readFileSync } from 'node:fs';
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
it('checks once in the background per startup and only reports an available update without installing',async()=>{
 const f=fixture();
 const first=f.controller.checkOnStartup();
 expect(f.controller.checkOnStartup()).toBe(first);
 expect(await first).toBe(true);
 expect(await f.controller.checkOnStartup()).toBe(true);
 expect(f.adapter.check).toHaveBeenCalledOnce();
 expect(f.adapter.install).not.toHaveBeenCalled();
 expect(f.adapter.restart).not.toHaveBeenCalled();
 // A new app session checks again, even for a version previously dismissed.
 expect(await createUpdates(f.adapter).checkOnStartup()).toBe(true);
 expect(f.adapter.check).toHaveBeenCalledTimes(2);
 // Manual checks remain available after the startup check.
 await f.controller.check();expect(f.adapter.check).toHaveBeenCalledTimes(3);
});
it('does not request a startup dialog when current, failed, unconfigured, unsupported or in a browser',async()=>{
 for(const mode of ['current','error','disabled','deb','web']){
  const f=fixture();
  if(mode==='current')f.adapter.check.mockResolvedValueOnce(null as any);
  if(mode==='error')f.adapter.check.mockRejectedValueOnce('UPDATER_CHECK_FAILED');
  if(mode==='web')f.adapter.desktop=()=>false;
  f.adapter.status.mockResolvedValue({configured:mode!=='disabled',supported:mode!=='deb'});
  const controller=createUpdates(f.adapter);
  expect(await controller.checkOnStartup()).toBe(false);
  expect(f.adapter.install).not.toHaveBeenCalled();
  if(['disabled','deb','web'].includes(mode))expect(f.adapter.check).not.toHaveBeenCalled();
  if(mode==='web')expect(f.adapter.status).not.toHaveBeenCalled();
  if(mode==='error'){
   await controller.check();expect(controller.state.phase).toBe('available');
  }
 }
});
it('wires startup checks independently of login and native window setup, deferring the dialog until after splash',()=>{
 const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8');
 expect(app).toContain('watch([splashDone, startupUpdateAvailable]');
 expect(app).toContain("if (appUpdates.state.phase === 'available') versionOpen.value = true");
 expect(app).toContain('if (alive) startupUpdateAvailable.value = available');
 expect(app).toContain('onUnmounted(() => { alive = false; })');
 expect(app.indexOf('void appUpdates.checkOnStartup()')).toBeLessThan(app.indexOf('isMaximized.value = await bridge.isWindowMaximized()'));
 expect(app).toContain('<VersionHistoryDialog v-if="versionOpen"');
});
