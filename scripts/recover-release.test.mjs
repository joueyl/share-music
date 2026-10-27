import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoveryPlan } from './recover-release.mjs';
function fixture(){return {run:{path:'.github/workflows/desktop-release.yml',event:'push',head_branch:'v0.2.2',head_sha:'abc',status:'completed',repository:{full_name:'joueyl/share-music'}},jobs:['build','build-unix (ubuntu-22.04, linux-x64, dynamic, x64, linux)','build-unix (macos-15-intel, macos-x64, dynamic, x64, mac)','build-unix (macos-15, macos-arm64, dynamic, arm64, mac)'].map(name=>({name,status:'completed',conclusion:'success'}))};}
test('allows recovery of successful platform packages after an aggregation failure',()=>{
 const f=fixture();f.run.conclusion='failure';assert.deepEqual(recoveryPlan(f.run,f.jobs,'abc','0.2.2','joueyl/share-music'),{tag:'v0.2.2',version:'0.2.2'});
});
test('rejects unrelated, mismatched or incomplete source builds',()=>{
 for(const change of [{head_sha:'old'},{head_branch:'main'},{event:'workflow_dispatch'},{status:'in_progress'},{path:'other.yml'}]){
  const f=fixture();assert.throws(()=>recoveryPlan({...f.run,...change},f.jobs,'abc','0.2.2','joueyl/share-music'));
 }
 const f=fixture();assert.throws(()=>recoveryPlan(f.run,f.jobs.slice(1),'abc','0.2.2','joueyl/share-music'));
 f.jobs[0].conclusion='failure';assert.throws(()=>recoveryPlan(f.run,f.jobs,'abc','0.2.2','joueyl/share-music'));
 assert.throws(()=>recoveryPlan(f.run,f.jobs,'abc','0.2.2','other/repo'));
});
