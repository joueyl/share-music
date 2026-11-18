import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve,dirname,basename } from 'node:path';
import { checkApkBuild } from './check-apk-build.mjs';
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
test('Actions checks both clients before packaging the explicit Android config and uploads a debug artifact',()=>{
 const yaml=read('.github/workflows/android-apk.yml');for(const expected of ['workflow_dispatch:','build:apk','check-apk-build.mjs','needs: frontend','src-tauri/tauri.android.conf.json','apksigner','upload-artifact@v4'])assert.ok(yaml.includes(expected),expected);
 assert.doesNotMatch(yaml,/TAURI_SIGNING_PRIVATE_KEY|KEYSTORE_PASSWORD|gh release/);
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
