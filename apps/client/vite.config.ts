import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import tauriConfig from './src-tauri/tauri.conf.json';
import { resolveServerUrl } from './src/server-config';
export default defineConfig(({ mode }) => {
  const envDir = fileURLToPath(new URL('.', import.meta.url));
  const env = loadEnv(mode, envDir, 'VITE_');
  resolveServerUrl(env.VITE_SERVER_URL, mode);
  return { plugins: [vue()], preview:{headers:{'Content-Security-Policy':tauriConfig.app.security.csp}}, envDir, server: { strictPort: true }, clearScreen: false, envPrefix: ['VITE_'], build: { target: 'es2022' } };
});
