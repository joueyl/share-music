import { existsSync, readdirSync, readFileSync, mkdirSync, mkdtempSync, copyFileSync, chmodSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { selectNativeLibrary, tauriCli } from './desktop.mjs';
import { findLicenseDirectory } from './package-windows.mjs';

const primaryLibraries = ['avcodec', 'avformat', 'avutil', 'swresample', 'datachannel', 'FLAC', 'opus', 'SDL2'];
export function dynamicLibrary(name, platform) {
  return platform === 'darwin' ? name.endsWith('.dylib') : /\.so(?:\.\d+)*$/.test(name);
}
export function macDependencies(output) {
  return output.split('\n').slice(1).map(line => line.trim().split(' (')[0]).filter(Boolean);
}
export function unixBundle(platform, libraries, resources) {
  const bundle = { active: true, targets: platform === 'darwin' ? ['app', 'dmg'] : ['deb', 'appimage'],
    useLocalToolsDir: true, icon: platform === 'darwin' ? ['icons/icon.icns'] : ['icons/icon.png'], resources };
  if (platform === 'darwin') bundle.macOS = { minimumSystemVersion: '13.0', frameworks: libraries };
  else {
    for (const library of libraries) resources[library] = `media/${basename(library)}`;
    bundle.linux = { deb: { depends: ['libwebkit2gtk-4.1-0', 'libgtk-3-0', 'libpipewire-0.3-0', 'libdbus-1-3'] } };
  }
  return { bundle };
}
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
  if (result.error || result.status !== 0) throw new Error(`${command} 失败：${result.error?.message ?? result.stderr ?? result.stdout}`);
  return result.stdout;
}
export function stageUnix(root, platform, library, shareDirectory, dependenciesDirectory, execute = run) {
  if (!library || !existsSync(library)) throw new Error('缺少媒体库，请先构建 native 的 Release 动态库。');
  if (basename(library) !== (platform === 'darwin' ? 'libmusic_native.dylib' : 'libmusic_native.so')) throw new Error('媒体库文件名必须保留为 libmusic_native.dylib 或 libmusic_native.so。');
  if (!shareDirectory || !existsSync(shareDirectory)) throw new Error('缺少许可证目录，请设置 MUSIC_NATIVE_LICENSES 为 vcpkg 的 <triplet>/share。');
  const resources = { [join(root, 'docs/THIRD-PARTY-NOTICES.md')]: 'licenses/THIRD-PARTY-NOTICES.md', [join(root, 'docs/licenses/souvlaki-LICENSE')]: 'licenses/souvlaki/LICENSE' };
  for (const port of readdirSync(shareDirectory)) {
    const license = join(shareDirectory, port, 'copyright');
    if (existsSync(license)) resources[license] = `licenses/${port}/copyright`;
  }
  for (const port of ['ffmpeg', 'libflac', 'libdatachannel', 'sdl2', 'opus', 'openssl', 'libogg', 'libjuice', 'usrsctp', 'plog', 'nlohmann-json']) {
    if (!resources[join(shareDirectory, port, 'copyright')]) throw new Error(`缺少第三方许可证：${port}`);
  }
  const sources = new Map();
  for (const directory of [dependenciesDirectory, dirname(library)]) {
    if (!directory || !existsSync(directory)) continue;
    for (const name of readdirSync(directory).filter(name => dynamicLibrary(name, platform))) {
      const path = join(directory, name);
      if (sources.has(name) && !readFileSync(sources.get(name)).equals(readFileSync(path))) throw new Error(`同名动态库内容冲突：${name}`);
      sources.set(name, path);
    }
  }
  sources.set(basename(library), library);
  const direct = platform === 'darwin' ? macDependencies(execute('otool', ['-L', library])) : execute('patchelf', ['--print-needed', library]).trim().split('\n');
  for (const component of primaryLibraries) {
    if (!direct.some(path => basename(path).startsWith(`lib${component}`))) throw new Error(`${component} 必须动态链接；请使用 native/triplets 中的 dynamic triplet 重新构建。`);
    for (const path of direct.filter(path => basename(path).startsWith(`lib${component}`))) {
      if (!sources.has(basename(path))) throw new Error(`主要媒体依赖未随包提供：${path}`);
    }
  }
  const parent = join(root, 'native/build/packaging');
  mkdirSync(parent, { recursive: true });
  // Fresh staging avoids stale dependency files without deleting another build's data.
  const staging = mkdtempSync(join(parent, `${platform}-`));
  const libraries = [...sources].map(([name, source]) => {
    const destination = join(staging, name); copyFileSync(source, destination); chmodSync(destination, 0o755); return destination;
  });
  for (const path of libraries) {
    if (platform === 'darwin') {
      execute('lipo', ['-verify_arch', process.arch === 'arm64' ? 'arm64' : 'x86_64', path]);
      const dependencies = macDependencies(execute('otool', ['-L', path]));
      execute('install_name_tool', ['-id', `@rpath/${basename(path)}`, path]);
      for (const dependency of dependencies) {
        if (sources.has(basename(dependency))) execute('install_name_tool', ['-change', dependency, `@loader_path/${basename(dependency)}`, path]);
        else if (!dependency.startsWith('/System/Library/') && !dependency.startsWith('/usr/lib/')) throw new Error(`缺少 macOS 动态依赖：${dependency}`);
      }
      // Refresh signatures after changing the copies; Tauri signs the final Frameworks.
      execute('codesign', ['--force', '--sign', '-', path]);
    } else {
      const header = execute('readelf', ['-h', path]);
      const machine = process.arch === 'arm64' ? /Machine:\s*AArch64/ : /Machine:\s*Advanced Micro Devices X86-64/;
      if (!machine.test(header)) throw new Error(`媒体库架构不匹配：${path}`);
      execute('patchelf', ['--set-rpath', '$ORIGIN', path]);
    }
  }
  if (platform === 'linux') {
    for (const path of libraries) {
      const dependencies = execute('ldd', [path]);
      if (dependencies.includes('not found')) throw new Error(`动态依赖缺失：${path}\n${dependencies}`);
      for (const match of dependencies.matchAll(/^\s*\S+\s+=>\s+(\/\S+)\s+\(/gm)) {
        const dependency = match[1];
        if (dependency.startsWith(`${staging}/`)) continue;
        if (sources.has(basename(dependency)) || !/^\/(?:usr\/)?lib(?:64)?\//.test(dependency)) throw new Error(`依赖仍来自外部目录：${dependency}`);
      }
    }
  }
  return { config: unixBundle(platform, libraries, resources), staging };
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const platform = process.argv[2] === 'mac' ? 'darwin' : process.argv[2] === 'linux' ? 'linux' : undefined;
    if (!platform || process.platform !== platform || !['x64', 'arm64'].includes(process.arch)) throw new Error('mac 命令需在 macOS、linux 命令需在 Linux 上运行，支持本机 x64/arm64 架构。');
    const library = selectNativeLibrary(root, platform, process.env.MUSIC_NATIVE_LIBRARY);
    if (!library) throw new Error('缺少媒体库，请先构建 native 的 Release 动态库。');
    const share = findLicenseDirectory(root, library, process.env.MUSIC_NATIVE_LICENSES, platform);
    const dependencies = process.env.MUSIC_NATIVE_DEPENDENCIES ? resolve(process.env.MUSIC_NATIVE_DEPENDENCIES) : share && join(dirname(share), 'lib');
    const { config, staging } = stageUnix(root, platform, library, share, dependencies);
    const configFile = join(staging, 'tauri.generated.json');
    writeFileSync(configFile, JSON.stringify(config, null, 2));
    console.log(`媒体库依赖、架构及许可证检查通过：${staging}`);
    if (!process.argv.includes('--check')) {
      const child = spawn(process.execPath, [tauriCli(root), 'build', '--bundles', ...config.bundle.targets, '--config', configFile], {
        cwd: join(root, 'apps/client'), env: { ...process.env, ...(platform === 'darwin' ? { MACOSX_DEPLOYMENT_TARGET: '13.0' } : {}) }, stdio: 'inherit'
      });
      child.on('error', error => { console.error(error.message); process.exitCode = 1; });
      child.on('exit', code => { process.exitCode = code ?? 1; if (code === 0) console.log(`安装包目录：${join(root, 'apps/client/src-tauri/target/release/bundle')}`); });
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
