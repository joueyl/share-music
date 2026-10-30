import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageWebview } from './package-webview.mjs';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const platform = process.argv[2] === 'mac' ? 'darwin' : process.argv[2] === 'linux' ? 'linux' : null;
    if (!platform) throw new Error('请指定 mac 或 linux。');
    packageWebview(platform);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
