import { createPublicKey, createHash, verify } from 'node:crypto';
import { readFileSync, createReadStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import { publicKey } from './updater-config.mjs';
// Tauri wraps the Minisign public key and signature text in base64. Use Node's
// Ed25519 primitive to check both the data signature and signed trusted comment.
export async function verifyUpdateFile(path,signature,key){
 publicKey(key);
 const encoded=signature.trim();
 if(encoded.length>16384||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw new Error('更新签名格式无效');
 const lines=Buffer.from(encoded,'base64').toString('utf8').trim().split(/\r?\n/);
 if(lines.length!==4||!lines[0].startsWith('untrusted comment:')||!lines[2].startsWith('trusted comment: '))throw new Error('更新签名格式无效');
 const packet=Buffer.from(lines[1],'base64'),global=Buffer.from(lines[3],'base64');
 const pub=Buffer.from(Buffer.from(key,'base64').toString('utf8').trim().split(/\r?\n/)[1],'base64');
 if(packet.length!==74||global.length!==64||pub.length!==42||pub.subarray(0,2).toString()!=='Ed'||!packet.subarray(2,10).equals(pub.subarray(2,10)))throw new Error('更新签名与公钥不匹配');
 let data;
 if(packet.subarray(0,2).toString()==='ED'){
  const hash=createHash('blake2b512'),stream=createReadStream(path);for await(const chunk of stream)hash.update(chunk);await finished(stream,{cleanup:true});data=hash.digest();
 }else if(packet.subarray(0,2).toString()==='Ed')data=readFileSync(path);
 else throw new Error('更新签名算法不支持');
 const keyObject=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),pub.subarray(10)]),format:'der',type:'spki'});
 if(!verify(null,data,keyObject,packet.subarray(10))||!verify(null,Buffer.concat([packet.subarray(10),Buffer.from(lines[2].slice(17))]),keyObject,global))throw new Error('更新签名校验失败，请检查公私钥是否配套或文件是否损坏');
 return encoded;
}
