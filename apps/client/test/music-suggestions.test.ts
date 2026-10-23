import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { effectScope, ref, type EffectScope } from 'vue';
vi.mock('../src/bridge',()=>({suggestMusic:vi.fn()}));
import { useMusicSuggestions } from '../src/useMusicSuggestions';
let scope:EffectScope;
beforeEach(()=>{vi.useFakeTimers();scope=effectScope();});
afterEach(()=>{scope.stop();vi.clearAllTimers();vi.useRealTimers();});
function setup(load=vi.fn(async(_term:string,_signal?:AbortSignal)=>['晴天','晴天现场'])){
 const text=ref(''),enabled=ref(true);const result=scope.run(()=>useMusicSuggestions(text,enabled,load))!;return {text,enabled,load,...result};
}
it('debounces rapid input and requests only the final trimmed keyword',async()=>{
 const s=setup();s.text.value='晴';await vi.advanceTimersByTimeAsync(200);s.text.value=' 晴天 ';await vi.advanceTimersByTimeAsync(299);expect(s.load).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1);expect(s.load).toHaveBeenCalledOnce();expect(s.load.mock.calls[0]?.[0]).toBe('晴天');expect(s.items.value).toEqual(['晴天','晴天现场']);
});
it('aborts superseded requests and never lets stale results replace new suggestions',async()=>{
 const resolves:((value:string[])=>void)[]=[],signals:AbortSignal[]=[];
 const load=vi.fn((_term:string,signal?:AbortSignal)=>{signals.push(signal!);return new Promise<string[]>(resolve=>resolves.push(resolve));});
 const s=setup(load);s.text.value='old';await vi.advanceTimersByTimeAsync(300);s.text.value='new';expect(signals[0].aborted).toBe(true);await vi.advanceTimersByTimeAsync(300);resolves[1](['new result']);await Promise.resolve();resolves[0](['old result']);await Promise.resolve();expect(s.items.value).toEqual(['new result']);
});
it('clears input and disables suggestions during composition, blur, search or upload',async()=>{
 const s=setup();s.text.value='晴天';await vi.advanceTimersByTimeAsync(300);s.enabled.value=false;expect(s.items.value).toEqual([]);await vi.advanceTimersByTimeAsync(500);expect(s.load).toHaveBeenCalledOnce();s.text.value=' ';s.enabled.value=true;await vi.advanceTimersByTimeAsync(400);expect(s.load).toHaveBeenCalledOnce();
});
it('dismisses immediately, resets active option and cancels work on scope disposal',async()=>{
 const s=setup();s.text.value='晴天';await vi.advanceTimersByTimeAsync(300);s.active.value=0;s.dismiss();expect(s.items.value).toEqual([]);expect(s.active.value).toBe(-1);s.text.value='next';scope.stop();await vi.advanceTimersByTimeAsync(500);expect(s.load).toHaveBeenCalledOnce();
});
it('reports suggestion outages without blocking normal search',async()=>{
 const s=setup(vi.fn(async()=>{throw new Error('network');}));s.text.value='晴天';await vi.advanceTimersByTimeAsync(300);expect(s.loading.value).toBe(false);expect(s.items.value).toEqual([]);expect(s.error.value).toContain('联想暂不可用');
});

it('explains stale-server whitelist failures instead of hiding the dropdown',async()=>{
 const s=setup(vi.fn(async()=>{throw new Error('NETEASE_METHOD_NOT_ALLOWED');}));s.text.value='中文';await vi.advanceTimersByTimeAsync(300);expect(s.error.value).toContain('请重启服务端');s.text.value='English';expect(s.error.value).toBe('');
});
