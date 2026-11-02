import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '@vue/compiler-sfc';
const read=(name:string)=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const auth=parse(read('components/AuthPage.vue')).descriptor.styles.map(style=>style.content).join('\n');
const app=parse(read('App.vue')).descriptor.styles.map(style=>style.content).join('\n');

it('fits auth to its parent viewport without legacy fixed-height art, cards or oversized padding',()=>{
 expect(auth).toMatch(/\.auth-page\{[^}]*display:flex;[^}]*min-height:100%/);
 expect(auth).toMatch(/\.auth-content\{[^}]*flex:1;[^}]*align-items:center/);
 expect(auth).not.toMatch(/min-height:(644|624|658|960)px|padding:175px/);
 expect(auth).toMatch(/\.auth-card\{[^}]*width:100%;[^}]*min-height:0/);
 expect(auth).toContain('width:min(380px,74%,46dvh)');
});
it('keeps a reachable auth scroll fallback instead of hiding overflowing form controls',()=>{
 expect(app).toMatch(/\.shell\.auth-shell\s*\{[^}]*height: 100dvh;[^}]*min-height: 0/);
 expect(app).toMatch(/\.shell\.auth-shell \.main\s*\{\s*padding: 0;\s*overflow: auto/);
 expect(auth).not.toMatch(/scrollbar-width:\s*none|::-webkit-scrollbar/);
 expect(auth).toContain('@media(max-width:480px)');
 expect(auth).toContain('@media(min-width:901px) and (max-height:700px)');
});
it('keeps decorative ripple geometry inside its artwork bounds without clipping it',()=>{
 // A 74%-wide ring growing to 1.3x stays inside the visual (96.2%).
 expect(auth).toContain('width:74%');
 expect(auth).toContain('100%{transform:scale(1.3);opacity:0}');
 expect(0.74*1.3).toBeLessThanOrEqual(1);
 expect(auth).toContain('@media(prefers-reduced-motion:reduce)');
});
