import type { WebGLRendererParameters } from 'three';

// WebView2 can pause animation callbacks during native window moves. Keep the
// last composed image available instead of exposing a discarded alpha buffer.
export const STAGE_RENDERER_OPTIONS: WebGLRendererParameters = {
 antialias:true,alpha:true,powerPreference:'high-performance',preserveDrawingBuffer:true,
};

/** Match native physical pixels; scale down only if GPU dimensions require it. */
export function stagePixelRatio(width:number,height:number,dpr:number,maxSize=4096){
 if(width<=0||height<=0)return 1;
 return Math.min(Number.isFinite(dpr)&&dpr>0?dpr:1,maxSize/width,maxSize/height);
}

/** Resize only immediately before rendering, never from an observer callback. */
export function createStageViewport(
 renderer:{setDrawingBufferSize:(width:number,height:number,pixelRatio:number)=>void;capabilities?:{maxTextureSize:number};getContext?:()=>{MAX_RENDERBUFFER_SIZE:number;getParameter:(key:number)=>number}},
 container:HTMLElement,
 reframe:(width:number,height:number)=>void,
){
 let dirty=true,disposed=false,width=0,height=0,ratio=0,lastDpr=0;
 const gl=renderer.getContext?.();
 const maxSize=Math.min(renderer.capabilities?.maxTextureSize??4096,gl?gl.getParameter(gl.MAX_RENDERBUFFER_SIZE):Infinity);
 const observer=new ResizeObserver(()=>{dirty=true;});observer.observe(container);
 return {
  sync(){
   if(disposed)return;
   const dpr=window.devicePixelRatio||1;
   if(!dirty&&lastDpr===dpr)return;
   dirty=false;
   const w=container.clientWidth,h=container.clientHeight;
   // A hidden or minimized stage must not clear the last usable frame.
   if(w<=0||h<=0)return;
   const nextRatio=stagePixelRatio(w,h,dpr,maxSize);
   lastDpr=dpr;
   if(width===w&&height===h&&ratio===nextRatio)return;
   width=w;height=h;ratio=nextRatio;
   renderer.setDrawingBufferSize(w,h,nextRatio);
   reframe(w,h);
  },
  dispose(){disposed=true;observer.disconnect();},
 };
}
