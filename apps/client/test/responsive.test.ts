import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '@vue/compiler-sfc';

const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
it('retains pinch zoom, supports safe areas and loads mobile overrides after base and motion CSS',()=>{
 const html=read('../index.html'),main=read('../src/main.ts'),css=read('../src/responsive.css');
 expect(html).toContain('viewport-fit=cover');expect(html).not.toMatch(/user-scalable=no|maximum-scale=1/);
 expect(main.indexOf("import './responsive.css'")).toBeGreaterThan(main.indexOf("import './motion.css'"));
 expect(css).toContain('env(safe-area-inset-bottom');expect(css).toContain('100dvh');
 expect(css).toContain('min-height:44px');expect(css).toContain('font-size:16px');
 expect(css).not.toMatch(/overflow-x\s*:\s*hidden/);
});
it('keeps playlist controls grouped for wrapping and preserves the room template',()=>{
 const room=read('../src/views/Room.vue');expect(parse(room).errors).toEqual([]);
 expect(room).toContain('class="track-actions"');
 expect(room).toContain('aria-label="播放此曲"');expect(room).toContain('aria-label="移除音轨"');
 expect(read('../src/App.vue')).toContain('aria-label="主导航"');
});
