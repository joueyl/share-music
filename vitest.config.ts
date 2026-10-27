import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
const clientVue=vue();
// Component tests use a custom Vue host in Node, not server-rendered templates.
const transform=clientVue.transform as {handler:Function};
const transformComponent=transform.handler;
transform.handler=function(code:string,id:string,options:object){return transformComponent.call(this,code,id,{...options,ssr:false});};
export default defineConfig({ plugins: [clientVue], test: { include: ['apps/server/test/**/*.test.ts', 'packages/shared/test/**/*.test.ts', 'apps/client/test/**/*.test.ts'], fileParallelism: false } });
