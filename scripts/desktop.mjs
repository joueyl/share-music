import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
export function tauriCli(root) {
  return createRequire(join(root, 'apps/client/package.json')).resolve('@tauri-apps/cli/tauri.js');
}
export function desktopEnvironment(source = process.env) {
  const env = { ...source };
  delete env.MUSIC_NATIVE_LIBRARY;
  delete env.MUSIC_NATIVE_LICENSES;
  delete env.MUSIC_NATIVE_DEPENDENCIES;
  return env;
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const child = spawn(process.execPath, [tauriCli(root), 'dev', ...process.argv.slice(2)], {
    cwd: join(root, 'apps/client'), env: desktopEnvironment(), stdio: 'inherit'
  });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}
