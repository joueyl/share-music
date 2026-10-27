import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validVersion } from './version.mjs';
import { UPDATE_REPOSITORY } from './updater-config.mjs';

export function recoveryPlan(run,jobs,tagSha,version,repo){
 if(repo!==UPDATE_REPOSITORY||!validVersion(version))throw new Error('恢复发布仓库或版本无效');
 const tag=`v${version}`;
 if(run.path!=='.github/workflows/desktop-release.yml'||run.event!=='push'||run.head_branch!==tag||run.head_sha!==tagSha||run.status!=='completed'||run.repository?.full_name!==repo)throw new Error('源构建与版本标签不一致，拒绝复用');
 const builds=jobs.filter(job=>job.name==='build'||job.name.startsWith('build-unix ('));
 if(builds.length!==4||builds.some(job=>job.status!=='completed'||job.conclusion!=='success'))throw new Error('四个平台构建必须全部成功');
 for(const target of ['linux-x64','macos-x64','macos-arm64'])if(builds.filter(job=>job.name.includes(`, ${target},`)).length!==1)throw new Error('源构建平台不完整');
 if(builds.filter(job=>job.name==='build').length!==1)throw new Error('缺少 Windows 构建');
 return {version,tag};
}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const id=process.env.SOURCE_RUN_ID,repo=process.env.GITHUB_REPOSITORY;
  if(!/^[1-9]\d*$/.test(id??'')||repo!==UPDATE_REPOSITORY)throw new Error('源构建 ID 或仓库无效');
  const version=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8')).version;
  if(!validVersion(version))throw new Error('版本格式无效');
  const api=path=>JSON.parse(execFileSync('gh',['api',`repos/${repo}/${path}`],{encoding:'utf8',maxBuffer:10*1024*1024}));
  const run=api(`actions/runs/${id}`),jobs=api(`actions/runs/${id}/jobs?per_page=100`),commit=api(`commits/v${version}`);
  const result=recoveryPlan(run,jobs.jobs,commit.sha,version,repo);
  appendFileSync(process.env.GITHUB_OUTPUT,`version=${result.version}\ntag=${result.tag}\n`);
  console.log(`源构建与 ${result.tag} 一致，四平台均成功，可重新校验产物。`);
 }catch(error){console.error(error.message);process.exitCode=1;}
}
