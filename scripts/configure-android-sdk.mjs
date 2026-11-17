import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Keep generated Gradle settings aligned with the explicitly installed CI SDK. */
export function configureAndroidSdk(source, api, tools) {
 if(!/^[1-9]\d*$/.test(api??'')||!/^\d+\.\d+\.\d+$/.test(tools??''))throw new Error('Invalid Android SDK version');
 let result=source;
 for(const property of ['compileSdk','targetSdk']) {
  const pattern=new RegExp(`^(\\s*)${property}\\s*=\\s*\\d+[ \\t]*\\r?$`,'gm');
  if([...result.matchAll(pattern)].length!==1)throw new Error(`Expected exactly one numeric ${property} in generated app/build.gradle.kts`);
  result=result.replace(pattern,(_,indent)=>`${indent}${property} = ${api}`);
 }
 const toolsPattern=/^[ \t]*buildToolsVersion\s*=.*\r?$/gm;
 if([...result.matchAll(toolsPattern)].length>1)throw new Error('Ambiguous generated buildToolsVersion');
 if(toolsPattern.test(result))result=result.replace(toolsPattern,`    buildToolsVersion = "${tools}"`);
 else result=result.replace(/(^[ \t]*compileSdk = \d+)[ \t]*$/m,`$1\n    buildToolsVersion = "${tools}"`);
 return result;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const file=resolve(root,'apps/client/src-tauri/gen/android/app/build.gradle.kts');
  const api=process.env.ANDROID_API_LEVEL,tools=process.env.BUILD_TOOLS_VERSION;
  const configured=configureAndroidSdk(readFileSync(file,'utf8'),api,tools);
  writeFileSync(file,configured);
  console.log(`Generated Android project pinned to API ${api}, build-tools ${tools}`);
 } catch(error) { console.error(error.message);process.exitCode=1; }
}
