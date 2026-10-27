import { generateKeyPairSync, sign, createHash } from 'node:crypto';
// Ephemeral synthetic keys used only for tests; never a real release key.
export function syntheticSigning(){
 const keys=generateKeyPairSync('ed25519'),id=Buffer.from('12345678'),raw=keys.publicKey.export({format:'der',type:'spki'}).subarray(-32);
 const key=Buffer.from(`untrusted comment: test public key\n${Buffer.concat([Buffer.from('Ed'),id,raw]).toString('base64')}\n`).toString('base64');
 const signature=data=>{
  const signed=sign(null,createHash('blake2b512').update(data).digest(),keys.privateKey),comment='timestamp:1\tfile:test';
  const packet=Buffer.concat([Buffer.from('ED'),id,signed]).toString('base64');
  const global=sign(null,Buffer.concat([signed,Buffer.from(comment)]),keys.privateKey).toString('base64');
  return Buffer.from(`untrusted comment: test signature\n${packet}\ntrusted comment: ${comment}\n${global}\n`).toString('base64');
 };
 return {key,signature};
}
