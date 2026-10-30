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
it('removes the listening-room breadcrumb and lifts the whole room body without removing actions',()=>{
 const room=read('../src/views/Room.vue'),css=read('../src/brilliant.css');
 expect(room).not.toContain('LISTENING ROOM /');
 expect(room).toContain('<h1>{{ app.room.name }}</h1>');
 for(const action of ['邀请好友','aria-label="房间设置"','aria-label="离开房间"'])expect(room).toContain(action);
 expect(css).toContain('.tone-room.page{padding-top:0}');
 expect(css).toContain('gap:20px;height:48px;margin-bottom:18px}.room-titlebar h1');
 expect(css).toContain('.tone-room .room-titlebar{height:auto;min-height:48px}');
});
it('keeps the queue mounted until its slide-out finishes and compensates fixed surfaces',()=>{
 const queue=read('../src/components/QueueDrawer.vue'),motion=read('../src/motion.css'),css=read('../src/brilliant.css');
 expect(queue).toContain('<Transition name="drawer" appear @after-leave="afterLeave">');
 expect(queue).toContain('v-if="visible" class="drawer-backdrop"');
 expect(queue).toContain('function close(){cancelDrag();visible.value=false;}');
 expect(queue).toContain("function afterLeave(){emit('close');if(searchAfterClose)openSearch();}");
 expect(motion).toContain('transform:translateX(100%)');expect(motion).toContain('prefers-reduced-motion:reduce');
 expect(css).toContain('width:calc(100% - var(--modal-scrollbar-gap,0px))');
 expect(css).toContain('.global-player,.modal-backdrop,.drawer-backdrop{right:var(--modal-scrollbar-gap,0px)}');
});
it('omits the playback technology caption without suppressing loading and failure feedback',()=>{
 const room=read('../src/views/Room.vue');expect(room).not.toContain('HTML Audio · 同步收听');
 expect(room).toContain('v-if="app.room.pending || app.media.status !== \'playing\'"');
 expect(room).toContain("app.room.pending?'正在准备同步…':app.media.detail");
});
