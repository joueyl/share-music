import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { tauriCli, desktopEnvironment } from './desktop.mjs';
import { checkVersions } from './version.mjs';
import { withUpdater } from './updater-config.mjs';

export function webviewBundle(root, platform) {
  const resources = {
    [join(root, 'docs/THIRD-PARTY-NOTICES.md')]: 'licenses/THIRD-PARTY-NOTICES.md',
    [join(root, 'docs/licenses/souvlaki-LICENSE')]: 'licenses/souvlaki/LICENSE'
  };
  const bundle = { active: true, useLocalToolsDir: true, resources,
    targets: platform === 'win32' ? ['nsis'] : platform === 'darwin' ? ['app', 'dmg'] : ['deb', 'appimage'],
    icon: [platform === 'win32' ? 'icons/icon.ico' : platform === 'darwin' ? 'icons/icon.icns' : 'icons/icon.png'] };
  if (platform === 'win32') bundle.windows = { bundleVCRuntime: true,
    webviewInstallMode: { type: 'downloadBootstrapper', silent: true },
    nsis: { installMode: 'currentUser', languages: ['SimpChinese', 'English'], installerIcon: 'icons/icon.ico' } };
  if (platform === 'darwin') bundle.macOS = { minimumSystemVersion: '13.0' };
  if (platform === 'linux') bundle.linux = { deb: { depends: ['libwebkit2gtk-4.1-0', 'libgtk-3-0', 'libdbus-1-3', 'libayatana-appindicator3-1'] } };
  return { bundle };
}
export function packageWebview(platform, args = process.argv) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  checkVersions(root);
  if (process.platform !== platform || !['x64','arm64'].includes(process.arch) || platform === 'win32' && process.arch !== 'x64') throw new Error('请在对应平台和受支持的架构上打包。');
  const config = withUpdater(webviewBundle(root, platform), root);
  const directory = join(root, 'apps/client/src-tauri/target/packaging');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `tauri.${platform}.generated.json`);
  writeFileSync(file, JSON.stringify(config, null, 2));
  console.log(`HTML Audio / WebView 打包配置已生成：${file}`);
  if (args.includes('--check')) return;
  const child = spawn(process.execPath, [tauriCli(root), 'build', '--bundles', ...config.bundle.targets, '--config', file], {
    cwd: join(root, 'apps/client'), env: desktopEnvironment(), stdio: 'inherit'
  });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}
