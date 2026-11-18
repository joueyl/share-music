import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectAndroidElf } from './check-android-release.mjs';
function elf(extra=[]){
 const names=['','.shstrtab','.text',...extra],strings=Buffer.from(names.join('\0')+'\0'),headers=64,count=names.length,start=headers+count*64;
 const data=Buffer.alloc(start+strings.length);Buffer.from('7f454c460201','hex').copy(data);data.writeUInt16LE(183,18);data.writeBigUInt64LE(64n,40);data.writeUInt16LE(64,58);data.writeUInt16LE(count,60);data.writeUInt16LE(1,62);strings.copy(data,start);
 let index=0;for(let i=0;i<count;i++){data.writeUInt32LE(index,headers+i*64);index+=Buffer.byteLength(names[i])+1;}
 data.writeBigUInt64LE(BigInt(start),headers+64+24);data.writeBigUInt64LE(BigInt(strings.length),headers+64+32);return data;
}
test('accepts a stripped ARM64 library without removing required dynamic symbol sections',()=>{
 const data=elf(['.dynsym','.dynstr']);assert.deepEqual(inspectAndroidElf(data),{architecture:'arm64',stripped:true,bytes:data.length});
});
test('rejects debug sections, static symbols and malformed native libraries',()=>{
 for(const section of ['.debug_info','.debug_line','.zdebug_info','.symtab','.strtab'])assert.throws(()=>inspectAndroidElf(elf([section])),/unstripped/);
 assert.throws(()=>inspectAndroidElf(Buffer.alloc(0)),/Invalid ARM64/);
 const wrong=elf();wrong.writeUInt16LE(62,18);assert.throws(()=>inspectAndroidElf(wrong),/Invalid ARM64/);
 const truncated=elf().subarray(0,80);assert.throws(()=>inspectAndroidElf(truncated),/Invalid ARM64/);
 const badNames=elf();badNames.writeUInt32LE(999999,64+128);assert.throws(()=>inspectAndroidElf(badNames),/Invalid ARM64/);
});
