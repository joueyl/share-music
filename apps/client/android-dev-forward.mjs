import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnv } from 'vite';
import { resolveApkServerUrl } from './src/server-config.ts';

const clientDir = fileURLToPath(new URL('.', import.meta.url));
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);

export function androidDevPorts(devUrl, serverUrl) {
  const frontend = new URL(devUrl);
  const backend = new URL(serverUrl);
  const port = url => url.port || (url.protocol === 'https:' ? '443' : '80');
  return [...new Set([port(frontend), ...(loopback.has(backend.hostname) ? [port(backend)] : [])])];
}

export function adbExecutable() {
  const executable = process.platform === 'win32' ? 'adb.exe' : 'adb';
  return [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]
    .filter(Boolean)
    .map(sdk => join(sdk, 'platform-tools', executable))
    .find(existsSync) ?? executable;
}

export function androidDevices(adb) {
  const output = execFileSync(adb, ['devices', '-l'], { encoding: 'utf8', timeout: 10_000 });
  return output.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^(\S+)\s+device(?:\s|$)/);
    return match ? [{ serial: match[1], model: line.match(/\bmodel:(\S+)/)?.[1] }] : [];
  });
}

function main() {
  const env = loadEnv('apk-development', clientDir, 'VITE_');
  const serverUrl = resolveApkServerUrl(env.VITE_SERVER_URL, 'serve');
  const android = JSON.parse(readFileSync(join(clientDir, 'src-tauri', 'tauri.android.conf.json'), 'utf8'));
  const adb = adbExecutable();
  const devices = androidDevices(adb);
  const serial = process.env.ANDROID_SERIAL || (devices.length === 1 ? devices[0].serial : '');
  if (!devices.some(device => device.serial === serial)) {
    throw new Error('没有唯一可用的调试目标，请运行 npm run android 选择设备，或设置有效的 ANDROID_SERIAL。');
  }

  for (const port of androidDevPorts(android.build.devUrl, serverUrl)) {
    execFileSync(adb, ['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`], { stdio: 'inherit', timeout: 10_000 });
    console.log(`Android 调试端口已转发：${serial} → ${port}`);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(`Android 调试端口配置失败：${error.message}`);
    process.exitCode = 1;
  }
}
