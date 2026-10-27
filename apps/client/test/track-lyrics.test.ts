import { expect, it, vi } from 'vitest';
import { createRenderer, nextTick, reactive } from 'vue';
import TrackLyrics from '../src/components/TrackLyrics.vue';

const fixture=vi.hoisted(()=>({app:null as any,lyrics:vi.fn(),metadata:vi.fn()}));
vi.mock('../src/store',()=>({useApp:()=>fixture.app}));
vi.mock('../src/bridge',()=>({songLyrics:fixture.lyrics,trackMetadata:fixture.metadata}));

// A minimal host exercises the real component's watches and rendered text without a browser.
function node(type:string,text=''):any {
 return {type,text,props:{},children:[],parent:null,offsetTop:100,clientHeight:40,
  scrollTo:vi.fn(),querySelector(){return this.children.find((n:any)=>n.props.class?.includes('active'));}};
}
const renderer=createRenderer<any,any>({
 createElement:tag=>node(tag),createText:text=>node('text',text),createComment:text=>node('comment',text),
 setText:(n,text)=>{n.text=text;},setElementText:(n,text)=>{n.text=text;n.children=[];},
 patchProp:(n,key,_,value)=>{n.props[key]=value;},parentNode:n=>n.parent,
 nextSibling:n=>n.parent?.children[n.parent.children.indexOf(n)+1]??null,
 insert(n,parent,anchor){if(n.parent)n.parent.children.splice(n.parent.children.indexOf(n),1);n.parent=parent;const index=parent.children.indexOf(anchor);parent.children.splice(index<0?parent.children.length:index,0,n);},
 remove(n){if(n.parent)n.parent.children.splice(n.parent.children.indexOf(n),1);},
});
const settle=async()=>{for(let i=0;i<6;i++){await Promise.resolve();await nextTick();}};
const find=(n:any,type:string):any=>n.type===type?n:n.children.map((child:any)=>find(child,type)).find(Boolean);

it('keeps loaded lyrics across same-song snapshots and line gaps, but reloads on song changes',async()=>{
 fixture.app=reactive({connected:true,progress:1200,room:{id:'room',playback:{sourceId:'one'},playlist:[{id:'one',neteaseId:'123'},{id:'two',neteaseId:'456'}]}});
 fixture.lyrics.mockReset().mockResolvedValue({yrc:{lyric:'[1000,1000](1000,1000,0)你好\n[4000,1000](4000,1000,0)世界'}});
 const root=node('root'),app=renderer.createApp(TrackLyrics);app.mount(root);
 try{
  await settle();const scroll=find(root,'div'),rows=()=>scroll.children.filter((n:any)=>n.type==='p');expect(rows()).toHaveLength(2);
  for(const time of [2000,3500,3999]){
   fixture.app.progress=time;
   fixture.app.room=JSON.parse(JSON.stringify(fixture.app.room));
   await settle();
   expect(find(root,'div')).toBe(scroll);
   expect(rows()[0].props.class).toContain('active');
   expect(find(rows()[0],'span').text).toBe('你好');
   expect(find(rows()[0],'span').props.style['--fill']).toBe('100%');
   expect(fixture.lyrics).toHaveBeenCalledTimes(1);
  }
  fixture.app.progress=4000;await settle();expect(rows()[1].props.class).toContain('active');
  expect(scroll.scrollTo).toHaveBeenLastCalledWith({top:100,behavior:'smooth'});
  fixture.app.progress=1200;await settle();expect(rows()[0].props.class).toContain('active');
  fixture.app.room.playback.sourceId='two';await settle();expect(fixture.lyrics).toHaveBeenCalledTimes(2);
  expect(fixture.lyrics).toHaveBeenLastCalledWith('456',expect.any(AbortSignal));
 }finally{app.unmount();}
});

