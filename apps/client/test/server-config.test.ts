import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { getServerUrl, resolveServerUrl,resolveApkServerUrl } from '../src/server-config';
afterEach(() => vi.unstubAllEnvs());
it('allows only explicit local APK preview origins in the backend defaults and public example',()=>{
 const source=readFileSync(new URL('../../server/src/main.ts',import.meta.url),'utf8');
 const example=readFileSync(new URL('../../server/.env.example',import.meta.url),'utf8');
 for(const text of [source,example])for(const origin of ['http://127.0.0.1:11421','http://localhost:11421'])expect(text).toContain(origin);
 expect(source).toContain('process.env.ALLOWED_ORIGINS ??');expect(source).not.toMatch(/origin:\s*(?:true|['"]\*['"])/);
});
it('uses a local backend for APK development without even reading production defaults',()=>{
 const production=vi.fn(()=> 'https://example.com');
 expect(resolveApkServerUrl(undefined,'serve',production)).toBe('http://127.0.0.1:3000');
 expect(resolveApkServerUrl('','serve',production)).toBe('http://127.0.0.1:3000');expect(production).not.toHaveBeenCalled();
 expect(resolveApkServerUrl(undefined,'build',production)).toBe('https://example.com');expect(production).toHaveBeenCalledOnce();
});
it('honors an explicit APK address for either command and still rejects unsafe values',()=>{
 const production=vi.fn(()=> 'https://example.com');
 for(const command of ['serve','build'] as const){
  expect(resolveApkServerUrl('http://127.0.0.1:3100',command,production)).toBe('http://127.0.0.1:3100');
  expect(()=>resolveApkServerUrl('https://user:password@example.com',command,production)).toThrow();
 }
 expect(production).not.toHaveBeenCalled();
});
it('selects the configured environment address without a hardcoded fallback', () => {
  vi.stubEnv('MODE', 'development'); vi.stubEnv('VITE_SERVER_URL', 'http://127.0.0.1:3000/');
  expect(getServerUrl()).toBe('http://127.0.0.1:3000');
  vi.stubEnv('MODE', 'production'); vi.stubEnv('VITE_SERVER_URL', 'https://share.jouei.cn/');
  expect(getServerUrl()).toBe('https://share.jouei.cn');
  vi.stubEnv('VITE_SERVER_URL', ''); expect(() => getServerUrl()).toThrow('请配置 VITE_SERVER_URL');
});
it('rejects unsafe or ambiguous base URLs before any credential can be sent', () => {
  for (const value of [undefined, '', 'not a url', 'file:///tmp/a', 'https://user:password@example.com', 'https://example.com/api', 'https://example.com?token=x', 'https://example.com#fragment']) {
    expect(() => resolveServerUrl(value, 'development')).toThrow();
  }
  expect(() => resolveServerUrl('http://share.jouei.cn', 'production')).toThrow('必须使用 HTTPS');
});
