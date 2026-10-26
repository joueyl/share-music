// Small synthetic tag/container fixtures. No user music, network or mocked parser.
const text=(value:string)=>new TextEncoder().encode(value);
export const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBZkAAAAASUVORK5CYII=','base64'));
function concat(...values:Uint8Array[]):Uint8Array<ArrayBuffer> {
  const result=new Uint8Array(values.reduce((sum,value)=>sum+value.length,0));let offset=0;
  for(const value of values){result.set(value,offset);offset+=value.length;}return result;
}
const u32=(value:number)=>new Uint8Array([value>>>24,value>>>16&255,value>>>8&255,value&255]);
const u24=(value:number)=>new Uint8Array([value>>>16,value>>>8&255,value&255]);
const syncsafe=(value:number)=>new Uint8Array([value>>>21&127,value>>>14&127,value>>>7&127,value&127]);
export function mp3WithPictures(pictures:{data:Uint8Array;type?:number}[]=[{data:png}],version:2|3|4=3) {
  const frames=pictures.map(picture=>{
    const data=concat(new Uint8Array([0]),text(version===2?'PNG':'image/png\0'),new Uint8Array([picture.type??3,0]),picture.data);
    return version===2?concat(text('PIC'),u24(data.length),data):concat(text('APIC'),version===4?syncsafe(data.length):u32(data.length),new Uint8Array(2),data);
  });
  const tag=concat(...frames),audio=new Uint8Array(417*4);
  for(let i=0;i<4;i++)audio.set([255,251,144,0],i*417);
  return concat(text('ID3'),new Uint8Array([version,0,0]),syncsafe(tag.length),tag,audio);
}
export function flacWithPicture() {
  const info=new Uint8Array(34);info.set([16,0,16,0]);
  new DataView(info.buffer).setBigUint64(10,(44100n<<44n)|(1n<<41n)|(15n<<36n)|44100n);
  const mime=text('image/png');
  const picture=concat(u32(3),u32(mime.length),mime,u32(0),u32(1),u32(1),u32(16),u32(0),u32(png.length),png);
  return concat(text('fLaC'),new Uint8Array([0]),u24(info.length),info,new Uint8Array([128|6]),u24(picture.length),picture);
}
export function m4aWithCover() {
  const atom=(type:string,data:Uint8Array)=>concat(u32(8+data.length),text(type),data);
  const data=atom('data',concat(u32(14),u32(0),png));
  const moov=atom('moov',atom('udta',atom('meta',concat(u32(0),atom('ilst',atom('covr',data))))));
  return concat(atom('ftyp',concat(text('M4A '),u32(0),text('M4A isom'))),moov);
}
