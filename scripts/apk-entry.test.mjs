import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,existsSync,mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve,dirname,basename } from 'node:path';
import { checkApkBuild } from './check-apk-build.mjs';
import { apkEntryPlugin } from '../apps/client/apk-entry.ts';
import { androidDevPorts } from '../apps/client/android-dev-forward.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('desktop and APK use distinct documents, page trees and output directories',()=>{
 assert.match(read('apps/client/index.html'),/src\/main.ts/);
 assert.match(read('apps/client/apk.html'),/src\/apk\/main.ts/);
 const entry=read('apps/client/src/apk/main.ts');assert.doesNotMatch(entry,/\.\.\/App.vue|\.\.\/views\/|\.\.\/(?:style|tone|brilliant|adaptive-layout|responsive)\.css/);
 assert.match(entry,/\.\/pages\/DiscoverPage.vue/);assert.match(entry,/\.\/pages\/ListenPage.vue/);assert.match(entry,/\.\/pages\/MusicPage.vue/);
 const config=JSON.parse(read('apps/client/src-tauri/tauri.android.conf.json'));
 assert.equal(config.build.frontendDist,'../dist-apk');assert.equal(config.build.beforeBuildCommand,'npm run build:apk');
 assert.match(read('apps/client/apk-entry.ts'),/getModuleIds/);
 const pkg=JSON.parse(read('apps/client/package.json'));
 assert.match(pkg.scripts['dev:apk'],/--mode apk-development/);
 assert.match(pkg.scripts['build:apk'],/--mode android-preview/);
 assert.match(read('apps/client/.env.apk-development'),/^VITE_SERVER_URL=http:\/\/127\.0\.0\.1:3000$/m);
});
test('business controllers are single-source and consumed by both page trees',()=>{
 for(const [hook,desktop,apk] of [
  ['useAccountAuth','components/AuthPage.vue','apk/pages/LoginPage.vue'],
  ['useRoomDiscovery','views/Lobby.vue','apk/pages/DiscoverPage.vue'],
  ['useMusicLibrary','views/Playlists.vue','apk/pages/MusicPage.vue'],
  ['usePlayerControls','components/GlobalPlayer.vue','apk/components/ApkPlayer.vue'],
  ['useRoomSession','views/Room.vue','apk/pages/ListenPage.vue'],
 ]){assert.match(read('apps/client/src/'+desktop),new RegExp(hook+'\\(\\)'));assert.match(read('apps/client/src/'+apk),new RegExp(hook+'\\(\\)'));assert.match(read('apps/client/src/features/'+hook+'.ts'),new RegExp('export function '+hook));}
});
test('native Android dev uses the independent APK entry over loopback without opening a browser',()=>{
 const root=JSON.parse(read('package.json'));
 const client=JSON.parse(read('apps/client/package.json'));
 const android=JSON.parse(read('apps/client/src-tauri/tauri.android.conf.json'));
 const desktop=JSON.parse(read('apps/client/src-tauri/tauri.conf.json'));
 assert.equal(root.scripts.android,'npm run tauri -w @music-share/client -- android dev --host 127.0.0.1');
 assert.equal(android.build.devUrl,'http://127.0.0.1:11421');
 assert.equal(android.build.beforeDevCommand,'npm run dev:android-webview');
 assert.equal(client.scripts['dev:android-webview'],'node android-dev-forward.mjs && vite --mode apk-development --host 127.0.0.1 --port 11421');
 assert.doesNotMatch(client.scripts['dev:apk'],/android-dev-forward/);
 assert.equal(desktop.build.devUrl,'http://127.0.0.1:11420');
});
test('Android debug forwards the frontend and configured local API port only',()=>{
 const frontend='http://127.0.0.1:11421';
 assert.deepEqual(androidDevPorts(frontend,'http://127.0.0.1:3000'),['11421','3000']);
 assert.deepEqual(androidDevPorts(frontend,'http://localhost:3100'),['11421','3100']);
 assert.deepEqual(androidDevPorts(frontend,'http://[::1]:3100'),['11421','3100']);
 assert.deepEqual(androidDevPorts(frontend,'https://api.example.test'),['11421']);
 assert.deepEqual(androidDevPorts(frontend,'http://127.0.0.1:11421'),['11421']);
});
test('APK dev proxy serves APK HTML for the root without rewriting module requests',()=>{
 let middleware;
 apkEntryPlugin().configureServer({middlewares:{use:fn=>{middleware=fn;}}});
 for(const [method,url,expected] of [
  ['GET','/','/apk.html'],
  ['HEAD','/index.html?from=android','/apk.html?from=android'],
  ['GET','/apk.html','/apk.html'],
  ['GET','/@vite/client','/@vite/client'],
  ['GET','/src/apk/main.ts','/src/apk/main.ts'],
  ['POST','/','/'],
 ]){
  const req={method,url};
  let next=false;
  middleware(req,{},()=>{next=true;});
  assert.equal(req.url,expected);
  assert.equal(next,true);
 }
});
test('Actions builds stripped non-debuggable Release APKs with test signing only',()=>{
 assert.equal(existsSync(new URL('../.github/workflows/android-apk.yml',import.meta.url)),false);
 const yaml=read('.github/workflows/desktop-release.yml').replace(/\r\n/g,'\n');for(const expected of ['workflow_dispatch:','build:apk','check-apk-build.mjs','needs: verify','src-tauri/tauri.android.conf.json','apksigner','upload-artifact@v4'])assert.ok(yaml.includes(expected),expected);
 const android=yaml.slice(yaml.indexOf('  android:\n'),yaml.indexOf('  release-draft:\n'));
 assert.doesNotMatch(android,/TAURI_SIGNING_PRIVATE_KEY|KEYSTORE_PASSWORD|gh release/);
 assert.doesNotMatch(android,/android build[^\n]*--debug|\*\/debug\/\*/);
 for(const expected of ['configure-android-test-release.mjs','check-android-release.mjs','CARGO_PROFILE_RELEASE_DEBUG: \'0\'','CARGO_PROFILE_RELEASE_STRIP: symbols','CARGO_PROFILE_RELEASE_OPT_LEVEL: s','CARGO_PROFILE_RELEASE_LTO: thin','CARGO_PROFILE_RELEASE_CODEGEN_UNITS: \'1\'','*/release/*','application-debuggable','CN=Android Debug','android-arm64-release-testsigned'])assert.ok(android.includes(expected),expected);
 const desktop=yaml.slice(yaml.indexOf('  build:\n'),yaml.indexOf('  android:\n'));assert.doesNotMatch(desktop,/CARGO_PROFILE_RELEASE/);
 assert.match(yaml,/needs: \[build, build-unix, android\]/);
});
test('Android enables only scoped secure-login IPC with Keystore ciphertext and no plaintext fallback',()=>{
 const native=read('apps/client/src-tauri/src/lib.rs');assert.match(native,/plugin\(tauri_plugin_saved_login::init\(\)\)/);
 const capability=JSON.parse(read('apps/client/src-tauri/capabilities/android-login.json'));
 assert.deepEqual(capability.platforms,['android']);assert.deepEqual(capability.windows,['main']);assert.deepEqual(capability.permissions,['saved-login:default']);assert.equal(capability.remote,undefined);
 const plugin=read('apps/client/src-tauri/plugins/saved-login/android/src/main/java/com/musicshare/savedlogin/SavedLoginPlugin.kt');
 for(const value of ['AndroidKeyStore','AES/GCM/NoPadding','noBackupFilesDir','setRandomizedEncryptionRequired(true)','updateAAD(aad)','newSingleThreadExecutor','plain.fill(0)','clearStorage()','validate(credentials)'])assert.ok(plugin.includes(value),value);
 assert.doesNotMatch(plugin,/getSharedPreferences|localStorage|Log\.|printStackTrace|invoke\.reject\(error/);
 const mac=read('apps/client/src-tauri/src/saved_login.rs');assert.match(mac,/#\[cfg\(target_os = "macos"\)\]/);assert.match(mac,/generic_password/);assert.match(mac,/Err\(error\) if error.code\(\) == NOT_FOUND/);
 assert.match(read('apps/client/src/apk/pages/LoginPage.vue'),/v-model="remember"/);
 const commands=read('apps/client/src-tauri/plugins/saved-login/src/lib.rs');
 for(const name of ['can_remember_login','load_saved_login','save_login','clear_saved_login'])assert.match(commands,new RegExp('async fn '+name+'<R: Runtime>\\(_app: tauri::AppHandle<R>'));
});
test('APK artifact guard rejects a desktop document and missing assets',()=>{
 const root=mkdtempSync(resolve(tmpdir(),'tone-apk-entry-'));
 try{const dist=resolve(root,'apps/client/dist-apk');mkdirSync(resolve(dist,'assets'),{recursive:true});writeFileSync(resolve(dist,'client-target.json'),JSON.stringify({target:'apk',entry:'src/apk/main.ts',desktopModules:0}));writeFileSync(resolve(dist,'index.html'),'<html data-client="apk"><script src="/assets/app.js"></script></html>');
  assert.throws(()=>checkApkBuild(root),/入口脚本/);writeFileSync(resolve(dist,'assets/app.js'),'console.log("apk")');assert.equal(checkApkBuild(root).target,'apk');writeFileSync(resolve(dist,'index.html'),'<html><script src="/src/main.ts"></script></html>');assert.throws(()=>checkApkBuild(root),/独立入口/);
 }finally{const target=resolve(root);assert.equal(dirname(target),resolve(tmpdir()));assert.ok(basename(target).startsWith('tone-apk-entry-'));rmSync(target,{recursive:true,force:true});}
});
