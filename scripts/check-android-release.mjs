import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Inspect ELF section headers without executing or modifying the native library. */
export function inspectAndroidElf(data){
 const fail=()=>{throw new Error('Invalid ARM64 ELF section table');};
 if(data.length<64||data.subarray(0,6).toString('hex')!=='7f454c460201'||data.readUInt16LE(18)!==183)fail();
 const offset=Number(data.readBigUInt64LE(40)),size=data.readUInt16LE(58),count=data.readUInt16LE(60),strings=data.readUInt16LE(62);
 if(!Number.isSafeInteger(offset)||size<64||!count||strings>=count||offset<64||offset+size*count>data.length)fail();
 const stringHeader=offset+size*strings;
 const start=Number(data.readBigUInt64LE(stringHeader+24)),length=Number(data.readBigUInt64LE(stringHeader+32));
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(length)||start<0||length<1||start+length>data.length)fail();
 const names=data.subarray(start,start+length),sections=[];
 for(let i=0;i<count;i++){
  const header=offset+size*i,index=data.readUInt32LE(header),end=names.indexOf(0,index);
  if(index>=names.length||end<index)fail();
  sections.push(names.subarray(index,end).toString('utf8'));
 }
 if(!sections.includes('.text'))fail();
 if(sections.some(name=>name.startsWith('.debug')||name.startsWith('.zdebug')||name==='.symtab'||name==='.strtab'))throw new Error('Android Release contains debug information or unstripped symbols');
 return {architecture:'arm64',stripped:true,bytes:data.length};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const apk=process.argv[2];if(process.argv.length!==3||!apk?.endsWith('.apk'))throw new Error('Usage: node scripts/check-android-release.mjs APK');
  const entries=execFileSync('unzip',['-Z','-1',apk],{encoding:'utf8',maxBuffer:8*1024*1024}).trim().split(/\r?\n/);
  const native='lib/arm64-v8a/libmusic_share_core.so';
  if(entries.filter(name=>name===native).length!==1||entries.some(name=>name.startsWith('lib/')&&!name.startsWith('lib/arm64-v8a/')))throw new Error('Expected one ARM64-only application library');
  const data=execFileSync('unzip',['-p',apk,native],{maxBuffer:256*1024*1024});
  const result=inspectAndroidElf(data);
  console.log(`Release APK ${(statSync(apk).size/1048576).toFixed(2)} MiB; ARM64 native library ${(result.bytes/1048576).toFixed(2)} MiB; debug information and static symbols absent.`);
 }catch(error){console.error(error.message);process.exitCode=1;}
}
