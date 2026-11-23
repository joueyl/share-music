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

function main() {
  const env = loadEnv('apk-development', clientDir, 'VITE_');
  const serverUrl = resolveApkServerUrl(env.VITE_SERVER_URL, 'serve');
  const android = JSON.parse(readFileSync(join(clientDir, 'src-tauri', 'tauri.android.conf.json'), 'utf8'));
  const executable = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const adb = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]
    .filter(Boolean)
    .map(sdk => join(sdk, 'platform-tools', executable))
    .find(existsSync) ?? executable;

  for (const port of androidDevPorts(android.build.devUrl, serverUrl)) {
    execFileSync(adb, ['reverse', `tcp:${port}`, `tcp:${port}`], { stdio: 'inherit', timeout: 10_000 });
    console.log(`Android 调试端口已转发：${port}`);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(`Android 调试端口配置失败：${error.code ?? error.status ?? error.message}。请确认 SDK 的 adb 可用，且已连接一台可调试设备；多设备时设置 ANDROID_SERIAL。`);
    process.exitCode = 1;
  }
}
