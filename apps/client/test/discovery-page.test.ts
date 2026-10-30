import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';
import { all, node, renderer, text } from './helpers/vue-host';
import Lobby from '../src/views/Lobby.vue';
const fixture=vi.hoisted(()=>({app:null as any,rooms:[] as any[],join:vi.fn(),push:vi.fn()}));
vi.mock('../src/store',()=>({useApp:()=>fixture.app}));
vi.mock('vue-router',()=>({useRouter:()=>({push:fixture.push})}));
vi.mock('../src/bridge',()=>({listRooms:async()=>fixture.rooms,join:fixture.join}));
vi.mock('../src/components/RoomSettingsDialog.vue',()=>({default:{render:()=>null}}));
vi.mock('vue',async original=>{
 const vue=await original<typeof import('vue')>();
 return {...vue,TransitionGroup:{setup(_:unknown,{slots}:{slots:any}){return()=>vue.h('div',slots.default?.());}}};
});
let mounted:ReturnType<typeof renderer.createApp>;
const settle=async()=>{for(let i=0;i<5;i++){await Promise.resolve();await nextTick();}};
const cards=(root:any)=>all(root).filter(n=>n.props.class==='discovery-card');
beforeEach(()=>{
 vi.useFakeTimers();fixture.join.mockReset().mockResolvedValue(undefined);fixture.push.mockReset().mockResolvedValue(undefined);
 fixture.app=reactive({connected:true,error:vi.fn()});
 fixture.rooms=[{id:'one',name:'今晚的爵士电台',members:1,maxMembers:8,settings:{atmosphere:'sunset',description:'一起听歌'}},{id:'full',name:'已满的房间',members:8,maxMembers:8}];
});
afterEach(()=>{mounted?.unmount();vi.useRealTimers();});
async function mount(){const root=node('root');mounted=renderer.createApp(Lobby);mounted.mount(root);await settle();return root;}
it('uses the whole card as a keyboard-accessible native button without a nested join button or mood label',async()=>{
 const root=await mount(),card=cards(root)[0];
 expect(card.type).toBe('button');expect(card.props.type).toBe('button');
 expect(card.props['aria-label']).toContain('今晚的爵士电台');
 expect(all(card).filter(n=>n.type==='button')).toHaveLength(1);
 expect(text(card)).not.toContain('日落山谷');expect(text(card)).not.toContain('加入一起听');
 await card.props.onClick();await settle();
 expect(fixture.join).toHaveBeenCalledWith('one');expect(fixture.push).toHaveBeenCalledWith('/room/one');
});
it('prevents joining full rooms, disconnected rooms and duplicate clicks while a join is pending',async()=>{
 const root=await mount();expect(cards(root)[1].props.disabled).toBe(true);
 await cards(root)[1].props.onClick();expect(fixture.join).not.toHaveBeenCalled();
 fixture.app.connected=false;await settle();expect(cards(root)[0].props.disabled).toBe(true);
 await cards(root)[0].props.onClick();expect(fixture.join).not.toHaveBeenCalled();
 fixture.app.connected=true;let finish!:()=>void;fixture.join.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
 const pending=cards(root)[0].props.onClick();await settle();
 expect(cards(root)[0].props['aria-busy']).toBe(true);expect(cards(root)[1].props.disabled).toBe(true);
 await cards(root)[0].props.onClick();expect(fixture.join).toHaveBeenCalledOnce();
 finish();await pending;
});
it('restores the card after a failed join and reports the actual error',async()=>{
 const root=await mount();fixture.join.mockRejectedValueOnce(Error('ROOM_FULL'));
 await cards(root)[0].props.onClick();await settle();
 expect(fixture.app.error).toHaveBeenCalledWith(expect.any(Error));expect(fixture.push).not.toHaveBeenCalled();
 expect(cards(root)[0].props.disabled).toBe(false);
});
