import { expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
const read=(file:string)=>readFileSync(new URL('../src-tauri/src/system_media/'+file,import.meta.url),'utf8');
it('defers both main and proxy creation notifications instead of losing them to a reentrant runtime borrow',()=>{
 const taskbar=read('taskbar.rs');
 expect(taskbar).toContain('} else if message == hook.created {');
 expect(taskbar).toContain('hook.pending_created.record(proxy);');
 expect(taskbar).toContain('self.hook.pending_created.take()');
 expect(taskbar).toContain('PostMessageW(Some(hook.main), SYNC_PREVIEW');
 expect(taskbar).not.toContain('run_on_main_thread(super::refresh_taskbar)');
});
it('bounds native startup recovery, retries failed construction and protects shutdown/replaced sessions',()=>{
 const runtime=read('runtime.rs');
 expect(runtime).toContain('for delay in [250, 500, 1000, 2000, 4000]');
 expect(runtime).toContain('expected.strong_count() == 0');
 expect(runtime).toContain('Arc::ptr_eq(&state, &runtime.snapshot)');
 expect(runtime).toContain('if runtime.taskbar.is_none()');
 expect(runtime).toContain('taskbar.retry_startup(&state)');
 expect(read('taskbar.rs')).toContain('pub fn retry_startup');
});
