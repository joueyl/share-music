import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';
import { all, node, renderer, text } from './helpers/vue-host';
import SearchDialog from '../src/components/MusicSearchDialog.vue';
const f=vi.hoisted(()=>({app:null as any,search:vi.fn(),batch:vi.fn(),single:vi.fn(),drag:vi.fn()}));
vi.mock('vue',async()=>{const vue=await vi.importActual<any>('vue');const slot={inheritAttrs:false,props:['to','name','appear'],emits:['afterLeave'],setup:(_:unknown,{slots}:any)=>()=>slots.default?.()};return {...vue,vModelSelect:{},Teleport:slot,Transition:slot};});
vi.mock('../src/store',()=>({useApp:()=>f.app}));
vi.mock('../src/useDialogFocus',()=>({lockModalBackground:()=>()=>{}}));
vi.mock('../src/bridge',()=>({searchMusic:f.search,addSearchedMusicBatch:f.batch,addSearchedMusic:f.single,startDragging:f.drag}));
vi.mock('../src/useMusicSuggestions',async()=>{const {ref}=await import('vue');return {useMusicSuggestions:()=>({items:ref([]),loading:ref(false),active:ref(-1),error:ref(''),loaded:ref(false),dismiss:vi.fn()})};});
let mounted:ReturnType<typeof renderer.createApp>;
const settle=async()=>{for(let i=0;i<8;i++){await Promise.resolve();await nextTick();}};
beforeEach(()=>{
 vi.stubGlobal('Document',class{});vi.stubGlobal('ShadowRoot',class{});
 vi.stubGlobal('document',{activeElement:null,addEventListener:vi.fn(),removeEventListener:vi.fn()});
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:vi.fn()});
 f.drag.mockReset().mockResolvedValue(undefined);
 f.app=reactive({user:{id:'user'},room:{id:'room',members:[],playlist:[]},permission:{enqueue:true},connected:true,notice:'',error:vi.fn()});
 f.search.mockReset().mockResolvedValue({songs:[{id:'1',name:'song 1',artists:'a',album:'album',durationMs:120000},{id:'2',name:'song 2',artists:'a',album:'album',durationMs:120000}],total:2});
 f.batch.mockReset().mockImplementation(async(_room:string,items:any[])=>items.map(item=>({...item,ok:true,track:{id:item.songId}})));f.single.mockReset();
});
afterEach(()=>{mounted?.unmount();vi.unstubAllGlobals();});
async function mount(provider='netease'){
 const root=node('root');mounted=renderer.createApp(SearchDialog,{roomId:'room'});mounted.mount(root);
 for(const item of all(root))item.focus=vi.fn();await settle();
 if(provider==='qq'){all(root).find(item=>item.type==='select').props['onUpdate:modelValue']('qq');await settle();}
 all(root).find(item=>item.props.id==='music-keywords').props.onInput({target:{value:'test'}});
 await all(root).find(item=>item.type==='form').props.onSubmit({preventDefault(){}});await settle();return root;
}
it.each(['netease','qq'])('search add-all uses one %s project batch and retains failed request IDs for retry',async(provider)=>{
 const root=await mount(provider);
 f.batch.mockImplementationOnce(async(_room:string,items:any[])=>items.map(item=>item.songId==='2'?{...item,ok:false,error:'MUSIC_NOT_AVAILABLE'}:{...item,ok:true,track:{id:item.songId}}));
 const add=()=>all(root).find(item=>item.type==='button'&&text(item)==='添加全部');
 await add().props.onClick();await settle();
 expect(f.single).not.toHaveBeenCalled();expect(f.batch).toHaveBeenCalledOnce();expect(f.batch.mock.calls[0][2]).toBe(provider);expect(f.batch.mock.calls[0][1]).toHaveLength(2);expect(text(root)).toContain('已加入 1 首，失败 1 首');
 const failed=f.batch.mock.calls[0][1][1];await add().props.onClick();await settle();expect(f.batch.mock.calls[1][1]).toEqual([failed]);
});
it('ignores a batch response after changing accounts',async()=>{
 const root=await mount();let finish!:(value:any)=>void;f.batch.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));
 const work=all(root).find(item=>item.type==='button'&&text(item)==='添加全部').props.onClick();await settle();
 f.app.user={id:'other'};finish(f.batch.mock.calls[0][1].map((item:any)=>({...item,ok:true,track:{id:item.songId}})));await work;await settle();
 expect(text(root)).not.toContain('已加入 2 首');expect(f.app.notice).toBe('');
});

// Exercise the real v-model directive: the custom host records native listeners.
it.each(['netease','qq'])('preserves %s IME drafts across reactive rerenders and searches only committed text',async(provider)=>{
 const root=await mount(provider);
 const input=all(root).find(item=>item.props.id==='music-keywords');
 const send=(type:string,event:any={})=>{
  const e={target:input,...event};
  const handler=input.props['on'+type[0].toUpperCase()+type.slice(1)];
  if(handler)handler(e);
  for(const [name,listener] of input.addEventListener.mock.calls)if(name===type)listener(e);
 };
 input.dispatchEvent=(event:Event)=>{send(event.type);return true;};
 for(const committed of ['', '已有关键词']){
  input.value=committed;send('input');await settle();
  send('compositionstart');input.value=committed+'qing';send('input',{isComposing:true});
  // Focus/composition flags and room snapshots can all refresh the component.
  f.app.room.name='房间更新'+committed;await settle();
  expect(input.props.value??input.value).toBe(committed+'qing');
  const count=f.search.mock.calls.length;
  await all(root).find(item=>item.type==='form').props.onSubmit({preventDefault(){}});
  expect(f.search).toHaveBeenCalledTimes(count);
  input.value=committed+'晴天';send('compositionend');await settle();
  expect(input.props.value??input.value).toBe(committed+'晴天');
  await all(root).find(item=>item.type==='form').props.onSubmit({preventDefault(){}});await settle();
  expect(f.search.mock.calls.at(-1)?.[0]).toBe(committed+'晴天');
 }
});

it('drags the native window from header content but not controls, secondary clicks or double clicks',async()=>{
 const root=await mount();const header=all(root).find(item=>item.props.class==='global-search-header');
 const closest=vi.fn(()=>null),event={button:0,detail:1,target:{closest},preventDefault:vi.fn(),stopPropagation:vi.fn()};
 header.props.onMousedown(event);await settle();expect(f.drag).toHaveBeenCalledOnce();
 f.drag.mockClear();
 // closest also protects nested SVG icons inside the close button.
 closest.mockReturnValue({} as any);header.props.onMousedown(event);
 closest.mockReturnValue(null);header.props.onMousedown({...event,button:2});
 header.props.onMousedown({...event,detail:2});
 expect(f.drag).not.toHaveBeenCalled();expect(event.preventDefault).toHaveBeenCalled();expect(event.stopPropagation).toHaveBeenCalled();
 const double={stopPropagation:vi.fn(),preventDefault:vi.fn()};header.props.onDblclick(double);
 expect(double.stopPropagation).toHaveBeenCalled();expect(double.preventDefault).toHaveBeenCalled();
 f.drag.mockRejectedValueOnce(Error('DRAG_FAILED'));header.props.onMousedown(event);await settle();
 expect(f.app.error).toHaveBeenCalledWith(expect.objectContaining({message:'DRAG_FAILED'}));
});
