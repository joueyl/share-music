import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
it('styles native permission selects without replacing their semantics',()=>{
 const members=read('../src/components/RoomMembersDialog.vue');
 expect(members).toContain('<select class="tone-select"');
 const css=read('../src/selects.css'),main=read('../src/main.ts');
 expect(main.indexOf("import './selects.css'")).toBeGreaterThan(main.indexOf("import './adaptive-layout.css'"));
 expect(css).toContain('color-scheme:light');expect(css).toContain('border-radius:12px');
 expect(css).toContain('.tone-select:focus-visible');expect(css).toContain('.tone-select:disabled');
 expect(css).toContain('appearance:base-select');expect(css).toContain('.tone-select::picker(select)');
 expect(css).toContain('max-height:min(320px,calc(100dvh - 32px))');expect(css).toContain('option:checked');
 expect(css).toContain('pointer:coarse');expect(css).toContain('prefers-reduced-motion:reduce');expect(css).toContain('forced-colors:active');
});

it('reuses the accessible shared native select for the music source picker',()=>{
 const source=read('../src/components/MusicSearchDialog.vue');
 expect(source).toContain('class="tone-select music-source-select"');expect(source).toContain('aria-label="搜索音源"');expect(source).toContain('音源平台');expect(source).toContain('pointer-events:none');expect(source).toContain('min-height:44px');expect(source).toContain('.music-source-select:focus-visible');expect(source).toContain('@media(forced-colors:active)');
});

it('uses one unified playlist control permission and keeps member permission choices on one line',()=>{
 const members=read('../src/components/RoomMembersDialog.vue'),settings=read('../src/components/RoomSettingsDialog.vue');
 expect(members).toContain("enqueue: '播放列表控制'");expect(members).not.toContain("enqueue: '加入播放列表'");
 expect(members).toContain('white-space:nowrap;overflow-wrap:normal');expect(members).toContain('min-width:128px');
 expect(settings).toContain('hostOnly=ref(false)');expect(settings).toContain('stream:true');expect(settings).toContain('播放列表控制');
});

it('applies the shared native select styles inside the queue drawer too',()=>{
 expect(read('../src/selects.css')).toContain(':is(.shell,.modal-backdrop,.drawer-backdrop) .tone-select');
 const queue=read('../src/components/QueueDrawer.vue');expect(queue).toContain('overflow-y:auto');expect(queue).toContain('.queue-mode{display:flex;flex-direction:row;');
});
