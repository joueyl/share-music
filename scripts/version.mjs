import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const manifests=['package.json','apps/client/package.json','apps/server/package.json','packages/shared/package.json'];
const json=value=>JSON.stringify(value,null,2)+'\n';
const read=(root,path)=>readFileSync(resolve(root,path),'utf8');
export function validVersion(value){return typeof value==='string'&&value.trim()===value&&/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)&&value.split('.').every(n=>Number.isSafeInteger(Number(n)));}
function compare(a,b){const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;return 0;}
export function nextVersion(current,target){
 if(!validVersion(current))throw new Error('当前版本必须是 x.y.z 格式');
 const parts=current.split('.').map(Number),index={major:0,minor:1,patch:2}[target];
 if(index!==undefined){parts[index]++;for(let i=index+1;i<3;i++)parts[i]=0;target=parts.join('.');}
 if(!validVersion(target)||compare(target,current)<=0)throw new Error('新版本必须是大于当前版本的 x.y.z，例如 0.1.2');
 return target;
}
export function releaseNotes(changelog,version){
 const sections=[...changelog.matchAll(/^## \[([^\]]+)\][^\r\n]*\r?\n([\s\S]*?)(?=^## \[|(?![\s\S]))/gm)];
 const section=sections.find(s=>s[1]===version);if(!section||!/^\s*-\s+\S/m.test(section[2]))throw new Error(`找不到 ${version} 的有效更新日志`);
 return section[2].trim()+'\n';
}
export function shanghaiDate(now=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const part=type=>parts.find(p=>p.type===type).value;return `${part('year')}-${part('month')}-${part('day')}`;
}
export function versionPlan(root,version){
 if(!validVersion(version))throw new Error('版本必须是 x.y.z 格式');
 const files=new Map();
 for(const path of manifests){const data=JSON.parse(read(root,path));data.version=version;if(data.dependencies?.['@music-share/shared'])data.dependencies['@music-share/shared']=version;files.set(path,json(data));}
 const config=JSON.parse(read(root,'apps/client/src-tauri/tauri.conf.json'));config.version=version;files.set('apps/client/src-tauri/tauri.conf.json',json(config));
 const cargo=read(root,'apps/client/src-tauri/Cargo.toml');
 if(!/\[package\][\s\S]*?\nversion = "[^"]+"/.test(cargo))throw new Error('Cargo.toml 缺少 package version');
 files.set('apps/client/src-tauri/Cargo.toml',cargo.replace(/(\[package\][\s\S]*?\nversion = ")[^"]+"/,`$1${version}"`));
 const cargoLock=read(root,'apps/client/src-tauri/Cargo.lock');
 if(!/name = "music-share-desktop"\r?\nversion = "[^"]+"/.test(cargoLock))throw new Error('Cargo.lock 缺少桌面包记录');
 files.set('apps/client/src-tauri/Cargo.lock',cargoLock.replace(/(name = "music-share-desktop"\r?\nversion = ")[^"]+"/,`$1${version}"`));
 const lock=JSON.parse(read(root,'package-lock.json'));lock.version=version;
 for(const path of manifests){const key=path==='package.json'?'':dirname(path).replaceAll('\\','/');const item=lock.packages[key];if(!item)throw new Error(`npm lock 缺少 ${key}`);item.version=version;if(item.dependencies?.['@music-share/shared'])item.dependencies['@music-share/shared']=version;}
 files.set('package-lock.json',json(lock));
 const pnpm=read(root,'pnpm-lock.yaml');let count=0;
 const updated=pnpm.replace(/('@music-share\/shared':\r?\n\s+specifier: )[^\r\n]+/g,(_,prefix)=>{count++;return prefix+version;});
 if(count!==2)throw new Error('pnpm lock 的共享包引用数量异常');files.set('pnpm-lock.yaml',updated);
 return files;
}
export function checkVersions(root){
 const version=JSON.parse(read(root,'package.json')).version,files=versionPlan(root,version),mismatches=[];
 for(const [path,expected] of files){const actual=read(root,path);if(path.endsWith('.json')?JSON.stringify(JSON.parse(actual))!==JSON.stringify(JSON.parse(expected)):actual!==expected)mismatches.push(path);}
 if(mismatches.length)throw new Error(`版本不一致：${mismatches.join('、')}；运行 npm run version:sync`);
  releaseNotes(read(root,'CHANGELOG.md'),version);
 return version;
}
export function setVersion(root,target,{sync=false,date=shanghaiDate()}={}){
 const current=JSON.parse(read(root,'package.json')).version,version=sync?current:nextVersion(current,target);
 const files=versionPlan(root,version);
 if(!sync){
  const changelog=read(root,'CHANGELOG.md');releaseNotes(changelog,'未发布');
  if(changelog.includes(`## [${version}]`))throw new Error('更新日志已存在该版本');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('日期必须是 YYYY-MM-DD');
  files.set('CHANGELOG.md',changelog.replace(/^## \[未发布\][^\r\n]*/m,`## [未发布]\n\n## [${version}] - ${date}`));
 }
 // Validate every input before writing any managed file.
 for(const [path,content] of files)writeFileSync(resolve(root,path),content);
 return version;
}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const [command,value,...extra]=process.argv.slice(2);if(extra.length||(value&&command!=='--notes'))throw new Error('参数过多');
  if(command==='--check')console.log(`版本检查通过：v${checkVersions(root)}`);
  else if(command==='--sync')console.log(`版本已统一：v${setVersion(root,undefined,{sync:true})}`);
  else if(command==='--notes'){if(!validVersion(value))throw new Error('请提供 x.y.z 版本号');process.stdout.write(releaseNotes(read(root,'CHANGELOG.md'),value));}
  else if(command)console.log(`已准备版本 v${setVersion(root,command)}，请审阅变更、测试后再发布。`);
  else throw new Error('用法：npm run release:version -- patch|minor|major|x.y.z');
 }catch(error){console.error(error.message);process.exitCode=1;}
}
