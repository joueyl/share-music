import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { h, provide, ref, type Ref } from 'vue';
import { node, renderer } from './helpers/vue-host';
import { useStageActivity } from '../src/useStageActivity';
import { CACHED_PAGE_ACTIVE } from '../src/useCachedActivity';

let mounted:ReturnType<typeof renderer.createApp>;
let change:()=>void;
const resume=vi.fn(),pause=vi.fn(),remove=vi.fn();
let parent:Ref<boolean>,active:Readonly<Ref<boolean>>;
beforeEach(()=>{
 resume.mockReset();pause.mockReset();remove.mockReset();parent=ref(true);
 vi.stubGlobal('document',{visibilityState:'visible',
  addEventListener:(name:string,handler:()=>void)=>{expect(name).toBe('visibilitychange');change=handler;},removeEventListener:remove});
});
afterEach(()=>{mounted?.unmount();vi.unstubAllGlobals();});
function mount(){
 const Stage={setup(){active=useStageActivity(resume,pause);return()=>h('div');}};
 mounted=renderer.createApp({setup(){provide(CACHED_PAGE_ACTIVE,parent);return()=>h(Stage);}});
 mounted.mount(node('root'));
}
function visibility(value:string){Object.assign(document,{visibilityState:value});change();}
it('pauses hidden stages, resumes visible stages once and removes its visibility listener',()=>{
 mount();expect(active.value).toBe(true);
 visibility('hidden');visibility('hidden');expect(pause).toHaveBeenCalledOnce();expect(active.value).toBe(false);
 visibility('visible');visibility('visible');expect(resume).toHaveBeenCalledOnce();expect(active.value).toBe(true);
 mounted.unmount();expect(remove).toHaveBeenCalledExactlyOnceWith('visibilitychange',change);
});
it('does not resume cached room stages in the lobby when the window becomes visible',()=>{
 mount();parent.value=false;expect(pause).toHaveBeenCalledOnce();
 visibility('hidden');visibility('visible');expect(active.value).toBe(false);expect(resume).not.toHaveBeenCalled();
 parent.value=true;expect(active.value).toBe(true);expect(resume).toHaveBeenCalledOnce();
});
it('starts inactive in a hidden window and waits for both room and window visibility',()=>{
 Object.assign(document,{visibilityState:'hidden'});mount();expect(active.value).toBe(false);
 parent.value=false;visibility('visible');expect(resume).not.toHaveBeenCalled();
 parent.value=true;expect(resume).toHaveBeenCalledOnce();
});
