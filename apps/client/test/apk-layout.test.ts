import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import { parse } from '@vue/compiler-sfc';
const read=(p:string)=>readFileSync(new URL('../src/'+p,import.meta.url),'utf8');
it('keeps APK templates independent, responsive and free of desktop chrome',()=>{
 for(const file of ['apk/ApkApp.vue','apk/pages/LoginPage.vue','apk/pages/DiscoverPage.vue','apk/pages/MusicPage.vue','apk/pages/ListenPage.vue','apk/components/ApkPlayer.vue','apk/components/ApkRoomPreferences.vue','apk/components/ApkVinylArtwork.vue','apk/components/ApkNavigation.vue']){
  const source=read(file);expect(parse(source).errors).toEqual([]);expect(source).not.toMatch(/import.*(?:App\.vue|\/views\/|GlobalPlayer\.vue|AuthPage\.vue)/);
 }
 const css=read('apk/apk.css');expect(css).toContain('100dvh');expect(css).toContain('env(safe-area-inset-bottom');expect(css).toContain('@media(min-width:760px) and (min-height:600px)');expect(css).toContain('grid-template-columns:repeat(2,minmax(0,1fr))');expect(css).not.toMatch(/overflow-x:\s*hidden|transform:\s*scale\(/);
 const app=read('apk/ApkApp.vue');expect(app.indexOf('<ApkNavigation />')).toBeLessThan(app.indexOf('<ApkPlayer v-if'));expect(app).toContain(':key="app.user.id" :include="cachedNames" :max="2"');expect(app).not.toContain('appUpdates');
});
it('keeps immersive Android controls on the existing footer with shared layout clearance',()=>{
 const app=read('apk/ApkApp.vue'),room=read('apk/pages/ListenPage.vue'),player=read('apk/components/ApkPlayer.vue'),css=read('apk/apk.css');
 expect(app.match(/<ApkPlayer\b/g)).toHaveLength(1);
 expect(player.match(/usePlayerControls\(\)/g)).toHaveLength(1);
 expect(player).toContain('class="apk-room-controls"');
 expect(room).toContain('<ApkVinylArtwork');
 expect(room).toContain('<TrackLyrics class="apk-lyrics" :visible="showLyrics"');
 expect(room.match(/<RoomChat\b/g)).toHaveLength(1);
 expect(css).toMatch(/:has\(\.apk-room-player\)\{--apk-room-nav-gap:8px;--apk-player:min\(calc\(var\(--apk-room-control-limit,236px\) \+ var\(--apk-room-nav-gap\)\)/);
 expect(css).toMatch(/\.apk-room-controls\{[^}]*calc\(4px \+ var\(--apk-room-nav-gap,0px\)\)/);
 expect(css).toContain('bottom:calc(var(--workspace-player) + 8px)');
 expect(css).toContain('grid-template:"song timeline"');
});
it('uses the Brilliant APK discovery order with independently scrolling room cards',()=>{
 const {descriptor}=parse(read('apk/pages/DiscoverPage.vue'));
 const markup=descriptor.template!.content, css=descriptor.styles.find(style=>style.scoped)!.content;
 const order=['apk-discover-actions','apk-room-search','apk-categories','apk-section-heading','apk-room-list'].map(name=>markup.indexOf(name));
 expect(order.every((position,index)=>position>=0&&(!index||position>order[index-1]!))).toBe(true);
 expect(markup).not.toMatch(/找到你的同频|apk-hero/);
 expect(markup.match(/<Search\b/g)).toHaveLength(1);
 expect(markup).toContain('type="button" class="apk-card apk-room-card"');
 expect(css).toContain('--discover-gap:16px;--room-list-gap:12px;--room-card-min:94px');
 expect(css).toContain('.apk-room-list{flex:1 1 0;min-height:var(--room-card-min);overflow:auto');
 expect(css).toContain('grid-template:"actions heading" auto "search rooms"');
});
it('keeps the APK room artwork at the top without a recommendations panel',()=>{
 const room=read('apk/pages/ListenPage.vue'),css=read('apk/apk.css');
 expect(room).not.toContain('SimilarRecommendations');
 expect(css).not.toContain('.next-track-grid');
 expect(room.indexOf('<ApkVinylArtwork')).toBeLessThan(room.indexOf('class="apk-room-presence"'));
 expect(css).toMatch(/\.apk-room-artwork\{[^}]*container-type:size;display:grid;place-items:start center/);
 expect(css).toContain('width:min(100%,var(--apk-vinyl-max,342px),88.6cqh)');
 expect(css).toMatch(/\.apk-room-lyrics\{[^}]*overflow:auto/);
});
it('fills the APK vinyl center with a circular cover and no caption',()=>{
 const {descriptor}=parse(read('apk/components/ApkVinylArtwork.vue'));
 expect(descriptor.template!.content).toMatch(/class="vinyl-label">\s*<AlbumArt :src="cover" alt="" \/>\s*<\/div>/);
 const css=descriptor.styles.find(style=>style.scoped)!.content;
 expect(css).toMatch(/\.vinyl-label\{[^}]*border-radius:50%;overflow:hidden/);
 expect(css).toContain('width:100%;height:100%;object-fit:cover');
});
it('swings the APK vinyl tonearm over the disc only in the room playing state',()=>{
 const room=read('apk/pages/ListenPage.vue'),artwork=read('apk/components/ApkVinylArtwork.vue');
 expect(room).toContain("const playing=computed(()=>app.room?.playback.playState==='playing');");
 expect(room).toMatch(/<ApkVinylArtwork[^>]*:playing="playing"/);
 expect(artwork).toContain(`:class="{'is-playing':playing}"`);
 expect(artwork).toContain('transform-origin:170px 16px;transform:rotate(0deg)');
 expect(artwork).toContain('.vinyl-tonearm.is-playing{transform:rotate(14deg)}');
 expect(artwork).toContain('.vinyl-tonearm{transition:transform calc(var(--motion-normal) * 2)');
 expect(artwork).toContain('.vinyl-tonearm.is-playing{transition-duration:calc(var(--motion-normal) * 3)}');
});
it('spins the active playing vinyl and fades between the artwork and centered lyrics',()=>{
 const room=read('apk/pages/ListenPage.vue'),artwork=read('apk/components/ApkVinylArtwork.vue'),css=read('apk/apk.css');
 expect(room).toContain(':playing="playing" :active="active"');
 expect(room).toContain('@click="switchVinylLyrics(true)"');
 expect(room).toContain('void switchVinylLyrics(false);');
 expect(room).not.toContain('apk-vinyl-return');
 expect(room).toMatch(/class="apk-room-lyrics"[^>]*@click="returnFromLyrics"/);
 expect(room).toContain('if(!vinylMode.value||!lyrics.value||event.defaultPrevented)return;');
 expect(room).toContain('selection&&!selection.isCollapsed');
 expect(room).toContain(`:name="vinylMode?'apk-vinyl-reveal':'apk-stage-fade'"`);
 expect(room).toContain('<Transition name="apk-stage-fade">');
 expect(artwork).toContain("'is-spinning':playing&&active");
 expect(artwork).toMatch(/@media\(prefers-reduced-motion:no-preference\)\{\s*\.vinyl-disc\{animation:apk-vinyl-spin/);
 expect(css).toContain('.apk-vinyl-reveal-leave-to{opacity:0}');
 expect(css).toContain('.apk-vinyl-reveal-enter-from{opacity:0;transform:translateY(8px)}');
 expect(css).toMatch(/\.apk-lyrics \.lyric-line\{[^}]*text-align:center/);
 expect(css).toContain('.apk-lyrics.is-playing .lyric-line.active{animation:apk-lyric-glow');
 expect(css).toContain('var(--accent) var(--fill)');
});
it('keeps Android room connection feedback in the header or fixed toast, not the workspace',()=>{
 const app=read('apk/ApkApp.vue'),css=read('apk/apk.css');
 expect(app).toContain('<small role="status" :data-state="roomStatus">');
 expect(app).toMatch(/<main class="apk-workspace">\s*<template v-if="!inRoom">[^]*?已断开[^]*?正在同步操作…[^]*?<\/template>\s*<router-view/);
 expect(app).toContain(":class=\"{'apk-room-toast':inRoom}\"");
 expect(css).toContain('.apk-toast{position:fixed;');
 expect(css).toContain('.apk-room-toast{top:calc(var(--apk-header) + 4px)');
});
it('opens Android shared queue from the viewport bottom without focusing the covered toggle',()=>{
 const css=read('apk/apk.css'),player=read('apk/components/ApkPlayer.vue');
 expect(css).toContain('html[data-client=apk] .drawer-backdrop{position:fixed;inset:0;');
 expect(css).not.toContain('inset:0 0 var(--workspace-player);z-index:60');
 expect(css).toMatch(/@media\(prefers-reduced-motion:no-preference\)\{\s*html\[data-client=apk\] \.drawer-enter-from>\.queue-drawer,html\[data-client=apk\] \.drawer-leave-to>\.queue-drawer\{transform:translateY\(100%\)\}/);
 expect(player.match(/class="icon-button queue-trigger" :inert="modalDepth>0"/g)).toHaveLength(2);
 expect(read('apk/ApkApp.vue')).toContain(':open="ui.queue" swipe-dismiss');
 expect(css).toContain(':is(.queue-sheet-grip,.drawer-heading){touch-action:none;');
});
it('opts APK settings and member dialogs into enter and leave transitions without early unmount',()=>{
 const css=read('apk/apk.css'),app=read('apk/ApkApp.vue');
 expect(app).toMatch(/<RoomSettingsDialog[^>]+animate-dismiss/);
 expect(app).toMatch(/<RoomMembersDialog[^>]+animate-dismiss/);
 expect(read('apk/pages/DiscoverPage.vue')).not.toContain('animate-dismiss');
 for(const file of ['apk/components/ApkRoomPreferences.vue','components/RoomSettingsDialog.vue','components/RoomMembersDialog.vue']){
  const dialog=read(file);
  expect(dialog).toMatch(/<Transition name="apk-room-dialog"[^>]+@after-leave="finishDismiss"/);
  expect(dialog).toContain('v-show="dialogVisible"');
  expect(dialog).toContain(':inert="!dialogVisible"');
  expect(dialog).toMatch(/useDialogFocus\(dialog,\s*(dismiss|close)\)/);
 }
 expect(css).toMatch(/@media\(prefers-reduced-motion:no-preference\)\{\s*html\[data-client=apk\] \.modal-backdrop:is\(\.apk-room-dialog-enter-active,\.apk-room-dialog-leave-active\)/);
 expect(css).toContain('.apk-room-dialog-enter-from,.apk-room-dialog-leave-to{opacity:0}');
 expect(css).toContain('.apk-room-dialog-leave-to>.tone-dialog{transform:translateY(12px)}');
});
it('animates APK search in and out using the existing search transition lifecycle',()=>{
 const css=read('apk/apk.css'),search=read('components/MusicSearchDialog.vue');
 expect(css).toContain('.search-backdrop:is(.modal-enter-active,.modal-leave-active){transition:opacity var(--motion-normal)');
 expect(css).toContain('.search-backdrop:is(.modal-enter-from,.modal-leave-to)>.global-search-modal{transform:translateY(20px);opacity:1}');
 expect(css).toContain('.search-backdrop.modal-leave-active>.global-search-modal{pointer-events:none}');
 expect(css).toContain('.search-backdrop:is(.modal-enter-from,.modal-leave-to)>.global-search-modal{transform:none;opacity:1}');
 expect(search).toContain('<Transition name="modal" appear');
 expect(search).toContain('@after-leave="afterLeave"');
});
it('draws one focus border per APK text field without hiding button focus',()=>{
 const css=read('apk/apk.css');
 expect(css).toContain('button:focus-visible,a:focus-visible');
 expect(css).toContain('.music-search-controls:has(:is(input,select):focus){border-color:var(--accent);outline:2px solid var(--accent);outline-offset:-2px;box-shadow:none}');
 expect(css).toContain('.music-search-controls :is(input,select):focus{border:0;outline:none;box-shadow:none}');
 expect(css).toContain('textarea,select):focus{border-color:var(--accent);outline:2px solid var(--accent);outline-offset:-2px;box-shadow:none}');
 expect(css).not.toContain('.apk-input:focus-within{outline:');
});
it('combines the APK search source menu and query into one bar without changing desktop select',()=>{
 const css=read('apk/apk.css'),search=read('components/MusicSearchDialog.vue');
 expect(search).toMatch(/class="music-search-controls">\s*<div v-if="apkSourceMenu"[^]*?<form class="music-search-form global-search-form"/);
 expect(search.match(/<select v-model="source"/g)).toHaveLength(1);
 expect(read('apk/ApkApp.vue')).toMatch(/<MusicSearchDialog[^>]+apk-source-menu/);
 expect(search).toContain('.music-search-controls{display:contents}');
 expect(css).toContain('.music-search-controls{position:relative;display:flex');
 expect(css).toContain('.apk-search-source-trigger{width:clamp(86px,24vw,102px);min-height:44px');
 expect(css).toContain('.music-search-controls .music-autocomplete{position:static}');
 expect(css).toMatch(/\.music-source-picker::after\{[^}]*width:1px;height:22px/);
});
it('gives APK search controls spacing and reuses the common button styles',()=>{
 const css=read('apk/apk.css');
 expect(css).toContain('.global-search-header{min-height:calc(52px + env(safe-area-inset-top,0px))');
 expect(css).toMatch(/\.music-search-controls\{[^}]*min-height:48px/);
 expect(css).toContain('.music-search-controls .global-search-form .primary{flex:0 0 auto;min-width:44px;min-height:44px');
 expect(css).toMatch(/\.global-search-modal \.search-song-row\{[^}]*grid-template-columns:30px minmax\(0,1fr\) 44px;[^}]*min-height:52px/);
 expect(css).toContain('.secondary,.global-search-modal .search-result-card>header>button{background:#ffffffc9');
 expect(css).toContain('.music-search-pagination .text-button{min-width:44px}');
});
it('makes phone-width APK geometry compact while preserving touch targets and player clearance',()=>{
 const css=read('apk/apk.css');
 const compact=css.split('@media(max-width:599px){')[1]?.split('@media(max-width:279px)')[0];
 expect(compact).toBeDefined();
 expect(compact).toContain('--apk-header:calc(48px + env(safe-area-inset-top,0px))');
 expect(compact).toContain('--apk-tabs:calc(48px + env(safe-area-inset-bottom,0px))');
 expect(compact).toContain('--apk-mini-player-height:48px');
 expect(compact).toContain('--apk-field-min:44px');
 expect(compact).toContain('--apk-room-play-size:48px');
 expect(compact).toContain('--apk-vinyl-max:246px');
 expect(compact).toContain('.queue-drawer .queue-row{min-height:48px');
 expect(css).toContain('width:min(100%,480px)');
 expect(css).toContain('height:min(540px,68dvh');
 expect(css).toContain('.queue-drawer .queue-scroll{min-height:80px;flex-shrink:0}');
 expect(compact).toContain('.apk-navigation>a,.apk-navigation>button{min-height:44px');
 expect(css).toContain('--workspace-player:calc(var(--apk-tabs) + var(--apk-player))');
 expect(css).not.toContain('apk-player-expanded');
 expect(css).toMatch(/\.apk-mini-player\{[^}]*grid-template-columns:minmax\(0,1fr\) repeat\(2,44px\)/);
 expect(css).toMatch(/\.icon-button,\.round-close\{width:44px;height:44px;min-width:44px;min-height:44px/);
 expect(compact).not.toMatch(/zoom:|transform:\s*scale\(|\.icon-button\s*\{/);
});
