import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectNativeLibrary } from './desktop.mjs';
const work = resolve(dirname(fileURLToPath(import.meta.url)), '../../../work/launcher-tests');
mkdirSync(work,{recursive:true});
test('stale project override uses the newest project DLL',()=>{
 const root=mkdtempSync(join(work,'native-'));
 const old=join(root,'native/build/Release/music_native.dll'),fresh=join(root,'native/build-auto/Release/music_native.dll');
 for(const file of [old,fresh]){mkdirSync(dirname(file),{recursive:true});writeFileSync(file,'fixture');}
 utimesSync(old,100,100);utimesSync(fresh,200,200);
 assert.equal(selectNativeLibrary(root,'win32',old),fresh);
 assert.equal(selectNativeLibrary(root,'win32',undefined),fresh);
});
test('custom external override is preserved instead of silently changing libraries',()=>{
 const root=mkdtempSync(join(work,'override-'));const external=join(work,'external/music_native.dll');
 assert.equal(selectNativeLibrary(root,'win32',external),external);
 assert.equal(selectNativeLibrary(root,'win32',undefined),undefined);
});
