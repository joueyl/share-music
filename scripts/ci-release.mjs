import { readFileSync, appendFileSync, mkdirSync, readdirSync, copyFileSync, writeFileSync, createReadStream, lstatSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { finished } from 'node:stream/promises';
import { checkVersions, releaseNotes } from './version.mjs';
import { updaterSettings, UPDATE_REPOSITORY } from './updater-config.mjs';
import { verifyUpdateFile } from './verify-update.mjs';

export function validateRelease(version,event,ref){
 if(ref?.startsWith('refs/tags/')&&ref!==`refs/tags/v${version}`)throw new Error(`标签必须与项目版本一致：v${version}`);
 if(event==='push'&&ref!==`refs/tags/v${version}`)throw new Error('自动发布仅支持版本标签');
}
export function publicServerUrl(value){
 if(typeof value!=='string'||!value||value.trim()!==value||/[\r\n]/.test(value))throw new Error('服务地址不能为空或包含换行');
 let url;try{url=new URL(value);}catch{throw new Error('服务地址必须是 HTTPS Origin');}
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('服务地址必须是 HTTPS Origin，不含凭据或路径');
 return url.origin;
}
export function prepareRelease(root,env=process.env){
 const version=checkVersions(root);validateRelease(version,env.GITHUB_EVENT_NAME,env.GITHUB_REF);
 const configured=env.CLIENT_SERVER_URL;
 const fallback=/^VITE_SERVER_URL=(.*)$/m.exec(readFileSync(join(root,'apps/client/.env.production'),'utf8'))?.[1]?.trim();
 const serverUrl=publicServerUrl(configured||fallback);
 const updater=updaterSettings(root,env);
 if(updater.enabled&&!env.TAURI_SIGNING_PRIVATE_KEY)throw new Error('更新公钥已配置，但缺少 TAURI_SIGNING_PRIVATE_KEY Secret');
 if(!updater.enabled&&env.TAURI_SIGNING_PRIVATE_KEY)throw new Error('已配置签名私钥，但缺少 UPDATER_PUBLIC_KEY Variable');
 if(updater.enabled&&env.GITHUB_REPOSITORY&&env.GITHUB_REPOSITORY!==UPDATE_REPOSITORY)throw new Error('签名发布仓库与客户端更新仓库不匹配');
 // Emit only validated single-line values; VITE_SERVER_URL is public, not a credential.
 if(env.GITHUB_OUTPUT)appendFileSync(env.GITHUB_OUTPUT,`version=${version}\n`);
 if(env.GITHUB_ENV)appendFileSync(env.GITHUB_ENV,`VITE_SERVER_URL=${serverUrl}\n`);
 if(updater.enabled&&env.GITHUB_ENV)appendFileSync(env.GITHUB_ENV,`UPDATER_PUBLIC_KEY=${updater.key}\n`);
 return {version,serverUrl};
}
export const RELEASE_TARGETS={
 'windows-x64':[{directory:'nsis',extension:'.exe'}],
 'linux-x64':[{directory:'deb',extension:'.deb'},{directory:'appimage',extension:'.AppImage'}],
 'macos-x64':[{directory:'dmg',extension:'.dmg'}],
 'macos-arm64':[{directory:'dmg',extension:'.dmg'}],
};
const UPDATE_TARGETS={
 'windows-x64':{platform:'windows-x86_64',directory:'nsis',extension:'.exe'},
 'linux-x64':{platform:'linux-x86_64',directory:'appimage',extension:'.AppImage'},
 'macos-x64':{platform:'darwin-x86_64',directory:'macos',extension:'.app.tar.gz'},
 'macos-arm64':{platform:'darwin-aarch64',directory:'macos',extension:'.app.tar.gz'},
};
function releaseFormats(target,enabled){const formats=[...targetFormats(target)];if(enabled&&!formats.some(f=>f.extension===UPDATE_TARGETS[target].extension))formats.push(UPDATE_TARGETS[target]);return formats;}
function artifactNames(version,target,enabled){const names=releaseFormats(target,enabled).map(f=>packageName(version,target,f.extension));if(enabled)names.push(packageName(version,target,UPDATE_TARGETS[target].extension)+'.sig');return names;}
function targetFormats(target){if(!Object.hasOwn(RELEASE_TARGETS,target))throw new Error('不支持的发布平台');return RELEASE_TARGETS[target];}
export function validateBuildHost(target,platform=process.platform,arch=process.arch){
 targetFormats(target);const os={win32:'windows',linux:'linux',darwin:'macos'}[platform];
 if(target!==`${os}-${arch}`)throw new Error('发布平台与实际构建主机架构不匹配');
}
function packageName(version,target,extension){return `music-share-${version}-${target}${extension}`;}
async function sha256(path){
 if(!lstatSync(path).isFile())throw new Error('发布文件必须是普通文件');
 const hash=createHash('sha256'),stream=createReadStream(path);
 for await(const chunk of stream)hash.update(chunk);
 await finished(stream,{cleanup:true}); // Release Windows file handles before moving artifacts.
 return hash.digest('hex');
}
function notesFor(root,version){return `# 共鸣 Music Share v${version}\n\n${releaseNotes(readFileSync(join(root,'CHANGELOG.md'),'utf8'),version)}`;}
function emptyOutput(root){const output=join(root,'release-artifacts');mkdirSync(output,{recursive:true});if(readdirSync(output).length)throw new Error('release-artifacts 非空，请使用干净的构建目录');return output;}
export async function collectRelease(root,target='windows-x64',env=process.env){
 const {enabled,key}=updaterSettings(root,env),formats=releaseFormats(target,enabled),version=checkVersions(root),files=[];
 for(const format of formats){
  const directory=join(root,'apps/client/src-tauri/target/release/bundle',format.directory);
  const candidates=readdirSync(directory,{withFileTypes:true}).filter(file=>file.isFile()&&file.name.endsWith(format.extension));
  if(candidates.length!==1)throw new Error(`预期恰好一个 ${format.directory} 安装包，拒绝混入旧产物`);
  if(/[\r\n]/.test(candidates[0].name))throw new Error('安装包文件名包含换行');
  const source=join(directory,candidates[0].name),name=packageName(version,target,format.extension);
  files.push({source,name,hash:await sha256(source)});
  if(enabled&&format.extension===UPDATE_TARGETS[target].extension){
   const sigSource=source+'.sig';await verifyUpdateFile(source,readFileSync(sigSource,'utf8'),key);
   files.push({source:sigSource,name:name+'.sig',hash:await sha256(sigSource)});
  }
 }
 const notes=notesFor(root,version),output=emptyOutput(root);
 for(const file of files)copyFileSync(file.source,join(output,file.name));
 writeFileSync(join(output,`SHA256SUMS-${target}.txt`),files.map(file=>`${file.hash}  ${file.name}\n`).join(''));
 writeFileSync(join(output,'RELEASE-NOTES.md'),notes);
 return {version,target,name:files[0].name,files:files.map(file=>file.name),output};
}
export async function mergeRelease(root,env=process.env){
 const {enabled,key}=updaterSettings(root,env),platforms={};
 const version=checkVersions(root),input=join(root,'downloaded-artifacts'),targets=Object.keys(RELEASE_TARGETS),notes=notesFor(root,version),files=[];
 const expected=targets.map(target=>`music-share-${target}-${version}`).sort();
 const actual=readdirSync(input,{withFileTypes:true});
 if(actual.some(file=>!file.isDirectory())||JSON.stringify(actual.map(file=>file.name).sort())!==JSON.stringify(expected))throw new Error('四个平台产物未齐全或版本不匹配');
 for(const target of targets){
  const directory=join(input,`music-share-${target}-${version}`),targetFiles=[];
  const names=artifactNames(version,target,enabled);
  const expectedFiles=[...names,`SHA256SUMS-${target}.txt`,'RELEASE-NOTES.md'].sort();
  const entries=readdirSync(directory,{withFileTypes:true});
  if(entries.some(entry=>!entry.isFile())||JSON.stringify(entries.map(entry=>entry.name).sort())!==JSON.stringify(expectedFiles))throw new Error(`${target} 附件不完整或含多余文件`);
  if(readFileSync(join(directory,'RELEASE-NOTES.md'),'utf8')!==notes)throw new Error(`${target} 版本说明不匹配`);
  for(const name of names){const source=join(directory,name);targetFiles.push({source,name,hash:await sha256(source)});}
  const checksum=targetFiles.map(file=>`${file.hash}  ${file.name}\n`).join('');
  if(readFileSync(join(directory,`SHA256SUMS-${target}.txt`),'utf8')!==checksum)throw new Error(`${target} SHA-256 校验失败`);
  if(enabled){
   const update=UPDATE_TARGETS[target],name=packageName(version,target,update.extension);
   const signature=await verifyUpdateFile(join(directory,name),readFileSync(join(directory,name+'.sig'),'utf8'),key);
   platforms[update.platform]={url:`https://github.com/${UPDATE_REPOSITORY}/releases/download/v${version}/${name}`,signature};
  }
  files.push(...targetFiles);
 }
 const output=emptyOutput(root);
 for(const file of files)copyFileSync(file.source,join(output,file.name));
 writeFileSync(join(output,'SHA256SUMS.txt'),files.map(file=>`${file.hash}  ${file.name}\n`).join(''));
 writeFileSync(join(output,'RELEASE-NOTES.md'),notes);
 if(enabled)writeFileSync(join(output,'latest.json'),JSON.stringify({version,notes:releaseNotes(readFileSync(join(root,'CHANGELOG.md'),'utf8'),version),pub_date:new Date().toISOString(),platforms},null,2)+'\n');
 return {version,output,files:files.map(file=>file.name)};
}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length<3||process.argv.length>4||(process.argv[3]&&process.argv[2]!=='collect'))throw new Error('用法：node scripts/ci-release.mjs prepare|collect [平台]|merge');
  if(process.argv[2]==='prepare'){const result=prepareRelease(root);console.log(`已验证 v${result.version} 的版本、标签和生产服务配置`);}
  else if(process.argv[2]==='collect'){const target=process.argv[3]??'windows-x64';validateBuildHost(target);const result=await collectRelease(root,target);console.log(`已收集 v${result.version} ${result.target} 安装包、校验文件和更新说明：${result.output}`);}
  else if(process.argv[2]==='merge'){const result=await mergeRelease(root);console.log(`已验证并汇总 v${result.version} 的 ${result.files.length} 个安装包：${result.output}`);}
  else throw new Error('未知命令');
 }catch(error){console.error(error.message);process.exitCode=1;}
}
