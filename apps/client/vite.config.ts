import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({ plugins: [vue()], server: { strictPort: true }, clearScreen: false, envPrefix: ['VITE_'], build: { target: 'es2022' } });
