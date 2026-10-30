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
