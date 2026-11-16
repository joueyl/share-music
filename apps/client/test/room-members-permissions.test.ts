import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { nextTick,reactive } from 'vue';
import { renderer,node,all,text } from './helpers/vue-host';
import RoomMembersDialog from '../src/components/RoomMembersDialog.vue';
const f=vi.hoisted(()=>({app:null as any,target:null as any}));
vi.mock('../src/store',()=>({useApp:()=>f.app}));
vi.mock('../src/useDialogFocus',()=>({useDialogFocus:()=>{}}));
vi.mock('vue',async original=>{const vue=await original<typeof import('vue')>();return {...vue,Teleport:{...vue.Teleport,process(previous:any,current:any,...args:any[]){current.props.to=f.target;return (vue.Teleport.process as any)(previous,current,...args);}}};});
let mounted:ReturnType<typeof renderer.createApp>;
const settle=async()=>{await nextTick();await nextTick();};
beforeEach(()=>{f.app=reactive({host:true,connected:true,room:{hostId:'host',defaults:{skip:true,stream:true,seek:true,enqueue:true,playbackMode:true},members:[{id:'member',name:'成员',online:true,overrides:{skip:false}}]},act:vi.fn().mockResolvedValue(undefined)});});
afterEach(()=>{mounted?.unmount();vi.unstubAllGlobals();vi.useRealTimers();});
async function mount(){const root=node('root');f.target=root;mounted=renderer.createApp(RoomMembersDialog);mounted.mount(root);await settle();all(root).find(n=>n.props.class==='tabs').children.filter((n:any)=>n.type==='button')[1].props.onClick();await settle();return root;}
it('offers a separate mode modification default and per-member allow/deny/follow-room selector',async()=>{
 const root=await mount();const row=all(root).find(n=>n.props.class==='permission-row'&&text(n).includes('播放模式修改'));
 expect(row).toBeDefined();
 all(row).find(n=>n.type==='input').props.onChange({target:{checked:false}});
 expect(f.app.act).toHaveBeenLastCalledWith({type:'defaults',payload:{...f.app.room.defaults,playbackMode:false}});
 const override=all(root).find(n=>n.props.class==='override-row'&&text(n).includes('播放模式修改')),select=all(override).find(n=>n.type==='select');
 expect(all(select).filter(n=>n.type==='option').map(n=>n.props.value)).toEqual(['default','allow','deny']);
 for(const [value,expected] of [['deny',{skip:false,playbackMode:false}],['allow',{skip:false,playbackMode:true}],['default',{skip:false}]] as const){
  select.props.onChange({target:{value}});expect(f.app.act).toHaveBeenLastCalledWith({type:'permission',payload:{memberId:'member',overrides:expected}});
 }
});
it('keeps room permission editing host-only and disabled offline',async()=>{
 const root=await mount();f.app.connected=false;await settle();
 expect(all(root).filter(n=>n.type==='select')).toHaveLength(4);
 expect(all(root).filter(n=>n.type==='select').every(n=>n.props.disabled)).toBe(true);
 f.app.host=false;await settle();expect(all(root).some(n=>n.type==='select')).toBe(false);
 expect(all(root).filter(n=>n.type==='input').every(n=>n.props.disabled)).toBe(true);
});
it.each(['https://share.example.com','http://localhost:5173'])('copies the release download link separately from web joining on %s',async origin=>{
 vi.useFakeTimers();
 const writeText=vi.fn().mockResolvedValue(undefined);
 vi.stubGlobal('navigator',{clipboard:{writeText}});
 vi.stubGlobal('window',{location:{origin}});
 Object.assign(f.app.room,{inviteCode:'123456789012',name:'测试房间',playlist:[],playback:{sourceId:null}});
 const root=await mount();
 await all(root).find(n=>n.type==='button'&&text(n).includes('复制邀请房间')).props.onClick();
 expect(writeText).toHaveBeenCalledWith(`我在【测试房间】听 好听的音乐，来和我一起听歌吧！\n房间邀请码：123456789012\n客户端下载：https://github.com/joueyl/share-music/releases/latest\n网页加入：${origin.includes('localhost')?'https://share.jouei.cn':origin}`);
 expect(f.app.notice).toBe('邀请信息已复制，快去发给好友吧！');
 vi.runAllTimers();
});
