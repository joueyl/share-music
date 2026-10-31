import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clientVue=vue();
// Component tests use a custom Vue host in Node, not server-rendered templates.
const transform=clientVue.transform as {handler:Function};
const transformComponent=transform.handler;
transform.handler=function(code:string,id:string,options:object){return transformComponent.call(this,code,id,{...options,ssr:false});};

const here = path.dirname(fileURLToPath(import.meta.url));
const clientModules = path.resolve(here, 'apps/client/node_modules');
// pnpm 把 workspace 依赖隔离在 apps/client/node_modules 下，而 vitest 从仓库根启动：
// externalized 的包会改从 vitest 自身位置解析，于是找不到 vue / pinia 等。
// 这里把客户端依赖重定向回它们真正所在的目录（正则用 lookahead，vue 不会误吞 vue-router）。
const CLIENT_DEPS = ['@music-share/shared', '@vue/compiler-sfc', 'lucide-vue-next', 'music-metadata', 'pinia', 'three', 'vue-router', 'vue'];
const clientDepAlias = CLIENT_DEPS.map(name => ({
  find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=/|$)`),
  replacement: path.resolve(clientModules, name)
}));

export default defineConfig({
  plugins: [clientVue],
  resolve: { alias: clientDepAlias },
  test: { include: ['apps/server/test/**/*.test.ts', 'packages/shared/test/**/*.test.ts', 'apps/client/test/**/*.test.ts'], fileParallelism: false }
});
