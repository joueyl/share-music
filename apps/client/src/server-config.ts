export function resolveServerUrl(value: unknown, mode: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('请配置 VITE_SERVER_URL 服务器地址');
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('VITE_SERVER_URL 必须是有效的服务器地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('VITE_SERVER_URL 仅允许 HTTP(S) 域名和端口，不能包含路径、凭据或查询参数');
  }
  if (mode === 'production' && url.protocol !== 'https:') throw new Error('生产环境 VITE_SERVER_URL 必须使用 HTTPS');
  return url.origin;
}

export function getServerUrl(): string {
  return resolveServerUrl(import.meta.env.VITE_SERVER_URL, import.meta.env.MODE);
}
