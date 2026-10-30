import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { effectScope, ref, type EffectScope } from 'vue';
import { useAutoDismissNotice } from '../src/useAutoDismissNotice';
let scope:EffectScope;
beforeEach(()=>{vi.useFakeTimers();scope=effectScope();});
afterEach(()=>{scope.stop();vi.useRealTimers();});
function setup(initial=''){const notice=ref(initial);scope.run(()=>useAutoDismissNotice(notice));return notice;}
it('dismisses the current toast after exactly two seconds',()=>{
 const notice=setup();notice.value='错误提示';vi.advanceTimersByTime(1999);expect(notice.value).toBe('错误提示');
 vi.advanceTimersByTime(1);expect(notice.value).toBe('');
});
it('restarts the countdown for a new message without an old timer clearing it',()=>{
 const notice=setup('第一条');vi.advanceTimersByTime(1500);notice.value='第二条';
 vi.advanceTimersByTime(500);expect(notice.value).toBe('第二条');
 vi.advanceTimersByTime(1500);expect(notice.value).toBe('');
});
it('cancels timers on manual dismissal and component disposal',()=>{
 const notice=setup('提示');notice.value='';expect(vi.getTimerCount()).toBe(0);
 notice.value='新提示';expect(vi.getTimerCount()).toBe(1);scope.stop();expect(vi.getTimerCount()).toBe(0);
 vi.advanceTimersByTime(2000);expect(notice.value).toBe('新提示');
});
