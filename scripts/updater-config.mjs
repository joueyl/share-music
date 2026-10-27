import { readFileSync } from 'node:fs';
import { join } from 'node:path';
export const UPDATE_REPOSITORY='joueyl/share-music';
export const UPDATE_ENDPOINT=`https://github.com/${UPDATE_REPOSITORY}/releases/latest/download/latest.json`;
export function publicKey(value){
 const key=value?.trim()??'';if(!key)return '';
 if(key.length>4096||!/^[A-Za-z0-9+/]+={0,2}$/.test(key))throw new Error('UPDATER_PUBLIC_KEY 必须是 .pub 文件完整内容，不是文件路径');
 const decoded=Buffer.from(key,'base64').toString('utf8');
 const lines=decoded.trim().split(/\r?\n/);
 if(lines.length!==2||!lines[0].startsWith('untrusted comment:')||!/^R[UW][A-Za-z0-9+/=]+$/.test(lines[1])||Buffer.from(lines[1],'base64').length!==42)throw new Error('UPDATER_PUBLIC_KEY 不是有效的 Tauri 公钥内容');
 return key;
}
export function updaterSettings(root,env=process.env){
 const config=JSON.parse(readFileSync(join(root,'apps/client/src-tauri/tauri.conf.json'),'utf8'));
 const key=publicKey(env.UPDATER_PUBLIC_KEY||config.plugins?.updater?.pubkey);
 return {key,enabled:!!key,endpoint:UPDATE_ENDPOINT};
}
export function withUpdater(config,root,env=process.env){
 const {key,enabled}=updaterSettings(root,env);
 if(enabled&&!env.TAURI_SIGNING_PRIVATE_KEY)throw new Error('已配置更新公钥，但缺少 TAURI_SIGNING_PRIVATE_KEY，拒绝生成不签名更新包');
 if(!enabled&&env.TAURI_SIGNING_PRIVATE_KEY)throw new Error('已配置签名私钥，但缺少 UPDATER_PUBLIC_KEY，拒绝生成未启用更新的包');
 return {...config,bundle:{...config.bundle,createUpdaterArtifacts:enabled},plugins:{...config.plugins,updater:{pubkey:key,endpoints:[UPDATE_ENDPOINT],windows:{installMode:'passive'}}}};
}
