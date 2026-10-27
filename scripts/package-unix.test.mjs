import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageUnix, unixBundle, macDependencies } from './package-unix.mjs';
import { findLicenseDirectory } from './package-windows.mjs';
const work = resolve(dirname(fileURLToPath(import.meta.url)), '../../../work/packaging-tests');
mkdirSync(work, { recursive: true });
const components = ['avcodec', 'avformat', 'avutil', 'swresample', 'datachannel', 'FLAC', 'opus', 'SDL2'];
function fixture(platform) {
  const root = mkdtempSync(join(work, 'unix-'));
  const share = join(root, 'installed/share'), dependencies = join(root, 'installed/lib');
  mkdirSync(dependencies, { recursive: true });
  for (const port of ['ffmpeg', 'libflac', 'libdatachannel', 'sdl2', 'opus', 'openssl', 'libogg', 'libjuice', 'usrsctp', 'plog', 'nlohmann-json']) {
    const directory = join(share, port); mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, 'copyright'), 'license');
  }
  const extension = platform === 'darwin' ? '.dylib' : '.so';
  const library = join(root, `native/build/libmusic_native${extension}`);
  mkdirSync(dirname(library), { recursive: true }); writeFileSync(library, 'native fixture');
  for (const component of components) writeFileSync(join(dependencies, `lib${component}${extension}`), 'dependency fixture');
  const calls = [];
  const execute = (command, args) => {
    calls.push([command, args]);
    if (command === 'otool') return `${args[1]}:\n${components.map(name => `\t${join(dependencies, `lib${name}.dylib`)} (compatibility version 1.0.0)`).join('\n')}\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0)\n`;
    if (command === 'patchelf' && args[0] === '--print-needed') return components.map(name => `lib${name}.so`).join('\n');
    if (command === 'readelf') return `Machine: ${process.arch === 'arm64' ? 'AArch64' : 'Advanced Micro Devices X86-64'}`;
    return '';
  };
  return { root, library, share, dependencies, calls, execute };
}
test('Linux staging patches copies, leaves originals intact and maps media into resources', () => {
  const f = fixture('linux'); const { config, staging } = stageUnix(f.root, 'linux', f.library, f.share, f.dependencies, f.execute);
  assert.deepEqual(config.bundle.targets, ['deb', 'appimage']);
  assert.equal(config.bundle.resources[join(staging, basename(f.library))], 'media/libmusic_native.so');
  assert(config.bundle.linux.deb.depends.includes('libpipewire-0.3-0'));
  assert(config.bundle.linux.deb.depends.includes('libdbus-1-3'));
  assert.equal(config.bundle.resources[join(f.root,'docs/licenses/souvlaki-LICENSE')],'licenses/souvlaki/LICENSE');
  assert.equal(readFileSync(f.library, 'utf8'), 'native fixture');
  const patches = f.calls.filter(([name, args]) => name === 'patchelf' && args[0] === '--set-rpath');
  assert.equal(patches.length, 9); assert(patches.every(([, args]) => args[1] === '$ORIGIN' && args[2].startsWith(staging)));
});
test('macOS staging includes signed Frameworks and rewrites non-system dependencies on copies', () => {
  const f = fixture('darwin'); const { config, staging } = stageUnix(f.root, 'darwin', f.library, f.share, f.dependencies, f.execute);
  assert.deepEqual(config.bundle.targets, ['app', 'dmg']); assert.equal(config.bundle.macOS.minimumSystemVersion, '13.0');
  assert(config.bundle.macOS.frameworks.includes(join(staging, 'libmusic_native.dylib')));
  assert(f.calls.some(([command, args]) => command === 'install_name_tool' && args[0] === '-change' && args[2] === '@loader_path/libavcodec.dylib'));
  assert.equal(f.calls.filter(([command]) => command === 'codesign').length, 9);
  const checks=f.calls.filter(([command])=>command==='lipo');
  assert.equal(checks.length,9);
  for(const [,args] of checks){
    assert.equal(args.length,3);
    assert(args[0].startsWith(staging));
    assert.equal(args[1],'-verify_arch');
    assert.equal(args[2],process.arch==='arm64'?'arm64':'x86_64');
  }
});

test('macOS packaging stops on architecture verification failure before patching or signing',()=>{
 const f=fixture('darwin');
 assert.throws(()=>stageUnix(f.root,'darwin',f.library,f.share,f.dependencies,(command,args)=>{
  if(command==='lipo')throw new Error('lipo architecture mismatch');
  return f.execute(command,args);
 }),/lipo architecture mismatch/);
 assert(!f.calls.some(([command])=>['codesign','install_name_tool'].includes(command)));
});
test('packaging rejects static media linkage and missing dependencies', () => {
  const f = fixture('linux');
  assert.throws(() => stageUnix(f.root, 'linux', f.library, f.share, f.dependencies, () => ''), /必须动态链接/);
  assert.throws(() => stageUnix(f.root, 'linux', f.library, f.share, f.dependencies, (command,args) => command === 'ldd' ? 'libopus.so => not found' : f.execute(command,args)), /动态依赖缺失/);
  assert.throws(() => stageUnix(f.root, 'linux', f.library, f.share, f.dependencies, (command,args) => command === 'ldd' ? 'libavcodec.so => /opt/build/libavcodec.so (0x1234)' : f.execute(command,args)), /外部目录/);
  const mac = fixture('darwin');
  assert.throws(() => stageUnix(mac.root, 'darwin', mac.library, mac.share, mac.dependencies, (command,args) => command === 'otool' ? mac.execute(command,args)+'\t/opt/homebrew/lib/missing.dylib (compatibility version 1.0.0)\n' : mac.execute(command,args)), /缺少 macOS 动态依赖/);
});
test('single-config CMake cache resolves Unix license paths and system framework paths survive parsing', () => {
  const f=fixture('linux'); writeFileSync(join(dirname(f.library),'CMakeCache.txt'), `VCPKG_INSTALLED_DIR:PATH=${join(f.root,'installed')}\nVCPKG_TARGET_TRIPLET:STRING=custom\n`);
  assert.equal(findLicenseDirectory(f.root, f.library, undefined, 'linux'), join(f.root,'installed/custom/share'));
  assert.deepEqual(macDependencies('native:\n\t/System/Library/Frameworks/Core Audio.framework/Core Audio (compatibility version 1.0.0)\n'), ['/System/Library/Frameworks/Core Audio.framework/Core Audio']);
  assert.deepEqual(unixBundle('darwin',[],{}).bundle.resources,{});
});
