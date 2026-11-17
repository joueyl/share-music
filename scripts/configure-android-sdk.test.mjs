import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configureAndroidSdk } from './configure-android-sdk.mjs';

test('pins both SDK levels and build tools without changing the minimum SDK',()=>{
 const source='android {\n    compileSdk = 37\n    defaultConfig {\n        minSdk = 24\n        targetSdk = 37\n    }\n}\n';
 const output=configureAndroidSdk(source,'36','36.0.0');
 assert.match(output,/compileSdk = 36\n    buildToolsVersion = "36.0.0"/);
 assert.match(output,/targetSdk = 36/);assert.match(output,/minSdk = 24/);
 assert.equal(configureAndroidSdk(output,'36','36.0.0'),output);
});
test('replaces an existing build tools version rather than adding another',()=>{
 const output=configureAndroidSdk('compileSdk = 37\nbuildToolsVersion = "37.0.0"\ntargetSdk = 37\n','36','36.0.0');
 assert.equal([...output.matchAll(/buildToolsVersion/g)].length,1);
 assert.match(output,/buildToolsVersion = "36.0.0"/);
});
test('refuses missing or ambiguous template fields and invalid versions',()=>{
 for(const source of ['compileSdk = 37','compileSdk = 37\ncompileSdk = 37\ntargetSdk = 37'])assert.throws(()=>configureAndroidSdk(source,'36','36.0.0'));
 assert.throws(()=>configureAndroidSdk('compileSdk = 37\ntargetSdk = 37','36\nextra','36.0.0'));
});
