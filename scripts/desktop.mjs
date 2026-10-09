import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

export function tauriCli(root) {
  return createRequire(join(root, 'apps/client/package.json')).resolve('@tauri-apps/cli/tauri.js');
}

export function selectNativeLibrary(root, platform, configured) {
  const filename = platform === 'win32' ? 'music_native.dll' : platform === 'darwin' ? 'libmusic_native.dylib' : 'libmusic_native.so';
  const candidates = ['native/build-com/Release', 'native/build-auto/Release', 'native/build/Release', 'native/build-auto', 'native/build'].map(directory => resolve(root, directory, filename));
  const requested = configured && resolve(configured);
  // An explicit custom external build remains authoritative. Project builds use the newest DLL.
  if (requested && !candidates.some(path => path.toLowerCase() === requested.toLowerCase())) return requested;
  return candidates.filter(existsSync).sort((a,b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? requested;
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const library = selectNativeLibrary(root, process.platform, process.env.MUSIC_NATIVE_LIBRARY);
  const env = { ...process.env };
  if (library) {
    if (!existsSync(library)) { console.error(`媒体库路径不存在：${library}`); process.exit(1); }
    env.MUSIC_NATIVE_LIBRARY = library;
    console.log(`使用媒体库：${library}`);
  }
  if (!process.argv.includes('--check-native')) {
    const child = spawn(process.execPath, [tauriCli(root),'dev',...process.argv.slice(2)], { cwd:join(root,'apps/client'),env,stdio:'inherit' });
    child.on('error',error=>{console.error(error.message);process.exitCode=1;});
    child.on('exit',code=>{process.exitCode=code??1;});
  }
}
