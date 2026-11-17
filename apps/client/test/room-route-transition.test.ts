import { afterEach,expect,it,vi } from 'vitest';
import { createRoomRouteTransition } from '../src/room-route-transition';
import { createScrollTransitionLayer } from '../src/scroll-transition-layer';
afterEach(()=>vi.unstubAllGlobals());
function element(room=true){
 const values=new Map<string,{value:string;priority:string}>();
 const style={getPropertyValue:(key:string)=>values.get(key)?.value??'',getPropertyPriority:(key:string)=>values.get(key)?.priority??'',setProperty:(key:string,value:string,priority='')=>values.set(key,{value,priority}),removeProperty:(key:string)=>values.delete(key)};
 const placeholders:any[]=[];
 const parent={insertBefore:vi.fn((p:any)=>{p.attached=true;})};
 const shell={getBoundingClientRect:()=>({left:0,top:0})};
 const el={style,classList:{contains:()=>room},closest:()=>shell,parentNode:parent,getBoundingClientRect:vi.fn(()=>({left:100,top:448.25,width:600.5,height:400.25})),ownerDocument:{createElement:()=>{
  const p:any={style:{},attached:false,setAttribute:vi.fn(),remove:vi.fn(()=>{p.attached=false;})};placeholders.push(p);return p;
 }}};
 vi.stubGlobal('getComputedStyle',()=>({transform:'matrix(1,0,0,1,0,400.25)',transformOrigin:'300.25px 200.125px'}));
 vi.stubGlobal('DOMMatrixReadOnly',class{m11=1;m22=1;m41=0;m42=400.25;});
 return {el:el as unknown as HTMLElement,style,placeholders,parent};
}
it('keeps the original fractional geometry and flow space while preserving the CSS transform',()=>{
 const f=element(),motion=createRoomRouteTransition();motion.start(f.el);
 expect(f.style.getPropertyValue('position')).toBe('fixed');expect(f.style.getPropertyValue('left')).toBe('100px');expect(f.style.getPropertyValue('top')).toBe('48px');
 expect(f.style.getPropertyValue('width')).toBe('600.5px');expect(f.style.getPropertyValue('height')).toBe('400.25px');expect(f.style.getPropertyValue('transform')).toBe('');expect(f.style.getPropertyValue('overflow')).toBe('');
 expect(f.placeholders[0].style.height).toBe('400.25px');expect(f.placeholders[0].setAttribute).toHaveBeenCalledWith('aria-hidden','true');expect(f.placeholders[0].attached).toBe(true);
 motion.finish(f.el);expect(f.style.getPropertyValue('position')).toBe('');expect(f.placeholders[0].attached).toBe(false);
});
it('restores existing inline values and priority on completion/cancel without leaking repeated placeholders',()=>{
 const f=element(),motion=createRoomRouteTransition();f.style.setProperty('left','3px','important');
 motion.start(f.el);motion.start(f.el);expect(f.placeholders.filter(p=>p.attached)).toHaveLength(1);
 motion.finish(f.el);motion.finish(f.el);
 expect(f.style.getPropertyValue('left')).toBe('3px');expect(f.style.getPropertyPriority('left')).toBe('important');expect(f.placeholders.filter(p=>p.attached)).toHaveLength(0);
});
it('does not alter music/discovery pages and cleans pending room layers on disposal',()=>{
 const other=element(false),f=element(),motion=createRoomRouteTransition();motion.start(other.el);expect(other.parent.insertBefore).not.toHaveBeenCalled();
 motion.start(f.el);motion.dispose();expect(f.style.getPropertyValue('position')).toBe('');expect(f.placeholders.filter(p=>p.attached)).toHaveLength(0);
});

it('isolates a viewport-relative search modal without changing its translate/scale geometry',()=>{
 const f=element(),motion=createScrollTransitionLayer('global-search-modal');
 f.el.getBoundingClientRect=()=>({left:12.8,top:19.2,width:1254.4,height:705.6}) as DOMRect;
 vi.stubGlobal('getComputedStyle',()=>({transform:'matrix(.98,0,0,.98,0,12)',transformOrigin:'640px 360px'}));
 vi.stubGlobal('DOMMatrixReadOnly',class{m11=.98;m22=.98;m41=0;m42=12;});
 motion.start(f.el);
 expect(parseFloat(f.style.getPropertyValue('top'))).toBeCloseTo(0);expect(parseFloat(f.style.getPropertyValue('left'))).toBeCloseTo(0);
 expect(parseFloat(f.style.getPropertyValue('width'))).toBeCloseTo(1280);expect(parseFloat(f.style.getPropertyValue('height'))).toBeCloseTo(720);
 expect(f.style.getPropertyValue('transform')).toBe('');motion.dispose();expect(f.placeholders[0].attached).toBe(false);
});
