import { expect, it, vi } from 'vitest';
import { createRenderer, nextTick, reactive, ref, h, KeepAlive, defineComponent, onMounted, onUnmounted } from 'vue';
import TrackLyrics from '../src/components/TrackLyrics.vue';
import CachedPlaybackPage from '../src/components/CachedPlaybackPage.vue';
import { useCachedActivity } from '../src/useCachedActivity';

const fixture=vi.hoisted(()=>({app:null as any,lyrics:vi.fn(),qqLyrics:vi.fn(),metadata:vi.fn()}));
vi.mock('../src/store',()=>({useApp:()=>fixture.app}));
vi.mock('../src/bridge',()=>({songLyrics:fixture.lyrics,qqLyrics:fixture.qqLyrics,trackMetadata:fixture.metadata}));

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

it('retains real lyrics and model instances across navigation, pauses hidden activity and evicts on session/room reset',async()=>{
 fixture.app=reactive({connected:true,progress:1200,room:{id:'room',playback:{sourceId:'one'},playlist:[{id:'one',neteaseId:'123'},{id:'two',neteaseId:'456'}]}});
 fixture.lyrics.mockReset().mockResolvedValue({lrc:{lyric:'[00:01]缓存歌词'}});
 const mounted=vi.fn(),unmounted=vi.fn(),resume=vi.fn(),pause=vi.fn();
 const Model=defineComponent({setup(){onMounted(mounted);onUnmounted(unmounted);useCachedActivity(resume,pause);return ()=>h('div','model');}});
 const View=defineComponent({setup:()=>()=>h('section',[h(Model),h(TrackLyrics)])});
 const page=ref('room'),scope=ref('user/room'),authenticated=ref(true);
 const Root=defineComponent({setup:()=>()=>authenticated.value?h(KeepAlive,{key:scope.value,include:'CachedPlaybackPage',max:1},{default:()=>page.value==='room'?h(CachedPlaybackPage,{key:'/room/one',view:View}):h('div','lobby')}):h('div','auth')});
 const app=renderer.createApp(Root);app.mount(node('root'));
 try{
  await settle();expect(mounted).toHaveBeenCalledTimes(1);expect(fixture.lyrics).toHaveBeenCalledTimes(1);
  page.value='lobby';await settle();expect(pause).toHaveBeenCalledTimes(1);expect(unmounted).not.toHaveBeenCalled();
  fixture.app.room.playback.sourceId='two';await settle();expect(fixture.lyrics).toHaveBeenCalledTimes(2);
  page.value='room';await settle();expect(mounted).toHaveBeenCalledTimes(1);expect(fixture.lyrics).toHaveBeenCalledTimes(2);expect(resume).toHaveBeenCalledTimes(2);
  scope.value='user/another-room';await settle();expect(unmounted).toHaveBeenCalledTimes(1);expect(mounted).toHaveBeenCalledTimes(2);
  authenticated.value=false;await settle();expect(unmounted).toHaveBeenCalledTimes(2);
 }finally{app.unmount();}
});

it('loads QQ lyrics by MID without issuing a NetEase lyrics request',async()=>{
 fixture.app=reactive({connected:true,progress:1200,room:{id:'room',playback:{sourceId:'qq'},playlist:[{id:'qq',qqId:'001ABC'}]}});
 fixture.lyrics.mockReset();fixture.qqLyrics.mockReset().mockResolvedValue({lrc:{lyric:'[00:01]QQ歌词'}});
 const root=node('root'),app=renderer.createApp(TrackLyrics);app.mount(root);
 try{await settle();expect(fixture.qqLyrics).toHaveBeenCalledWith('001ABC',expect.any(AbortSignal));expect(fixture.lyrics).not.toHaveBeenCalled();expect(find(root,'span').text).toBe('QQ歌词');}finally{app.unmount();}
});

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

