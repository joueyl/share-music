import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkVersions } from './version.mjs';
import { publicServerUrl, validateRelease } from './ci-release.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(resolve(root,path),'utf8');
try {
 const version=checkVersions(root);
 validateRelease(version,process.env.GITHUB_EVENT_NAME,process.env.GITHUB_REF);
 const required=[
  'apps/client/src-tauri/tauri.android.conf.json',
  'apps/client/.env.android-preview',
  'apps/client/apk.html',
  'apps/client/src/apk/main.ts',
  'apps/client/src/apk/ApkApp.vue',
 ];
 const missing=required.filter(path=>!existsSync(resolve(root,path)));
 if(!read('apps/client/src-tauri/src/lib.rs').includes('tauri::mobile_entry_point'))missing.push('Rust Android mobile_entry_point');
 if(missing.length)throw new Error(`Android 试用打包前置文件缺失：${missing.join('、')}。见 docs/ANDROID-APK.md。`);
 const config=JSON.parse(read('apps/client/src-tauri/tauri.android.conf.json'));
 if(config.build?.frontendDist!=='../dist-apk'||config.build?.beforeBuildCommand!=='npm run build:apk')throw new Error('Android 必须使用 APK 独立入口与 dist-apk 产物');
 const fallback=/^VITE_SERVER_URL=(.*)$/m.exec(read('apps/client/.env.production'))?.[1]?.trim();
 const serverUrl=publicServerUrl(process.env.CLIENT_SERVER_URL||fallback);
 if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`version=${version}\n`);
 if(process.env.GITHUB_ENV)appendFileSync(process.env.GITHUB_ENV,`VITE_SERVER_URL=${serverUrl}\n`);
 console.log(`Android 构建前置检查通过：v${version}（不代表编译或实机验收通过）`);
} catch(error) {
 console.error(error.message);
 process.exitCode=1;
}
