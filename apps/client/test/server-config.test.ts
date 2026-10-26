import { afterEach, expect, it, vi } from 'vitest';
import { getServerUrl, resolveServerUrl } from '../src/server-config';
afterEach(() => vi.unstubAllEnvs());
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
