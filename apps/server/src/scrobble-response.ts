const PRIVATE=/(?:cookie|token|authorization|password|passwd|secret|credential|csrf|musicu|musica|headers)/i;

/** Bounded single-line diagnostics, never a raw dump of upstream credentials. */
export function scrobbleResponseLog(response:unknown):string {
 let budget=100;
 const seen=new WeakSet<object>();
 const clean=(value:unknown,depth:number):unknown=>{
  if(--budget<0||depth>4)return '[TRUNCATED]';
  if(typeof value==='string'){
   // Free-form fields can contain inline credentials or serialized JSON too.
   if(PRIVATE.test(value.replace(/[^a-z0-9]/gi,''))||/\bBearer\s/i.test(value))return '[REDACTED]';
   return value.length>512?value.slice(0,512)+'[TRUNCATED]':value;
  }
  if(value===null||typeof value==='boolean'||typeof value==='number')return value;
  if(typeof value!=='object')return '[UNAVAILABLE]';
  if(seen.has(value))return '[CIRCULAR]';seen.add(value);
  if(Array.isArray(value))return value.slice(0,20).map(item=>clean(item,depth+1));
  const entries:Array<[string,unknown]>=[];
  for(const key of Object.keys(value)){
   if(entries.length>=20||budget<=0){entries.push(['__truncated',true]);break;}
   // Do not echo unknown keys: a key itself may contain a signed URL or secret.
   if(!/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(key))continue;
   entries.push([key,PRIVATE.test(key.replace(/[^a-z0-9]/gi,''))?'[REDACTED]':clean((value as Record<string,unknown>)[key],depth+1)]);
  }
  return Object.fromEntries(entries);
 };
 try {
  const body=JSON.stringify(clean(response,0));
  return '网易云听歌打卡响应 '+(body.length>2048?body.slice(0,2037)+'[TRUNCATED]':body);
 }catch{return '网易云听歌打卡响应 [UNAVAILABLE]';}
}
