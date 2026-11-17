/** Animate a layer above its scrollport without contributing transformed overflow.
 * The empty placeholder keeps the original scroll range; no scrollbars are hidden. */
export function createScrollTransitionLayer(className:string,containingBlock?:string){
 const pending=new Map<HTMLElement,()=>void>();
 function finish(value:Element){const el=value as HTMLElement;pending.get(el)?.();pending.delete(el);}
 function start(value:Element){
  const el=value as HTMLElement;
  if(!el.classList.contains(className))return;
  finish(el);
  const shell=containingBlock?el.closest<HTMLElement>(containingBlock):null;
  if((containingBlock&&!shell)||!el.parentNode)return;
  const rect=el.getBoundingClientRect(),container=shell?.getBoundingClientRect()??{left:0,top:0},style=getComputedStyle(el);
  const matrix=style.transform==='none'?null:new DOMMatrixReadOnly(style.transform);
  const [ox=0,oy=0]=style.transformOrigin.split(' ').map(Number.parseFloat);
  const left=rect.left-(matrix?.m41??0)-ox*(1-(matrix?.m11??1))-container.left;
  const top=rect.top-(matrix?.m42??0)-oy*(1-(matrix?.m22??1))-container.top;
  const width=rect.width/(matrix?.m11||1),height=rect.height/(matrix?.m22||1);
  const placeholder=el.ownerDocument.createElement('div');
  placeholder.setAttribute('aria-hidden','true');
  Object.assign(placeholder.style,{width:`${width}px`,height:`${height}px`,flex:'0 0 auto',pointerEvents:'none'});
  const properties={position:'fixed',left:`${left}px`,top:`${top}px`,width:`${width}px`,height:`${height}px`,'min-height':'0','max-height':'none',margin:'0','box-sizing':'border-box'};
  const previous=Object.keys(properties).map(key=>({key,value:el.style.getPropertyValue(key),priority:el.style.getPropertyPriority(key)}));
  el.parentNode?.insertBefore(placeholder,el);
  for(const [key,value] of Object.entries(properties))el.style.setProperty(key,value);
  pending.set(el,()=>{
   for(const entry of previous){if(entry.value)el.style.setProperty(entry.key,entry.value,entry.priority);else el.style.removeProperty(entry.key);}
   placeholder.remove();
  });
 }
 return {start,finish,dispose(){for(const el of pending.keys())finish(el);}};
}
