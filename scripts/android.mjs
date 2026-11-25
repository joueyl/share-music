import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adbExecutable, androidDevices } from '../apps/client/android-dev-forward.mjs';

export function matchAndroidDevice(devices, target) {
  const exact = devices.find(device => device.serial === target);
  if (exact) return exact;
  const named = devices.filter(device => device.name === target || device.model === target);
  if (named.length !== 1) throw new Error('设备名称不存在或不唯一，请指定 ADB 序列号。');
  return named[0];
}

function androidBuildEnvironment(env) {
  if (process.platform !== 'win32' || (env.VCToolsInstallDir && env.WindowsSdkDir)) return env;

  const programFiles = [env['ProgramFiles(x86)'], env.ProgramFiles].filter(Boolean);
  const roots = programFiles.map(dir => join(dir, 'Microsoft Visual Studio'));
  const vswhere = roots.map(dir => join(dir, 'Installer', 'vswhere.exe')).find(existsSync);
  let discovered;
  if (vswhere) {
    try {
      discovered = execFileSync(vswhere, [
        '-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '-find', 'Common7/Tools/VsDevCmd.bat', '-utf8',
      ], { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch { /* Also check the default install paths. */ }
  }
  const editions = ['BuildTools', 'Community', 'Professional', 'Enterprise'];
  const vsDevCmd = [
    discovered,
    ...roots.flatMap(root => editions.map(edition => join(root, '2022', edition, 'Common7', 'Tools', 'VsDevCmd.bat'))),
  ].find(file => file && existsSync(file));
  const hint = '请安装 Visual Studio C++ Build Tools 和 Windows SDK，或在 Visual Studio 的 x64 Native Tools Command Prompt 中运行 npm run android。';
  if (!vsDevCmd) throw new Error(`未找到 Windows C++ 构建工具。${hint}`);

  let output;
  try {
    output = execFileSync(env.ComSpec || 'cmd.exe', [
      '/d', '/u', '/c', 'call "%TONE_ANDROID_VSDEV_CMD%" -no_logo -arch=x64 -host_arch=x64 >nul && set',
    ], {
      env: { ...env, TONE_ANDROID_VSDEV_CMD: vsDevCmd, VSCMD_SKIP_SENDTELEMETRY: '1' },
      windowsVerbatimArguments: true, encoding: 'utf16le', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error(`无法初始化 Windows C++ 构建环境。${hint}`);
  }
  const buildEnv = Object.create(null);
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).toUpperCase();
    if (key !== 'TONE_ANDROID_VSDEV_CMD') buildEnv[key] = line.slice(separator + 1);
  }
  if (!buildEnv.VCTOOLSINSTALLDIR || !buildEnv.WINDOWSSDKDIR) {
    throw new Error(`Windows C++ 构建环境缺少 MSVC 或 Windows SDK。${hint}`);
  }
  return buildEnv;
}

async function main() {
  const args = process.argv.slice(2);
  const target = args[0] && !args[0].startsWith('-') ? args.shift() : undefined;
  const client = new URL('../apps/client/', import.meta.url);
  const cli = createRequire(new URL('package.json', client)).resolve('@tauri-apps/cli/tauri.js');
  const baseArgs = [cli, 'android', 'dev', '--host', '127.0.0.1'];
  const launch = (tauriArgs, env = process.env) => {
    const child = spawn(process.execPath, tauriArgs, { cwd: fileURLToPath(client), env, stdio: 'inherit' });
    child.on('error', error => { console.error(error.message); process.exitCode = 1; });
    child.on('exit', code => { process.exitCode = code ?? 1; });
  };
  if (args.includes('--help') || args.includes('-h')) return launch([...baseArgs, ...args]);
  const adb = adbExecutable();
  const devices = androidDevices(adb).map(device => {
    const emulator = device.serial.startsWith('emulator-');
    let name;
    try {
      const command = emulator ? ['emu', 'avd', 'name'] : ['shell', 'dumpsys', 'bluetooth_manager'];
      const result = execFileSync(adb, ['-s', device.serial, ...command], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'] });
      name = emulator ? result.split(/\r?\n/)[0].trim() : result.match(/\bname: ([^\r\n]+)/)?.[1].trim();
    } catch { /* Fall back to the ADB model. */ }
    return { ...device, name: name || device.model };
  });
  if (!devices.length) throw new Error('没有在线的 Android 设备，请先启动模拟器或连接手机。');
  let device;
  if (target || process.env.ANDROID_SERIAL) {
    device = matchAndroidDevice(devices, target || process.env.ANDROID_SERIAL);
  } else if (devices.length === 1) {
    [device] = devices;
  } else {
    if (!process.stdin.isTTY) throw new Error('存在多台设备，请运行 npm run android -- <设备序列号>。');
    devices.forEach((entry, i) => console.log(`  ${i + 1}. ${entry.name || 'Android'} (${entry.serial})`));
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const choice = (await prompt.question('请选择 Android 调试设备编号：')).trim();
      device = /^\d+$/.test(choice) ? devices[Number(choice) - 1] : undefined;
      if (!device) throw new Error('无效的设备编号，未启动开发模式。');
    } finally { prompt.close(); }
  }
  if (!device.name || devices.filter(entry => entry.name === device.name).length !== 1) {
    throw new Error('无法为 Tauri 确定唯一设备名，请为重复设备改名或断开其中一台。');
  }
  console.log(`Android 开发设备：${device.name} (${device.serial})`);
  launch([...baseArgs, device.name, ...args], { ...androidBuildEnvironment(process.env), ANDROID_SERIAL: device.serial });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => { console.error(`Android 开发模式启动失败：${error.message}`); process.exitCode = 1; });
}
