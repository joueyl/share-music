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
 expect(css).toContain('.stage-audio-status {\n  position: static');
});
it('keeps narrow and short rooms scrollable with space for the fixed transport and chat input',()=>{
 const app=styles('App.vue'),room=styles('views/Room.vue');
 expect(app).toMatch(/\.shell\.in-room-shell \.main\s*\{[^}]*overflow-y: auto/s);
 expect(app).toContain('(max-height: 639px)');
 expect(app).toContain('padding-bottom: calc(132px + env(safe-area-inset-bottom, 0px))');
 expect(room).toContain('height: clamp(500px, calc(100dvh - 184px), 640px)');
 expect(room).toContain('height: 400px; min-height: 320px');
});
it('wraps long untimed lyrics, bounds word spacing, and scrolls long lines without scaling the page',()=>{
 const css=styles('components/TrackLyrics.vue'),template=read('components/TrackLyrics.vue');
 expect(css).toMatch(/\.lumiere-stage\s*\{[^}]*overflow: auto/s);
 expect(css).toContain('align-items: safe center');
 expect(css).toContain('max-width: calc(100% - 1em)');
 expect(css).toContain('overflow-wrap: anywhere');
 expect(template).toContain(":margin=\"`min(${lineMargins[current]?.[j] ?? '0px'}, 1em)`\"");
 expect(css).toMatch(/\.lumiere-empty\s*\{[^}]*white-space: normal/s);
});
it('preserves accessible full titles and playback loading/error feedback in every stage mode',()=>{
 const room=read('views/Room.vue');
 expect(room.match(/:title="track\?\.name"/g)).toHaveLength(2);
 expect(room).toContain('class="stage-audio-status" role="status"');
 expect(room).toContain("app.room.pending?'正在准备同步…':app.media.detail||'等待音乐开始'");
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
