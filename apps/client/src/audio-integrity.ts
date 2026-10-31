/** MD5 is a provider file checksum, not an authenticity/signature mechanism. */
const shifts = [7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];
const constants = Uint32Array.from({length:64}, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));
export async function audioMd5(bytes: Uint8Array): Promise<string> {
  const state = new Uint32Array([0x67452301,0xefcdab89,0x98badcfe,0x10325476]);
  const words = new Uint32Array(16);
  const block = (data: Uint8Array, offset: number) => {
    for(let i=0;i<16;i++) {
      const p=offset+i*4;
      words[i]=data[p]|data[p+1]<<8|data[p+2]<<16|data[p+3]<<24;
    }
    let [a,b,c,d]=state;
    for(let i=0;i<64;i++) {
      const round=i>>>4;
      const f=round===0?(b&c)|(~b&d):round===1?(d&b)|(~d&c):round===2?b^c^d:c^(b|~d);
      const g=round===0?i:round===1?(5*i+1)%16:round===2?(3*i+5)%16:(7*i)%16;
      const value=(a+f+constants[i]+words[g])|0, shift=shifts[round*4+i%4];
      [a,b,c,d]=[d,(b+((value<<shift)|(value>>>(32-shift))))|0,b,c];
    }
    state[0]+=a;state[1]+=b;state[2]+=c;state[3]+=d;
  };
  const end=bytes.length-bytes.length%64;
  for(let offset=0;offset<end;offset+=64) {
    block(bytes,offset);
    // Let playback, input and room changes proceed while checking large files.
    if(offset && offset%(1024*1024)===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
  const tail=new Uint8Array(bytes.length-end<56?64:128);
  tail.set(bytes.subarray(end));tail[bytes.length-end]=0x80;
  const view=new DataView(tail.buffer),bits=bytes.length*8;
  view.setUint32(tail.length-8,bits>>>0,true);view.setUint32(tail.length-4,Math.floor(bits/2**32),true);
  for(let offset=0;offset<tail.length;offset+=64)block(tail,offset);
  return Array.from(state,word=>Array.from({length:4},(_,i)=>((word>>>(i*8))&255).toString(16).padStart(2,'0')).join('')).join('');
}
export async function verifyAudio(bytes: Uint8Array, track: {contentHash:string;sizeBytes:number}): Promise<void> {
  if(!Number.isSafeInteger(track.sizeBytes)||track.sizeBytes<1||track.sizeBytes>100*1024*1024 ||
    !/^(?:[a-f0-9]{32}|[a-f0-9]{64})$/.test(track.contentHash))throw new Error('PLAYBACK_AUDIO_METADATA_INVALID');
  if(bytes.byteLength!==track.sizeBytes)throw new Error('PLAYBACK_AUDIO_INTEGRITY_FAILED');
  const hash=track.contentHash.length===32?await audioMd5(bytes):
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))),b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==track.contentHash)throw new Error('PLAYBACK_AUDIO_INTEGRITY_FAILED');
}
