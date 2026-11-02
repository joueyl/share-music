import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const config=JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json',import.meta.url),'utf8'));
it('allows GLTF embedded blob fetches and artwork decoding without weakening script execution',()=>{
 const policy=config.app.security.csp as string;
 const directives=Object.fromEntries(policy.split(';').map(d=>d.trim().split(/\s+/)).map(([name,...values])=>[name,values]));
 expect(directives['connect-src']).toContain('blob:');expect(directives['img-src']).toContain('blob:');
 expect(directives['script-src']).toEqual(["'self'"]);expect(directives['object-src']).toEqual(["'none'"]);
 expect(policy).not.toMatch(/unsafe-eval|script-src[^;]*blob:/);
});
it('tests production previews with the actual desktop CSP rather than unrestricted Vite dev policy',()=>{
 const source=readFileSync(new URL('../vite.config.ts',import.meta.url),'utf8');
 expect(source).toContain("import tauriConfig from './src-tauri/tauri.conf.json'");expect(source).toContain("preview:{headers:{'Content-Security-Policy':tauriConfig.app.security.csp}}");
});
