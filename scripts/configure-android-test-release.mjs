import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const begin='// tone-test-signed-release:begin',end='// tone-test-signed-release:end';
const configuration=`${begin}
// Release compilation and test signing are independent; never enable debugging here.
android {
    buildTypes.getByName("release") {
        signingConfig = signingConfigs.getByName("debug")
        isDebuggable = false
        isJniDebuggable = false
        manifestPlaceholders["usesCleartextTraffic"] = "false"
    }
}
${end}`;

/** Add a separate, narrowly scoped Gradle configuration, leaving template blocks intact. */
export function configureAndroidTestRelease(source){
 const starts=source.split(begin).length-1,ends=source.split(end).length-1;
 if(starts!==ends||starts>1)throw new Error('Ambiguous test-signed Release configuration');
 let base=source;
 if(starts===1){const a=source.indexOf(begin),b=source.indexOf(end);if(b<a)throw new Error('Invalid test-signed Release configuration');base=source.slice(0,a)+source.slice(b+end.length);}
 if(!/id\("com\.android\.application"\)/.test(base)||!/^\s*android\s*\{/m.test(base)||!/^\s*buildTypes\s*\{/m.test(base)||[...base.matchAll(/getByName\("release"\)\s*\{/g)].length!==1)throw new Error('Unsupported generated Android app template');
 return base.trimEnd()+'\n\n'+configuration+'\n';
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const path=resolve(root,'apps/client/src-tauri/gen/android/app/build.gradle.kts');
  writeFileSync(path,configureAndroidTestRelease(readFileSync(path,'utf8')));
  console.log('Android Release uses the automatic debug TEST certificate; debugging and cleartext traffic remain disabled.');
 }catch(error){console.error(error.message);process.exitCode=1;}
}
