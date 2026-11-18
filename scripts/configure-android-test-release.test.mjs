import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configureAndroidTestRelease } from './configure-android-test-release.mjs';
const template=`plugins { id("com.android.application") }
android {
    compileSdk = 36
    buildTypes {
        getByName("debug") { isDebuggable = true }
        getByName("release") {
            optimization { enable = true }
            proguardFiles(*fileTree(".") { include("**/*.pro") }.files.toTypedArray())
        }
    }
}
apply(from = file("tauri.build.gradle.kts"))
`;
test('keeps the generated template and appends Release-only test signing without embedded keys',()=>{
 const output=configureAndroidTestRelease(template);
 assert.ok(output.startsWith(template));
 assert.match(output,/buildTypes\.getByName\("release"\)/);
 assert.match(output,/signingConfig = signingConfigs.getByName\("debug"\)/);
 assert.match(output,/isDebuggable = false/);assert.match(output,/isJniDebuggable = false/);
 assert.match(output,/usesCleartextTraffic"\] = "false"/);
 assert.doesNotMatch(output,/storePassword|keyPassword|keyAlias|storeFile/);
 assert.equal(configureAndroidTestRelease(output),output);
 assert.equal(configureAndroidTestRelease(template.replaceAll('\n','\r\n')).includes('signingConfig = signingConfigs.getByName("debug")'),true);
});
test('refuses missing, ambiguous or non-app templates instead of silently producing an unsigned package',()=>{
 for(const source of ['',template.replace('com.android.application','com.android.library'),template.replace('getByName("release")','getByName("other")'),template+'getByName("release") {}',template+'// tone-test-signed-release:begin',template+'// tone-test-signed-release:end\n// tone-test-signed-release:begin'])assert.throws(()=>configureAndroidTestRelease(source));
});
