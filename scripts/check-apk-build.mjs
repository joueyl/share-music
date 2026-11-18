import { readFileSync,existsSync } from 'node:fs';
import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export function checkApkBuild(root){
 const dist=resolve(root,'apps/client/dist-apk');
 const marker=JSON.parse(readFileSync(resolve(dist,'client-target.json'),'utf8'));
 if(marker.target!=='apk'||marker.entry!=='src/apk/main.ts'||marker.desktopModules!==0)throw new Error('APK 构建标记无效，拒绝打包桌面入口');
 const html=readFileSync(resolve(dist,'index.html'),'utf8');
 if(!html.includes('data-client="apk"')||html.includes('/src/main.ts'))throw new Error('APK index.html 未使用独立入口');
 const scripts=[...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m=>m[1]);
 if(!scripts.length||scripts.some(src=>!/^\/?assets\/[A-Za-z0-9_.-]+\.js$/.test(src)||!existsSync(resolve(dist,src.replace(/^\//,'')))))throw new Error('APK 入口脚本缺失或指向外部页面');
 return marker;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{checkApkBuild(resolve(dirname(fileURLToPath(import.meta.url)),'..'));console.log('APK 独立入口产物检查通过');}
 catch(error){console.error(error.message);process.exitCode=1;}
}
