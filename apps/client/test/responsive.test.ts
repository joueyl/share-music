import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '@vue/compiler-sfc';

const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
it('fits desktop workspaces with flexible internal lists instead of hiding scrollbars',()=>{
 const main=read('../src/main.ts'),css=read('../src/adaptive-layout.css');
 expect(main).not.toContain("import './scrollbars.css'");
 expect(main.indexOf("import './adaptive-layout.css'")).toBeGreaterThan(main.indexOf("import './brilliant.css'"));
 expect(css).toContain('height:100dvh');expect(css).toContain('--workspace-nav');expect(css).toContain('--workspace-player');
 expect(css).toContain('.route-page .discovery-grid,.route-page .playlist-grid,.route-page .track-list{flex:1;min-height:0;overflow:auto');
 expect(css).toContain('.tone-room .listening-layout{flex:1;min-height:0');
 expect(css).toContain('.listening-layout>.room-chat{height:100%;min-height:0}');
 expect(css).toContain('(min-width:901px) and (min-height:640px)');
 const rules=css.replace(/\/\*[\s\S]*?\*\//g,'');
 expect(rules).not.toMatch(/scrollbar-width\s*:\s*none|::-webkit-scrollbar|overflow(?:-y)?\s*:\s*hidden/);
 const auth=read('../src/components/AuthPage.vue');
 expect(auth).not.toContain('min-height:max(960px,100dvh)');
 expect(auth).toContain('(max-height:900px)');
});
it('retains pinch zoom, supports safe areas and loads mobile overrides after base and motion CSS',()=>{
 const html=read('../index.html'),main=read('../src/main.ts'),css=read('../src/responsive.css');
 expect(html).toContain('viewport-fit=cover');expect(html).not.toMatch(/user-scalable=no|maximum-scale=1/);
 expect(main.indexOf("import './responsive.css'")).toBeGreaterThan(main.indexOf("import './motion.css'"));
 expect(css).toContain('env(safe-area-inset-bottom');expect(css).toContain('100dvh');
 expect(css).toContain('min-height:44px');expect(css).toContain('font-size:16px');
 expect(css).not.toMatch(/overflow-x\s*:\s*hidden/);
});
it('keeps discovery hero actions in flex flow with bottom padding and nonshrinking room covers',()=>{
 const css=read('../src/adaptive-layout.css');
 expect(css).toContain('.discovery-page .discovery-hero{display:flex;align-items:center;flex:0 0 auto;height:auto;');
 expect(css).toContain('padding:20px 30px');
 expect(css).toContain('.discovery-copy>div{display:flex;flex-wrap:wrap;');
 expect(css).toContain('.discovery-page .discovery-grid{display:flex;flex-wrap:wrap;');
 expect(css).toContain('.discovery-card .landscape-cover{display:flex;align-items:center;flex:0 0 auto;');
 expect(css).not.toContain('height:clamp(160px,26vh,265px)');
});
it('keeps playlist controls grouped for wrapping and preserves the room template',()=>{
 const room=read('../src/views/Room.vue'),queue=read('../src/components/QueueDrawer.vue');expect(parse(room).errors).toEqual([]);expect(parse(queue).errors).toEqual([]);
 expect(queue).toContain('class="track-actions"');
 expect(queue).toContain('aria-label="播放此曲"');expect(queue).toContain('aria-label="移除音轨"');
 expect(read('../src/App.vue')).toContain('aria-label="主导航"');
});
