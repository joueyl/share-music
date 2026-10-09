import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { selectNativeLibrary } from './desktop.mjs';

export function windowsResources(library, shareDirectory) {
  if (!library || !existsSync(library)) throw new Error('缺少媒体库，请先构建 native（Release），或设置 MUSIC_NATIVE_LIBRARY。');
  const directory = dirname(library);
  const dlls = readdirSync(directory).filter(name => name.toLowerCase().endsWith('.dll'));
  for (const prefix of ['music_native', 'avcodec-', 'avformat-', 'avutil-', 'swresample-', 'datachannel', 'FLAC', 'opus', 'SDL2', 'juice', 'libssl-', 'libcrypto-', 'ogg']) {
    if (!dlls.some(name => name.toLowerCase().startsWith(prefix.toLowerCase()))) throw new Error(`媒体库目录缺少依赖 ${prefix}*.dll：${directory}`);
  }
  if (!shareDirectory || !existsSync(shareDirectory)) throw new Error('找不到 vcpkg 许可证目录；请设置 MUSIC_NATIVE_LICENSES 为 vcpkg 的 <triplet>/share 目录。');
  const resources = Object.fromEntries(dlls.map(name => [join(directory, name), name]));
  for (const port of readdirSync(shareDirectory)) {
    const copyright = join(shareDirectory, port, 'copyright');
    if (existsSync(copyright)) resources[copyright] = `licenses/${port}/copyright`;
  }
  for (const port of ['ffmpeg', 'libflac', 'libdatachannel', 'sdl2', 'opus', 'openssl', 'libogg', 'libjuice', 'usrsctp', 'plog', 'nlohmann-json']) {
    if (!resources[join(shareDirectory, port, 'copyright')]) throw new Error(`缺少第三方许可证：${port}`);
  }
  return resources;
}

export function findLicenseDirectory(root, library, override) {
  if (override) return resolve(override);
  const cachePath = join(dirname(dirname(library)), 'CMakeCache.txt');
  if (existsSync(cachePath)) {
    const cache = readFileSync(cachePath, 'utf8');
    const installed = cache.match(/^VCPKG_INSTALLED_DIR:[^=]+=(.+)$/m)?.[1].trim();
    const triplet = cache.match(/^VCPKG_TARGET_TRIPLET:[^=]+=(.+)$/m)?.[1].trim() ?? 'x64-windows';
    if (installed) return join(installed, triplet, 'share');
  }
  return [join(root, 'native/vcpkg_installed/x64-windows/share'), join(root, 'vcpkg_installed/x64-windows/share')].find(existsSync);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('此命令需要 Windows x64；请在 Windows x64 构建机器上运行。');
    const library = selectNativeLibrary(root, 'win32', process.env.MUSIC_NATIVE_LIBRARY);
    if (!library) throw new Error('缺少媒体库，请先构建 native（Release）。');
    const resources = windowsResources(library, findLicenseDirectory(root, library, process.env.MUSIC_NATIVE_LICENSES));
    resources[join(root, 'docs/THIRD-PARTY-NOTICES.md')] = 'licenses/THIRD-PARTY-NOTICES.md';
    const configDirectory = join(root, 'native/build/packaging');
    mkdirSync(configDirectory, { recursive: true });
    const config = join(configDirectory, 'tauri.windows.generated.json');
    writeFileSync(config, JSON.stringify({ bundle: {
      active: true, targets: ['nsis'], useLocalToolsDir: true, icon: ['icons/icon.ico'], resources,
      windows: { bundleVCRuntime: true, webviewInstallMode: { type: 'downloadBootstrapper', silent: true },
        nsis: { installMode: 'currentUser', languages: ['SimpChinese', 'English'], installerIcon: 'icons/icon.ico' } }
    } }, null, 2));
    console.log(`打包媒体库：${library}\n随包资源：${Object.keys(resources).length} 个（DLL 与许可证）`);
    if (!process.argv.includes('--check')) {
      const child = spawn(process.execPath, [join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'build', '--bundles', 'nsis', '--config', config], {
        cwd: join(root, 'apps/client'), env: process.env, stdio: 'inherit'
      });
      child.on('error', error => { console.error(error.message); process.exitCode = 1; });
      child.on('exit', code => {
        process.exitCode = code ?? 1;
        if (code === 0) console.log(`安装文件目录：${join(root, 'apps/client/src-tauri/target/release/bundle/nsis')}`);
      });
    } else console.log(`资源检查通过：${basename(config)}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
