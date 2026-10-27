import { computed, reactive } from 'vue';
import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
export type UpdateMetadata={version:string;currentVersion:string;body?:string|null};
export type UpdateProgress={event:'Started'|'Progress'|'Finished';chunkLength?:number;contentLength?:number|null};
type Adapter={desktop:()=>boolean;status:()=>Promise<{configured:boolean;supported:boolean}>;check:()=>Promise<UpdateMetadata|null>;install:(progress:(event:UpdateProgress)=>void)=>Promise<void>;restart:()=>Promise<void>};
type Phase='idle'|'checking'|'available'|'downloading'|'installing'|'installed'|'restarting'|'current'|'disabled'|'unsupported'|'error';
const errors:Record<string,string>={
 UPDATER_NOT_CONFIGURED:'此安装包尚未配置更新公钥，请先安装启用更新的新版本。',
 UPDATER_CHECK_FAILED:'检查失败，请确认 GitHub 可访问且正式 Release 已包含 latest.json。',
 UPDATER_SOURCE_INVALID:'更新文件地址不属于配置的 GitHub 仓库，已阻止下载。',
 UPDATER_INSTALL_FAILED:'更新失败，可能是网络、签名校验或安装权限问题；请重新检查更新后重试。',
 UPDATER_BUSY:'更新操作正在进行，请稍候。',
 UPDATER_NO_PENDING_UPDATE:'请重新检查更新后再安装。',
};
export function createUpdates(adapter:Adapter){
 const state=reactive<{phase:Phase;message:string;update:UpdateMetadata|null;received:number;total:number|null}>({phase:'idle',message:'',update:null,received:0,total:null});
 const locked=computed(()=>['downloading','installing','restarting'].includes(state.phase));
 const busy=computed(()=>locked.value||state.phase==='checking');
 const percent=computed(()=>state.total?Math.min(100,Math.floor(state.received/state.total*100)):null);
 function fail(error:unknown){state.phase='error';state.message=errors[error instanceof Error?error.message:String(error)]??'更新操作失败；旧安装包可能尚未包含更新模块，请手动安装新版后重试。';}
 async function check(){
  if(busy.value)return;
  state.phase='checking';state.message='正在检查 GitHub 最新正式版本…';state.update=null;state.received=0;state.total=null;
  if(!adapter.desktop()){state.phase='unsupported';state.message='网页版请刷新页面获取前端更新；应用内安装更新仅用于桌面客户端。';return;}
  try{
   const status=await adapter.status();
   if(!status.configured){state.phase='disabled';state.message=errors.UPDATER_NOT_CONFIGURED;return;}
   if(!status.supported){state.phase='unsupported';state.message='当前 Linux 安装格式不支持应用内更新，请使用 AppImage 或手动安装新版 DEB。';return;}
   const update=await adapter.check();state.update=update;
   state.phase=update?'available':'current';state.message=update?`发现新版本 v${update.version}`:'当前已是最新正式版本。';
  }catch(error){fail(error);}
 }
 async function install(confirmed:boolean){
  if(!confirmed||state.phase!=='available'||!state.update)return;
  state.phase='downloading';state.message='正在下载并验证更新签名…';state.received=0;state.total=null;
  try{
   await adapter.install(event=>{
    if(event.event==='Started'){state.received=0;state.total=null;}
    if(event.event==='Progress'){
     if(Number.isFinite(event.chunkLength)&&event.chunkLength!>0)state.received+=event.chunkLength!;
     if(Number.isFinite(event.contentLength)&&event.contentLength!>0)state.total=event.contentLength!;
    }
    if(event.event==='Finished'){state.phase='installing';state.message='下载完成，正在验证并安装，请勿关闭程序…';}
   });
   state.phase='installed';state.message='更新安装完成，请重启程序。';
  }catch(error){state.update=null;fail(error);}
 }
 async function restart(){
  if(state.phase!=='installed')return;state.phase='restarting';state.message='正在重启…';
  try{await adapter.restart();}catch{state.phase='installed';state.message='自动重启失败，请退出后重新打开程序。';}
 }
 return {state,locked,busy,percent,check,install,restart};
}
export const appUpdates=createUpdates({
 desktop:isTauri,
 status:()=>invoke('updater_status'),check:()=>invoke('check_app_update'),
 install:progress=>{const channel=new Channel<UpdateProgress>();channel.onmessage=progress;return invoke('install_app_update',{onEvent:channel});},
 restart:()=>invoke('restart_after_update'),
});
