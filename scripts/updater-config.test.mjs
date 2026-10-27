import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syntheticSigning } from './test-fixtures/updater-signing.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicKey, withUpdater, UPDATE_ENDPOINT } from './updater-config.mjs';
import { verifyUpdateFile } from './verify-update.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function fixture(t){const directory=mkdtempSync(join(tmpdir(),'music-share-signature-test-'));t.after(()=>{assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(basename(directory).startsWith('music-share-signature-test-'));rmSync(directory,{recursive:true,force:true});});return directory;}
test('uses the supplied repository and only enables updater artifacts with a public key and signing secret',()=>{
 const {key}=syntheticSigning();assert.equal(publicKey(key),key);assert.equal(withUpdater({bundle:{targets:['nsis']}},root,{}).bundle.createUpdaterArtifacts,false);
 assert.throws(()=>withUpdater({},root,{UPDATER_PUBLIC_KEY:key}),/缺少/);
 assert.throws(()=>withUpdater({},root,{TAURI_SIGNING_PRIVATE_KEY:'synthetic-secret'}),/缺少/);
 const config=withUpdater({bundle:{targets:['nsis']}},root,{UPDATER_PUBLIC_KEY:key,TAURI_SIGNING_PRIVATE_KEY:'synthetic-secret'});
 assert.equal(config.bundle.createUpdaterArtifacts,true);assert.deepEqual(config.bundle.targets,['nsis']);assert.deepEqual(config.plugins.updater.endpoints,[UPDATE_ENDPOINT]);
 assert.ok(UPDATE_ENDPOINT.includes('/joueyl/share-music/'));
 for(const value of ['C:/secret/key.pub','https://example.com/pub','not a public key'])assert.throws(()=>publicKey(value));
});
test('verifies Minisign data and trusted comments, rejects mismatched keys or modified files',async t=>{
 const dir=fixture(t),path=join(dir,'test.bin'),data=Buffer.from('test update'),signing=syntheticSigning(),signature=signing.signature(data);writeFileSync(path,data);
 assert.equal(await verifyUpdateFile(path,signature,signing.key),signature);
 await assert.rejects(verifyUpdateFile(path,signature,syntheticSigning().key),/签名/);
 writeFileSync(path,'modified');await assert.rejects(verifyUpdateFile(path,signature,signing.key),/签名/);
 await assert.rejects(verifyUpdateFile(path,'not a signature',signing.key),/格式/);
});

test('accepts the independent prehashed test vector from minisign-verify 0.3.0',async t=>{
 // Public test vector from the upstream crate used by Tauri; no private key.
 const dir=fixture(t),path=join(dir,'test');writeFileSync(path,'test');
 const key=Buffer.from('untrusted comment: minisign public key E7620F1842B4E81F\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3\n').toString('base64');
 const text='untrusted comment: signature from minisign secret key\nRUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\ntrusted comment: timestamp:1556193335\tfile:test\ny/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg==\n';
 const signature=Buffer.from(text).toString('base64');
 assert.equal(await verifyUpdateFile(path,signature,key),signature);
 await assert.rejects(verifyUpdateFile(path,Buffer.from(text.replace('timestamp:1556193335','timestamp:1556193336')).toString('base64'),key),/签名/);
});
