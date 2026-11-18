import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { h, nextTick, reactive } from 'vue';
import { parse } from '@vue/compiler-sfc';
import { renderer, node, all, text } from './helpers/vue-host';
import MobileNavigation from '../src/components/MobileNavigation.vue';

const fixture=vi.hoisted(()=>({app:null as any,route:null as any,push:vi.fn()}));
vi.mock('../src/store',()=>({useApp:()=>fixture.app}));
vi.mock('vue-router',()=>({useRoute:()=>fixture.route,useRouter:()=>({push:fixture.push})}));
let mounted:ReturnType<typeof renderer.createApp>;
beforeEach(()=>{fixture.app=reactive({room:null,notice:''});fixture.route=reactive({path:'/'});fixture.push.mockReset();});
afterEach(()=>mounted?.unmount());
function mount(){const root=node('root');mounted=renderer.createApp(MobileNavigation);mounted.component('router-link',{props:['to'],setup(props,context){return()=>h('a',{href:props.to},context.slots.default?.());}});mounted.mount(root);return root;}
it('offers only the three real destinations and marks the current route',async()=>{
 const root=mount();expect(text(root)).toContain('发现一起听我的音乐');
 expect(all(root).find(n=>n.type==='a'&&n.props.href==='/').props['aria-current']).toBe('page');
 fixture.route.path='/playlists';await nextTick();expect(all(root).find(n=>n.type==='a'&&n.props.href==='/playlists').props['aria-current']).toBe('page');
});
it('does not join a fake room or change routes when there is no active room',()=>{
 const root=mount();all(root).find(n=>n.type==='button').props.onClick();expect(fixture.push).not.toHaveBeenCalled();expect(fixture.app.notice).toContain('请先选择或创建');
});
it('returns to the same room without replacing its player or exiting it',async()=>{
 fixture.app.room={id:'existing'};const root=mount();all(root).find(n=>n.type==='button').props.onClick();expect(fixture.push).toHaveBeenCalledWith('/room/existing');
 fixture.route.path='/room/existing';await nextTick();expect(all(root).find(n=>n.type==='button').props['aria-current']).toBe('page');
});
it('keeps desktop chrome and reserves mobile navigation/player space consistently',()=>{
 const read=(f:string)=>readFileSync(new URL('../src/'+f,import.meta.url),'utf8');
 const nav=read('components/MobileNavigation.vue'),app=read('App.vue'),css=read('adaptive-layout.css');
 expect(nav).toContain('.mobile-navigation{display:none}');expect(nav).toContain('env(safe-area-inset-bottom');
 expect(app.indexOf('<MobileNavigation v-if="app.user" />')).toBeLessThan(app.indexOf('<!-- 播放器独立于 shell'));
 expect(css).toContain('--workspace-player:calc(var(--mobile-tabbar) + var(--mobile-player-height))');
 expect(css).toContain(':root:has(.global-player.mobile-expanded)');
 for(const file of ['App.vue','components/MobileNavigation.vue','components/GlobalPlayer.vue','components/AuthPage.vue','components/MusicSearchDialog.vue','components/QueueDrawer.vue','components/ResponsiveRoomChat.vue','views/Room.vue','views/Lobby.vue','views/Playlists.vue'])expect(parse(read(file)).errors).toEqual([]);
});
