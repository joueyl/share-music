import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '@vue/compiler-sfc';
const read=(file:string)=>readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
const styles=(file:string)=>parse(read(file)).descriptor.styles.map(s=>s.content.replace(/\r\n/g,'\n')).join('\n');
it('allocates stage content in normal grid flow instead of overlapping fixed minimum widths',()=>{
 const css=styles('views/Room.vue');
 expect(css).toContain('grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr)');
 expect(css).not.toContain('@container room-stage');
 expect(css).not.toContain('grid-template-rows: auto minmax(120px, .8fr) minmax(140px, 1fr) auto');
 expect(css).toMatch(/\.stage-song\s*\{[^}]*grid-column: 2;[^}]*grid-row: 2;/s);
 expect(css).not.toMatch(/min-height:\s*580px|min-width:\s*260px|margin-right:\s*220px/);
 expect(css).toContain('.stage-top-presence {\n  position: relative');
 expect(css).not.toContain('stage-audio-status');
});
it('keeps narrow and short rooms scrollable with space for the fixed transport and chat input',()=>{
 const app=styles('App.vue'),room=styles('views/Room.vue');
 expect(app).toMatch(/\.shell\.in-room-shell \.main\s*\{[^}]*overflow-y: auto/s);
 expect(app).toContain('(max-height: 639px)');
 expect(app).toContain('padding-bottom: calc(132px + env(safe-area-inset-bottom, 0px))');
 expect(app).toContain('padding-top: 52px; padding-bottom: calc(132px + env(safe-area-inset-bottom, 0px))');
 expect(app).toContain('.shell.in-room-shell .in-room-page { height: 100%; min-height: 360px; }');
 expect(room).not.toContain('height: clamp(500px, calc(100dvh - 184px), 640px)');
 expect(room).toContain('height: 400px; min-height: 320px');
});
it('keeps the desktop room panels translucent and removes their outer borders',()=>{
 const room=read('views/Room.vue'),css=styles('views/Room.vue');
 expect(room).toContain("'desktop-room-panels': bridge.desktop");
 expect(css).toMatch(/\.desktop-room-panels \.listening-layout > :deep\(\.room-chat\)\s*\{\s*border: 0;/);
 expect(css).toMatch(/\.desktop-room-panels \.listening-stage\s*\{\s*background-color: rgb\(255 255 255 \/ 28%\);\s*border: 0;/);
 expect(css).toMatch(/\.desktop-room-panels \.listening-layout > :deep\(\.room-chat:not\(\.floating-room-chat\)\)\s*\{\s*background-color: rgb\(255 255 255 \/ 40%\);/);
});
it('keeps unhighlighted lyric text and unreached word fill white without adding shadows',()=>{
 const css=styles('views/Room.vue');
 expect(css).toMatch(/\.desktop-room-panels \.stage-lyrics :deep\(\.lyric-line:not\(\.active\)\)\s*\{\s*color: #fff;\s*\}/);
 expect(css).toMatch(/\.desktop-room-panels \.lumiere-stage-lyrics :deep\(\.gw-word:not\(\.is-active\) \.gw-body\)\s*\{\s*color: #fff;\s*\}/);
 expect(css).toMatch(/\.desktop-room-panels \.stage-lyrics :deep\(\.lyric-line\.active \.lyric-word\)\s*\{\s*background-image: linear-gradient\(to right, var\(--accent\) var\(--fill\), #fff var\(--fill\)\);\s*\}/);
 expect(css).not.toMatch(/\.desktop-room-panels[^{}]*:deep\(\.(?:lyric-line\.active\)|gw-word\.is-active)/);
});
it('wraps long untimed lyrics, bounds word spacing, and scrolls long lines without scaling the page',()=>{
 const css=styles('components/TrackLyrics.vue'),template=read('components/TrackLyrics.vue');
 expect(css).toMatch(/\.lumiere-stage\s*\{[^}]*overflow: hidden/s);
 expect(css).toContain('align-items: safe center');
 expect(css).toContain('max-width: calc(100% - 1em)');
 expect(css).toContain('overflow-wrap: anywhere');
 expect(template).toContain(":margin=\"`min(${lineMargins[current]?.[j] ?? '0px'}, 1em)`\"");
 expect(css).toMatch(/\.lumiere-empty\s*\{[^}]*white-space: normal/s);
});
it('preserves accessible full titles without a shifting status caption in any stage mode',()=>{
 const room=read('views/Room.vue');
 expect(room.match(/:title="track\?\.name"/g)).toHaveLength(2);
 expect(room).not.toContain('stage-audio-status');
 expect(room).not.toContain('音乐准备中');
 for(const file of ['views/Room.vue','App.vue','components/TrackLyrics.vue'])expect(parse(read(file)).errors).toEqual([]);
});

it('keeps the room control bar immersive without a separate background or blur layer',()=>{
 const css=styles('App.vue');
 const nav=css.match(/\.tone-room-nav\s*\{([^}]+)\}/)?.[1];
 expect(nav).toBeDefined();expect(nav).toContain('background: transparent');
 expect(nav).not.toContain('backdrop-filter');expect(nav).toContain('border-bottom: none');
 const app=read('App.vue');expect(app).toContain('@mousedown="onHeaderMouseDown"');
 expect(app).toContain('@click.stop="exitCurrentRoom"');
});

it('pins the chat launcher below the room toolbar instead of pushing it down as the viewport narrows',()=>{
 const css=styles('components/ResponsiveRoomChat.vue');
 const trigger=css.match(/\.floating-chat-trigger\s*\{([^}]+)\}/)?.[1];
 expect(trigger).toContain('position:fixed');expect(trigger).toContain('top:68px');
 expect(trigger).toContain('bottom:auto');expect(trigger).toContain('flex-shrink:0');
 expect(trigger).toContain('white-space:nowrap');expect(trigger).toContain('max-width:calc(100% - 32px)');
});

it('rounds the independent player bottom corners and shares the window maximized radius without clipping the page',()=>{
 const app=read('App.vue'),player=read('components/GlobalPlayer.vue');
 const tone=readFileSync(new URL('../src/tone.css',import.meta.url),'utf8');
 expect(tone).toContain('#app{--window-corner-radius:20px;');expect(tone).toContain('#app.is-maximized{--window-corner-radius:0px;');
 expect(styles('App.vue')).toContain('border-radius: var(--window-corner-radius, 20px)');
 expect(styles('components/GlobalPlayer.vue')).toContain('border-radius:0 0 var(--window-corner-radius,20px) var(--window-corner-radius,20px)');
 expect(styles('components/GlobalPlayer.vue')).not.toMatch(/overflow\s*:\s*hidden|clip-path|scale\(/);
 expect(player).toContain('prefers-reduced-motion:reduce');
 expect(app).toContain('播放器独立于 shell 的 inert 锁');expect(app).toContain(`<GlobalPlayer v-if="app.user" :class="{ 'desktop-room-player': bridge.desktop && inRoom }" />`);
 expect(styles('components/GlobalPlayer.vue')).toContain('.global-player.desktop-room-player{background-color:rgb(255 255 255 / 42%);border-top:0}');
});

it('preserves the original room slide/scale timings and isolates only the animated layer',()=>{
 const motion=read('motion.css'),app=read('App.vue');
 expect(motion).toContain('transform: translateY(100%)');expect(motion).toContain('transform: scale(0.97)');
 expect(motion).toContain('transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)');
 expect(motion).toContain('transform 0.35s cubic-bezier(0.3, 0, 0.8, 0.15)');
 for(const hook of ['@enter="roomRouteTransition.start"','@leave="roomRouteTransition.start"','@after-enter="roomRouteTransition.finish"','@enter-cancelled="roomRouteTransition.finish"','@after-leave="roomRouteTransition.finish"','@leave-cancelled="roomRouteTransition.finish"'])expect(app).toContain(hook);
 expect(app).toContain('onUnmounted(roomRouteTransition.dispose)');
 expect(styles('App.vue')).toMatch(/\.shell\.in-room-shell \.main\s*\{[^}]*overflow-y: auto/s);
});

it('keeps the 900px room breakpoint flexible instead of forcing a viewport-independent stage height',()=>{
 const room=styles('views/Room.vue');
 const narrow=room.slice(room.indexOf('@media (max-width: 900px)'),room.indexOf('@media (min-width: 901px)'));
 expect(narrow).toContain('height: 100%; min-height: 0; padding: 0 16px 20px; display: flex; flex-direction: column;');
 expect(narrow).toMatch(/flex: 1;\s*min-height: 340px;\s*height: auto;/);
 expect(narrow).not.toMatch(/min-height: 500px|height: clamp|overflow(?:-y)?: hidden|scale\(/);
 expect(narrow).toContain('grid-template-columns: minmax(0, 1fr)');
});
