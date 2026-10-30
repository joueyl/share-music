import { afterEach, expect, it, vi } from 'vitest';
import { lockModalBackground } from '../src/useDialogFocus';
import { ui, resetUi, openSearch } from '../src/ui';
function setup({gap=20,padding='',computedPadding='0px',inert=false,overflow='auto',stable=false}={}) {
 const properties=new Map<string,{value:string;priority:string}>();
 const rootStyle={getPropertyValue:(key:string)=>properties.get(key)?.value??'',getPropertyPriority:(key:string)=>properties.get(key)?.priority??'',setProperty:(key:string,value:string,priority='')=>{properties.set(key,{value,priority});},removeProperty:(key:string)=>{properties.delete(key);}};
 const shell={inert},body={style:{overflow,paddingRight:padding}};
 const root={style:rootStyle,get clientWidth(){return stable?980:body.style.overflow==='hidden'?1000:1000-gap;}};
 vi.stubGlobal('document',{body,documentElement:root,querySelector:()=>shell});
 vi.stubGlobal('getComputedStyle',()=>({paddingRight:computedPadding}));
 return {shell,body,root,properties};
}
afterEach(()=>{vi.unstubAllGlobals();resetUi();});
it('holds inert, scroll lock and scrollbar padding until every overlapping dialog closes',()=>{
 const {shell,body,root}=setup();const drawer=lockModalBackground(),search=lockModalBackground();
 expect(shell.inert).toBe(true);expect(body.style.overflow).toBe('hidden');expect(body.style.paddingRight).toBe('20px');expect(root.style.getPropertyValue('--modal-scrollbar-gap')).toBe('20px');
 drawer();expect(shell.inert).toBe(true);expect(body.style.paddingRight).toBe('20px');
 search();expect(shell.inert).toBe(false);expect(body.style.overflow).toBe('auto');expect(body.style.paddingRight).toBe('');expect(root.style.getPropertyValue('--modal-scrollbar-gap')).toBe('');
 search();expect(shell.inert).toBe(false);
});
it('restores original inert state, inline padding and CSS variable including its priority',()=>{
 const {shell,body,root}=setup({inert:true,overflow:'scroll',padding:'2%',computedPadding:'16px'});
 root.style.setProperty('--modal-scrollbar-gap','3px','important');const close=lockModalBackground();
 expect(body.style.paddingRight).toBe('36px');close();expect(shell.inert).toBe(true);expect(body.style.overflow).toBe('scroll');expect(body.style.paddingRight).toBe('2%');expect(root.style.getPropertyValue('--modal-scrollbar-gap')).toBe('3px');expect(root.style.getPropertyPriority('--modal-scrollbar-gap')).toBe('important');
});
it.each([{gap:0,stable:false},{gap:20,stable:true}])('does not add padding for overlay scrollbars or an already reserved stable gutter (%j)',options=>{
 const {body,root}=setup({...options,padding:'8px',computedPadding:'8px'});const close=lockModalBackground();
 expect(body.style.paddingRight).toBe('8px');expect(root.style.getPropertyValue('--modal-scrollbar-gap')).toBe('0px');close();expect(body.style.paddingRight).toBe('8px');
});
it('does not accumulate compensation across repeated open-close cycles',()=>{
 const {body}=setup({gap:10,padding:'4px',computedPadding:'4px'});
 for(let i=0;i<3;i++){const close=lockModalBackground();expect(body.style.paddingRight).toBe('14px');close();expect(body.style.paddingRight).toBe('4px');}
});
it('search replaces drawers and session reset removes all view-only state',()=>{
 ui.queue=ui.members=ui.settings=true;openSearch();expect(ui.search).toBe(true);expect(ui.queue||ui.members||ui.settings).toBe(false);ui.library=true;ui.roomKeywords='日落';resetUi();expect(ui.search||ui.library||ui.queue).toBe(false);expect(ui.roomKeywords).toBe('');
});
