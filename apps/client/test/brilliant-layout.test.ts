import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '@vue/compiler-sfc';
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
it('keeps all primary routes and overlays on the Brilliant component structure',()=>{
 for(const file of ['App.vue','views/Lobby.vue','views/Room.vue','views/Playlists.vue','components/GlobalPlayer.vue','components/QueueDrawer.vue','components/RoomSettingsDialog.vue','components/RoomMembersDialog.vue','components/MusicSearchDialog.vue','components/UploadedMusicDialog.vue','components/AuthPage.vue'])expect(parse(read('../src/'+file)).errors).toEqual([]);
 const app=read('../src/App.vue');expect(app).toContain('<GlobalPlayer v-if="app.user"');expect(app).toContain('<QueueDrawer');expect(app).toContain('openSearch');
 const room=read('../src/views/Room.vue');expect(room).toContain('class="listening-stage"');expect(room).toContain('class="stage-lyrics"');expect(room).not.toContain('class="player-controls"');
});
it('uses exported original artwork and the reference desktop dimensions, with narrow-screen adaptations',()=>{
 const css=read('../src/brilliant.css');for(const rule of ['height:124px','width:496px','min-height:455px','height:579px','height:265px','max-width:600px'])expect(css).toContain(rule);
 for(const name of ['room-turntable','discovery-record']){const bytes=readFileSync(new URL(`../src/assets/${name}.png`,import.meta.url));expect([...bytes.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);}
 expect(read('../src/main.ts').indexOf("import './brilliant.css'")).toBeGreaterThan(read('../src/main.ts').indexOf("import './responsive.css'"));
});
it('does not turn unavailable history, friend relationships or source audio into simulated product data',()=>{
 expect(read('../src/components/QueueDrawer.vue')).toContain('当前 API 未提供播放历史');
 expect(read('../src/views/Lobby.vue')).toContain('当前服务端暂无好友关系与好友筛选接口');
 expect(read('../src/components/MusicSearchDialog.vue')).toContain('当前 API 未提供热门榜单');
 expect(read('../src/components/GlobalPlayer.vue')).not.toContain('new Audio');
});
it('prioritizes lyrics over the removed now-playing label on desktop and narrow screens',()=>{
 const room=read('../src/views/Room.vue'),css=read('../src/brilliant.css');
 expect(room).not.toContain('N O W P L A Y I N G');
 expect(css).toContain('right:5%;top:82px');expect(css).toContain('.stage-song h2{font-size:28px;line-height:40px;');
 expect(css).toContain('.stage-lyrics .lyric-scroll{height:250px;');
 expect(css).toContain('.stage-song{position:absolute;top:296px;');
 expect(css).toContain('.stage-song h2{font-size:21px;line-height:32px}');
 expect(css).toContain('.stage-lyrics .lyric-scroll{text-align:center;height:164px;');
});
it('moves the room heading and actions to chat and navigation without restoring the breadcrumb',()=>{
 const room=read('../src/views/Room.vue'),css=read('../src/brilliant.css');
 expect(room).not.toContain('LISTENING ROOM /');
 const chat=read('../src/components/RoomChat.vue'),app=read('../src/App.vue'),members=read('../src/components/RoomMembersDialog.vue');
 expect(chat).toContain("{{ app.room?.name || '一起听房间' }}");
 expect(chat).toContain('aria-label="房间成员与邀请"');
 expect(members).toContain('复制邀请房间');
 for(const action of ['title="房间设置"','title="退出房间"','@click.stop="exitCurrentRoom"'])expect(app).toContain(action);
 expect(css).toContain('.tone-room.page{padding-top:0}');
 expect(css).toContain('gap:20px;height:48px;margin-bottom:18px}.room-titlebar h1');
 expect(css).toContain('.tone-room .room-titlebar{height:auto;min-height:48px}');
});
it('keeps the queue mounted until its slide-out finishes and compensates fixed surfaces',()=>{
 const queue=read('../src/components/QueueDrawer.vue'),motion=read('../src/motion.css'),css=read('../src/brilliant.css');
 expect(queue).toContain('<Transition name="drawer" appear @after-leave="afterLeave">');
 expect(queue).toContain('v-if="visible" class="drawer-backdrop"');
 expect(queue).toContain('function close(){releaseSheetPointer();cancelDrag();visible.value=false;}');
 expect(queue).toContain("function afterLeave(){emit('close');if(searchAfterClose)openSearch();}");
 expect(motion).toContain('transform:translateX(100%)');expect(motion).toContain('prefers-reduced-motion:reduce');
 expect(css).toContain('width:calc(100% - var(--modal-scrollbar-gap,0px))');
 expect(css).toContain('.global-player,.modal-backdrop,.drawer-backdrop{right:var(--modal-scrollbar-gap,0px)}');
});
it('does not render any transient status caption inside the stage',()=>{
 const room=read('../src/views/Room.vue');expect(room).not.toContain('HTML Audio · 同步收听');
 expect(room).not.toContain('stage-audio-status');expect(room).not.toContain('音乐准备中');
});

it('pins the search header above scrolling content at every viewport size',()=>{
 const {descriptor}=parse(read('../src/components/MusicSearchDialog.vue'));
 const scoped=descriptor.styles.find(style=>style.scoped)?.content??'';
 const header=scoped.match(/\.global-search-header\{([^}]+)\}/)?.[1]??'';
 expect(header).toContain('position:sticky');expect(header).toContain('top:0');
 expect(header).toContain('z-index:6');expect(header).toContain('flex-shrink:0');
 expect(header).toContain('background:');
 // Do not limit the pinning to desktop or move it out of normal layout flow.
 expect(scoped.indexOf('.global-search-header')).toBeLessThan(scoped.indexOf('@media'));
 expect(header).not.toContain('position:fixed');
});

it('keeps the full-screen search overlay inside the shared window corner boundary',()=>{
 const source=read('../src/components/MusicSearchDialog.vue');
 expect(source).toContain('<Teleport to="#app">');
 expect(source).not.toContain('<Teleport to="body">');
 const {descriptor}=parse(source);const css=descriptor.styles.find(style=>style.scoped)?.content??'';
 expect(css).toContain('.search-backdrop{border-radius:var(--window-corner-radius,20px)');
 expect(css).toContain('@media(prefers-reduced-motion:reduce){.search-backdrop{transition:none}}');
 const tone=read('../src/tone.css');
 expect(tone).toContain('#app{--window-corner-radius:20px');
 expect(tone).toContain('#app.is-maximized{--window-corner-radius:0px');
});

it('preserves search modal motion while isolating transformed overflow and reserving scrollbar space',()=>{
 const source=read('../src/components/MusicSearchDialog.vue'),motion=read('../src/motion.css');
 expect(source).toContain('scrollbar-gutter:stable');expect(source).toContain('backdrop-filter:none;-webkit-backdrop-filter:none');expect(source).toContain("createScrollTransitionLayer('global-search-modal')");
 for(const hook of ['@enter="startTransition"','@leave="startTransition"','@after-enter="finishTransition"','@enter-cancelled="finishTransition"','@after-leave="afterLeave"','@leave-cancelled="finishTransition"'])expect(source).toContain(hook);
 expect(source).toContain('searchTransition.dispose()');expect(source).toContain('focus({preventScroll:true})');
 expect(motion).toContain('transform:translateY(12px) scale(.98);opacity:0');
});
