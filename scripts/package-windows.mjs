import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageWebview } from './package-webview.mjs';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    packageWebview('win32');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
