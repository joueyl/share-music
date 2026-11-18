import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import { parse } from '@vue/compiler-sfc';
const read=(p:string)=>readFileSync(new URL('../src/'+p,import.meta.url),'utf8');
it('keeps APK templates independent, responsive and free of desktop chrome',()=>{
 for(const file of ['apk/ApkApp.vue','apk/pages/LoginPage.vue','apk/pages/DiscoverPage.vue','apk/pages/MusicPage.vue','apk/pages/ListenPage.vue','apk/components/ApkPlayer.vue','apk/components/ApkNavigation.vue']){
  const source=read(file);expect(parse(source).errors).toEqual([]);expect(source).not.toMatch(/import.*(?:App\.vue|\/views\/|GlobalPlayer\.vue|AuthPage\.vue)/);
 }
 const css=read('apk/apk.css');expect(css).toContain('100dvh');expect(css).toContain('env(safe-area-inset-bottom');expect(css).toContain('@media(min-width:760px) and (min-height:600px)');expect(css).toContain('grid-template-columns:repeat(2,minmax(0,1fr))');expect(css).not.toMatch(/overflow-x:\s*hidden|transform:\s*scale\(/);
 const app=read('apk/ApkApp.vue');expect(app.indexOf('<ApkNavigation />')).toBeLessThan(app.indexOf('<ApkPlayer v-if'));expect(app).toContain(':key="app.user.id" :include="cachedNames" :max="2"');expect(app).not.toContain('appUpdates');
});
it('draws one focus border per APK text field without hiding button focus',()=>{
 const css=read('apk/apk.css');
 expect(css).toContain('button:focus-visible,a:focus-visible');
 expect(css).toContain(':is(.apk-input,.global-search-form):has(input:focus){border-color:var(--accent);outline:2px solid var(--accent);outline-offset:-2px;box-shadow:none}');
 expect(css).toContain(':is(.apk-input,.global-search-form) input:focus{border:0;outline:none;box-shadow:none}');
 expect(css).toContain('textarea,select):focus{border-color:var(--accent);outline:2px solid var(--accent);outline-offset:-2px;box-shadow:none}');
 expect(css).not.toContain('.apk-input:focus-within{outline:');
});
