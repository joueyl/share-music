import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync, rmSync, renameSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { versionPlan } from './version.mjs';
import { validateRelease, publicServerUrl, prepareRelease, collectRelease, mergeRelease, RELEASE_TARGETS, validateBuildHost } from './ci-release.mjs';
import { syntheticSigning } from './test-fixtures/updater-signing.mjs';
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=(root,path)=>readFileSync(join(root,path),'utf8');
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'music-share-ci-test-'));
 t.after(()=>{assert.equal(dirname(resolve(root)),resolve(tmpdir()));assert.ok(basename(root).startsWith('music-share-ci-test-'));rmSync(root,{recursive:true,force:true});});
 const version=JSON.parse(read(project,'package.json')).version;
 for(const path of [...versionPlan(project,version).keys(),'CHANGELOG.md','apps/client/.env.production']){
  mkdirSync(dirname(join(root,path)),{recursive:true});copyFileSync(join(project,path),join(root,path));
 }
 const nsis=join(root,'apps/client/src-tauri/target/release/bundle/nsis');mkdirSync(nsis,{recursive:true});
 return {root,version,nsis};
}
test('tag must match the prepared application version, not arbitrary branch or tag text',()=>{
 validateRelease('0.1.2','push','refs/tags/v0.1.2');validateRelease('0.1.2','workflow_dispatch','refs/heads/main');
 for(const ref of ['refs/tags/v0.1.1','refs/tags/v0.1.2-rc.1','refs/heads/main','refs/tags/v0.1.2\nX=bad'])assert.throws(()=>validateRelease('0.1.2','push',ref));
});
test('requires the actual build OS and architecture rather than mislabelling packages',()=>{
 for(const [target,os,arch] of [['windows-x64','win32','x64'],['linux-x64','linux','x64'],['macos-x64','darwin','x64'],['macos-arm64','darwin','arm64']])validateBuildHost(target,os,arch);
 assert.throws(()=>validateBuildHost('macos-arm64','darwin','x64'),/不匹配/);
 assert.throws(()=>validateBuildHost('linux-x64','win32','x64'),/不匹配/);
});
test('accepts only a public HTTPS origin without credentials, path, or environment injection',()=>{
 assert.equal(publicServerUrl('https://music.example.com:8443/'),'https://music.example.com:8443');
 for(const value of ['',undefined,'http://example.com','https://user:password@example.com','https://example.com/api','https://example.com?q=a','https://example.com#x','https://example.com\nX=bad'])assert.throws(()=>publicServerUrl(value));
});
test('writes validated workflow outputs and uses the repository public URL as a fallback',t=>{
 const f=fixture(t),output=join(f.root,'output'),envFile=join(f.root,'env');
 const result=prepareRelease(f.root,{GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_OUTPUT:output,GITHUB_ENV:envFile});
 assert.equal(result.version,f.version);assert.match(result.serverUrl,/^https:/);
 assert.equal(readFileSync(output,'utf8'),`version=${f.version}\n`);
 assert.equal(readFileSync(envFile,'utf8'),`VITE_SERVER_URL=${result.serverUrl}\n`);
});
test('rejects mismatched tags and bad server URLs before writing action output',t=>{
 const f=fixture(t),output=join(f.root,'output');writeFileSync(output,'original');
 assert.throws(()=>prepareRelease(f.root,{GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/tags/v99.0.0',GITHUB_OUTPUT:output}));
 assert.throws(()=>prepareRelease(f.root,{CLIENT_SERVER_URL:'https://example.com\nTOKEN=bad',GITHUB_OUTPUT:output}));
 assert.equal(readFileSync(output,'utf8'),'original');
});
test('collects only the installer, its real SHA-256 and versioned changelog, refusing stale artifacts',async t=>{
 const f=fixture(t),bytes=Buffer.from('installer fixture');writeFileSync(join(f.nsis,'Music Share setup.exe'),bytes);writeFileSync(join(f.nsis,'not-for-release.txt'),'ignored');
 const result=await collectRelease(f.root,'windows-x64',{});
 assert.deepEqual(readdirSync(result.output).sort(),[result.name,'RELEASE-NOTES.md','SHA256SUMS-windows-x64.txt'].sort());
 assert.equal(readFileSync(join(result.output,result.name)).equals(bytes),true);
 assert.equal(readFileSync(join(result.output,'SHA256SUMS-windows-x64.txt'),'utf8'),`${createHash('sha256').update(bytes).digest('hex')}  ${result.name}\n`);
 assert.ok(readFileSync(join(result.output,'RELEASE-NOTES.md'),'utf8').startsWith(`# 共鸣 Music Share v${f.version}`));
 await assert.rejects(collectRelease(f.root,'windows-x64',{}),/非空/);
});
test('fails on absent or ambiguous installers rather than uploading a wrong package',async t=>{
 const f=fixture(t);await assert.rejects(collectRelease(f.root,'windows-x64',{}),/恰好一个/);
 writeFileSync(join(f.nsis,'old.exe'),'old');writeFileSync(join(f.nsis,'new.exe'),'new');
 await assert.rejects(collectRelease(f.root,'windows-x64',{}),/恰好一个/);
});
test('workflow waits for Windows and every Unix matrix build and gives build jobs no write token',()=>{
 const workflow=read(project,'.github/workflows/desktop-release.yml').replace(/\r\n/g,'\n');
 assert.equal(existsSync(join(project,'.github/workflows/windows-release.yml')),false);
 assert.match(workflow,/workflow_dispatch:/);assert.match(workflow,/contents: read/);assert.match(workflow,/needs: \[build, build-unix\]/);assert.match(workflow,/--draft --verify-tag/);
 assert.doesNotMatch(workflow,/pull_request_target/);assert.match(workflow,/if-no-files-found: error/);
 const secrets=[...workflow.matchAll(/secrets\.([A-Z_]+)/g)].map(match=>match[1]);
 assert.ok(secrets.every(name=>['TAURI_SIGNING_PRIVATE_KEY','TAURI_SIGNING_PRIVATE_KEY_PASSWORD'].includes(name)));
 assert.ok(workflow.indexOf('npm test')<workflow.indexOf('npm run package:win\n'));
 for(const label of ['ubuntu-22.04','macos-15-intel','macos-15'])assert.ok(workflow.includes(`runner: ${label}`));
 for(const target of ['linux-x64','macos-x64','macos-arm64'])assert.ok(workflow.includes(`target: ${target}`));
 assert.match(workflow,/fail-fast: false/);assert.match(workflow,/node scripts\/ci-release.mjs merge/);
 assert.match(workflow,/sudo apt-get install -y[^\n]*\bnasm\b/);
 assert.match(workflow,/sudo apt-get install -y[^\n]*\bautoconf autoconf-archive automake libtool\b/);
 assert.match(workflow,/brew install[^\n]*\bnasm\b/);
});

async function allArtifacts(t,signing){
 const f=fixture(t),downloaded=join(f.root,'downloaded-artifacts');mkdirSync(downloaded);
 for(const [target,baseFormats]of Object.entries(RELEASE_TARGETS)){
  const formats=[...baseFormats];if(signing&&target.startsWith('macos'))formats.push({directory:'macos',extension:'.app.tar.gz'});
  for(const format of formats){const directory=join(f.root,'apps/client/src-tauri/target/release/bundle',format.directory);mkdirSync(directory,{recursive:true});const path=join(directory,`fixture${format.extension}`),data=Buffer.from(`${target}${format.extension}`);writeFileSync(path,data);if(signing&&['.exe','.AppImage','.app.tar.gz'].includes(format.extension))writeFileSync(path+'.sig',signing.signature(data));}
  const result=await collectRelease(f.root,target,signing?{UPDATER_PUBLIC_KEY:signing.key}:{}),destination=join(downloaded,`music-share-${target}-${f.version}`);
  assert.ok(resolve(result.output).startsWith(resolve(f.root)+sep));
  assert.ok(resolve(destination).startsWith(resolve(f.root)+sep));
  mkdirSync(destination);
  for(const name of readdirSync(result.output))copyFileSync(join(result.output,name),join(destination,name));
  rmSync(result.output,{recursive:true,force:true,maxRetries:3,retryDelay:50});
 }
 return {...f,downloaded};
}
test('collects Linux DEB/AppImage and two distinct macOS architecture packages then verifies all five installers',async t=>{
 const f=await allArtifacts(t),result=await mergeRelease(f.root,{});
 assert.equal(result.files.length,5);assert.equal(new Set(result.files).size,5);
 assert.equal(readdirSync(result.output).length,7);
 for(const target of ['macos-x64','macos-arm64'])assert.ok(result.files.some(name=>name.endsWith(`${target}.dmg`)));
 assert.equal(read(result.output,'SHA256SUMS.txt').trim().split('\n').length,5);
});
test('refuses corrupted installers before writing a merged release',async t=>{
 const f=await allArtifacts(t),target='linux-x64',directory=join(f.downloaded,`music-share-${target}-${f.version}`);
 writeFileSync(join(directory,`music-share-${f.version}-${target}.deb`),'corrupted');
 await assert.rejects(mergeRelease(f.root,{}),/SHA-256/);assert.equal(existsSync(join(f.root,'release-artifacts')),false);
});

test('merges Windows CRLF notes with Unix LF notes without accepting changed content',async t=>{
 const f=await allArtifacts(t),path=join(f.downloaded,`music-share-windows-x64-${f.version}`,'RELEASE-NOTES.md');
 writeFileSync(path,readFileSync(path,'utf8').replace(/\r?\n/g,'\r\n'));
 const result=await mergeRelease(f.root,{});
 assert.equal(result.files.length,5);
 assert(!read(result.output,'RELEASE-NOTES.md').includes('\r'));
});
test('refuses mismatched notes, incomplete platform sets and unsupported targets',async t=>{
 const f=await allArtifacts(t),directory=join(f.downloaded,`music-share-macos-arm64-${f.version}`);
 writeFileSync(join(directory,'RELEASE-NOTES.md'),'wrong version');
 await assert.rejects(mergeRelease(f.root,{}),/版本说明不匹配/);
 assert.ok(resolve(directory).startsWith(resolve(f.root)+sep));
 assert.ok(resolve(join(f.downloaded,'stale-version')).startsWith(resolve(f.root)+sep));
 renameSync(directory,join(f.downloaded,'stale-version'));
 await assert.rejects(mergeRelease(f.root,{}),/未齐全或版本不匹配/);
 await assert.rejects(collectRelease(f.root,'../../outside',{}),/不支持/);
});
test('generates a signed four-platform latest.json for the configured repository, including macOS update archives',async t=>{
 const signing=syntheticSigning(),f=await allArtifacts(t,signing);
 const result=await mergeRelease(f.root,{UPDATER_PUBLIC_KEY:signing.key});
 const manifest=JSON.parse(read(result.output,'latest.json'));
 assert.equal(manifest.version,f.version);assert.deepEqual(Object.keys(manifest.platforms).sort(),['darwin-aarch64','darwin-x86_64','linux-x86_64','windows-x86_64']);
 assert.equal(result.files.length,11);assert.equal(readdirSync(result.output).length,14);
 for(const platform of Object.values(manifest.platforms)){assert.ok(platform.url.startsWith(`https://github.com/joueyl/share-music/releases/download/v${f.version}/`));assert.ok(platform.signature.length>100);}
 assert.ok(manifest.platforms['darwin-aarch64'].url.endsWith('.app.tar.gz'));
});
test('fails early for partial signing setup instead of exposing secrets or shipping unsigned updates',t=>{
 const f=fixture(t),signing=syntheticSigning();
 assert.throws(()=>prepareRelease(f.root,{UPDATER_PUBLIC_KEY:signing.key}),/缺少/);
 assert.throws(()=>prepareRelease(f.root,{TAURI_SIGNING_PRIVATE_KEY:'synthetic-secret'}),/缺少/);
 assert.throws(()=>prepareRelease(f.root,{UPDATER_PUBLIC_KEY:signing.key,TAURI_SIGNING_PRIVATE_KEY:'synthetic-secret',GITHUB_REPOSITORY:'other/repo'}),/仓库/);
});

test('unsigned test fixtures stay isolated when Actions exports an updater public key',async t=>{
 const previous=process.env.UPDATER_PUBLIC_KEY;
 try{
  process.env.UPDATER_PUBLIC_KEY=syntheticSigning().key;
  const f=await allArtifacts(t),result=await mergeRelease(f.root,{});
  assert.equal(result.files.length,5);
  assert.equal(existsSync(join(result.output,'latest.json')),false);
 }finally{
  if(previous===undefined)delete process.env.UPDATER_PUBLIC_KEY;
  else process.env.UPDATER_PUBLIC_KEY=previous;
 }
});
