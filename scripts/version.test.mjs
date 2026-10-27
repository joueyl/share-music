import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validVersion, nextVersion, releaseNotes, shanghaiDate, versionPlan, checkVersions, setVersion } from './version.mjs';
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'music-share-version-test-'));
 t.after(()=>{assert.equal(dirname(resolve(root)),resolve(tmpdir()));assert.ok(basename(root).startsWith('music-share-version-test-'));rmSync(root,{recursive:true,force:true});});
 for(const path of [...versionPlan(project,JSON.parse(readFileSync(join(project,'package.json'),'utf8')).version).keys(),'CHANGELOG.md']){
  mkdirSync(dirname(join(root,path)),{recursive:true});copyFileSync(join(project,path),join(root,path));
 }
 const current=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version;
 writeFileSync(join(root,'CHANGELOG.md'),`# 更新日志\n\n## [未发布]\n\n### 新增\n- 测试功能\n\n## [${current}]\n\n### 说明\n- 历史基线\n`);
 return root;
}
const read=(root,path)=>readFileSync(join(root,path),'utf8');
test('validates versions and calculates major/minor/patch without downgrades',()=>{
 assert.equal(nextVersion('0.1.1','patch'),'0.1.2');assert.equal(nextVersion('0.1.1','minor'),'0.2.0');assert.equal(nextVersion('0.1.1','major'),'1.0.0');
 for(const value of ['01.2.3','v1.2.3','1.2','-1.2.3','1.2.3-beta','1.2.3\n','9007199254740992.0.0'])assert.equal(validVersion(value),false);
 for(const value of ['0.1.0','0.1.1','bad'])assert.throws(()=>nextVersion('0.1.1',value));
});
test('repository versions and current changelog entry stay consistent',()=>{assert.ok(validVersion(checkVersions(project)));});
test('syncs manifests, local references and both locks without altering third-party versions',t=>{
 const root=fixture(t),before=JSON.parse(read(root,'package-lock.json'));
 const version=JSON.parse(read(root,'package.json')).version;
 const client=JSON.parse(read(root,'apps/client/package.json'));client.version='0.0.1';writeFileSync(join(root,'apps/client/package.json'),JSON.stringify(client));
 assert.throws(()=>checkVersions(root),/版本不一致/);setVersion(root,undefined,{sync:true});assert.equal(checkVersions(root),version);
 const after=JSON.parse(read(root,'package-lock.json'));assert.deepEqual(after.packages['node_modules/vue'],before.packages['node_modules/vue']);
});
test('prepares a release, archives pending notes once and exports GitHub Markdown',t=>{
 const root=fixture(t),current=checkVersions(root),next=nextVersion(current,'patch');
 assert.equal(setVersion(root,'patch',{date:'2026-10-27'}),next);assert.equal(checkVersions(root),next);
 const changelog=read(root,'CHANGELOG.md');assert.ok(changelog.includes(`## [${next}] - 2026-10-27`));
 assert.match(releaseNotes(changelog,next),/### 新增/);assert.match(releaseNotes(changelog,current),/历史/);
 assert.throws(()=>setVersion(root,'patch'),/未发布/);assert.equal(checkVersions(root),next);
});
test('rejects empty pending notes and invalid versions before changing any version file',t=>{
 const root=fixture(t),before=read(root,'package.json');
 writeFileSync(join(root,'CHANGELOG.md'),'# 更新日志\n\n## [未发布]\n');
 assert.throws(()=>setVersion(root,'patch'));assert.equal(read(root,'package.json'),before);
 assert.throws(()=>setVersion(root,'../../outside'));assert.equal(read(root,'package.json'),before);
});
test('does not partially update when an input lockfile is malformed',t=>{
 const root=fixture(t),before=read(root,'package.json');writeFileSync(join(root,'package-lock.json'),'{bad');
 assert.throws(()=>setVersion(root,'patch'));assert.equal(read(root,'package.json'),before);
});
test('uses Shanghai calendar dates and extracts CRLF changelogs',()=>{
 assert.equal(shanghaiDate(new Date('2026-10-26T17:00:00Z')),'2026-10-27');
 assert.equal(releaseNotes('## [0.1.2] - 2026-10-27\r\n\r\n### 新增\r\n- 测试\r\n\r\n## [0.1.1]\r\n- 旧版','0.1.2'),'### 新增\n- 测试\n');
 assert.throws(()=>releaseNotes('## [0.1.1]\n- 旧版','0.1.2'));
});
