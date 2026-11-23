import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import tauriConfig from './src-tauri/tauri.conf.json';
import { resolveServerUrl,resolveApkServerUrl } from './src/server-config';
import { apkEntryPlugin } from './apk-entry';
export default defineConfig(({ mode,command }) => {
  const envDir = fileURLToPath(new URL('.', import.meta.url));
  const env = loadEnv(mode, envDir, 'VITE_');
  const apk = mode === 'android-preview' || mode === 'apk-development';
  if(apk)env.VITE_SERVER_URL=resolveApkServerUrl(env.VITE_SERVER_URL,command,()=>loadEnv('production',envDir,'VITE_').VITE_SERVER_URL);
  resolveServerUrl(env.VITE_SERVER_URL, mode);
  // Tauri owns native watching. Watching Cargo/Gradle build files here can hit Windows file locks.
  const server = { strictPort: true, watch: { ignored: ['**/src-tauri/target/**', '**/src-tauri/gen/android/**'] } };
  return { plugins: [vue(),...(apk?[apkEntryPlugin()]:[])], define: {'import.meta.env.VITE_CLIENT_TARGET':JSON.stringify(apk?'apk':'desktop'),...(apk?{'import.meta.env.VITE_SERVER_URL':JSON.stringify(env.VITE_SERVER_URL)}:{})}, preview:{headers:{'Content-Security-Policy':tauriConfig.app.security.csp}}, envDir, server, clearScreen: false, envPrefix: ['VITE_'], build: { target: 'es2022',outDir:apk?'dist-apk':'dist',...(apk?{rollupOptions:{input:fileURLToPath(new URL('./apk.html',import.meta.url))}}:{})} };
});
