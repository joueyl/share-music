import { createHash } from 'node:crypto';
import OSS from 'ali-oss';
import type { Database } from './database';
import { DomainError } from './engine';

/** Endpoint routing and the resource used for signing are deliberately separate. */
export function ossOptions(env: NodeJS.ProcessEnv = process.env) {
  const bucket = env.OSS_BUCKET?.trim();
  const region = (env.OSS_REGION?.trim() || '').replace(/^oss-/, '');
  const accessKeyId = env.OSS_ACCESS_KEY_ID, accessKeySecret = env.OSS_ACCESS_KEY_SECRET;
  const apEndpoint = env.OSS_ACCESS_POINT_ENDPOINT?.trim(), alias = env.OSS_ACCESS_POINT_ALIAS?.trim();
  if (!bucket || !region || !accessKeyId || !accessKeySecret) throw new DomainError('OSS_NOT_CONFIGURED');
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || !/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(region)) throw new DomainError('OSS_INVALID_CONFIG');
  if (!!apEndpoint !== !!alias) throw new DomainError('OSS_ACCESS_POINT_INCOMPLETE');
  if (alias && !/^[a-z0-9][a-z0-9-]*-ossalias$/.test(alias)) throw new DomainError('OSS_INVALID_CONFIG');
  let host: string;
  if (apEndpoint) {
    host = apEndpoint.replace(/^https:\/\//, '').replace(/\/$/, '');
    const match = /^([a-z0-9][a-z0-9-]*)\.oss-([a-z0-9-]+)\.oss-accesspoint\.aliyuncs\.com$/.exec(host);
    if (!match || match[2] !== region) throw new DomainError('OSS_INVALID_CONFIG');
  } else {
    host = (env.OSS_ENDPOINT?.trim() || `oss-${region}.aliyuncs.com`).replace(/^https:\/\//, '').replace(/\/$/, '');
    if (host !== `oss-${region}.aliyuncs.com`) throw new DomainError('OSS_INVALID_CONFIG');
  }
  return {
    region: `oss-${region}`, accessKeyId, accessKeySecret,
    ...(env.OSS_SECURITY_TOKEN ? { stsToken: env.OSS_SECURITY_TOKEN } : {}),
    // Access-point aliases replace bucket names in the canonical signed resource.
    bucket: alias || bucket, endpoint: `https://${host}`, cname: !!apEndpoint,
    secure: true, authorizationV4: true, timeout: 120000,
  };
}

const providerCodes = new Set(['AccessDenied', 'SignatureDoesNotMatch', 'InvalidAccessKeyId', 'InvalidSecurityToken', 'SecurityTokenExpired', 'RequestTimeTooSkewed', 'RequestHasExpired', 'NoSuchBucket', 'NoSuchAccessPoint', 'InvalidAccessPoint', 'PublicEndpointForbidden', 'InvalidArgument']);
export type OssFailureDetails = { status?: number; ossCode: string; requestId?: string; ec?: string };
export class OssUploadError extends DomainError {
  constructor(readonly details: OssFailureDetails) { super('OSS_UPLOAD_FAILED'); }
}
/** Never expose Message, HostId, signature, StringToSign, or the signed request URL. */
export async function ossFailure(response: Response): Promise<OssFailureDetails> {
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  if (reader) try {
    while (size < 16384) { const { done, value } = await reader.read(); if (done) break; const part = value.subarray(0, 16384 - size); chunks.push(part); size += part.length; }
  } catch { /* Keep status even for a truncated response. */ }
  finally { await reader.cancel().catch(() => {}); }
  const xml = Buffer.concat(chunks).toString('utf8');
  const field = (name: string) => new RegExp(`<${name}>([A-Za-z0-9_-]{1,80})</${name}>`).exec(xml)?.[1];
  const code = field('Code'), requestId = field('RequestId') ?? response.headers.get('x-oss-request-id');
  const ec = field('EC');
  return { status: response.status, ossCode: code && providerCodes.has(code) ? code : 'Unknown',
    ...(requestId && /^[A-Za-z0-9_-]{1,80}$/.test(requestId) ? { requestId } : {}),
    ...(ec && /^\d{4}-\d{8}$/.test(ec) ? { ec } : {}),
  };
}

export function musicFilename(name:string):string {
  const match=/\.(mp3|wav|flac|aiff|aif|m4a|aac|ogg|opus|webm|bin)$/i.exec(name);
  const ext=match?.[1].toLowerCase() ?? 'bin';
  const title=(match?name.slice(0,-match[0].length):name).normalize('NFC').replace(/[<>:"/\\|?*%#\x00-\x1f\x7f]/g,'_').replace(/\.{2,}/g,'_').trim().replace(/[. ]+$/g,'');
  return (Array.from(title).slice(0,100).join('')||'音乐')+'.'+ext;
}
export function validMusicKey(key:string):boolean {
  if(/^music\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(key))return true; // Legacy objects remain playable.
  const match=/^music\/files\/[a-f0-9]{64}\/([^/]+)$/.exec(key);
  return !!match && !match[1].includes('..') && musicFilename(match[1])===match[1] && key.length<=500;
}
export class OssStorage {
  private inFlight=new Map<string,Promise<{ossKey:string}>>();
  private audioReads=new Map<string,Promise<Buffer>>();
  constructor(private env: NodeJS.ProcessEnv = process.env, private request: typeof fetch = fetch, private db?: Database) {}
  scope(){return `${this.env.OSS_REGION ?? ''}:${this.env.OSS_BUCKET ?? ''}`;}
  staticUrl(key:string) {
    if(!validMusicKey(key))throw new DomainError('OSS_INVALID_KEY');
    const options=ossOptions(this.env);
    const host=new URL(options.endpoint).hostname;
    return `https://${options.cname?host:options.bucket+'.'+host}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }
  registered(key:string,hash:string){return this.db?.getAsset(this.scope(),hash)===key;}
  async url(key: string, method: 'GET' | 'PUT' | 'HEAD' = 'GET', headers:Record<string,string>={}) {
    if (!validMusicKey(key)) throw new DomainError('OSS_INVALID_KEY');
    const client = new OSS(ossOptions(this.env));
    return client.signatureUrlV4(method as OSS.HTTPMethods, 3600, {headers}, key);
  }
  async exists(key:string):Promise<boolean> {
    const url=await this.url(key,'HEAD');
    try{
      const res=await this.request(url,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(15000)});
      if(res.ok)return true;if(res.status===404)return false;
      throw new OssUploadError(await ossFailure(res));
    }catch(e){if(e instanceof OssUploadError)throw e;throw new OssUploadError({ossCode:e instanceof Error&&['TimeoutError','AbortError'].includes(e.name)?'Timeout':'NetworkError'});}
  }
  readAudio(key:string,size:number,hash:string):Promise<Buffer> {
    if(!validMusicKey(key)||!Number.isSafeInteger(size)||size<1||size>100*1024*1024||!/^[a-f0-9]{64}$/.test(hash))return Promise.reject(new DomainError('PLAYBACK_AUDIO_METADATA_INVALID'));
    const id=JSON.stringify([key,size,hash]),prior=this.audioReads.get(id);if(prior)return prior;
    if(this.audioReads.size>=2)return Promise.reject(new DomainError('PLAYBACK_AUDIO_BUSY'));
    const job=this.downloadAudio(key,size,hash).finally(()=>this.audioReads.delete(id));this.audioReads.set(id,job);return job;
  }
  private async downloadAudio(key:string,size:number,hash:string):Promise<Buffer> {
    try{
      // URL is signed from validated OSS configuration, never supplied by the caller.
      const url=await this.url(key);
      const res=await this.request(url,{redirect:'error',signal:AbortSignal.timeout(60000)});
      if(!res.ok||!res.body){await res.body?.cancel();throw new DomainError('PLAYBACK_AUDIO_DOWNLOAD_FAILED');}
      const length=res.headers.get('content-length');
      if(length!==null&&Number(length)!==size){await res.body.cancel();throw new DomainError('PLAYBACK_AUDIO_INTEGRITY_FAILED');}
      const reader=res.body.getReader(),chunks:Uint8Array[]=[],digest=createHash('sha256');let received=0;
      try{
        while(true){const {done,value}=await reader.read();if(done)break;received+=value.byteLength;
          if(received>size)throw new DomainError('PLAYBACK_AUDIO_INTEGRITY_FAILED');
          chunks.push(value);digest.update(value);
        }
      }finally{await reader.cancel().catch(()=>{});}
      if(received!==size||digest.digest('hex')!==hash)throw new DomainError('PLAYBACK_AUDIO_INTEGRITY_FAILED');
      return Buffer.concat(chunks,received);
    }catch(error){if(error instanceof DomainError)throw error;throw new DomainError('PLAYBACK_AUDIO_DOWNLOAD_FAILED');}
  }
  upload(_userId: string, data: Buffer, filename='音乐.bin'):Promise<{ossKey:string}> {
    if (!data.length || data.length > 100 * 1024 * 1024) return Promise.reject(new DomainError('INVALID_AUDIO'));
    const hash=createHash('sha256').update(data).digest('hex'),scope=this.scope(),id=scope+':'+hash;
    const prior=this.inFlight.get(id);if(prior)return prior;
    const job=this.uploadOnce(data,filename,hash,scope).finally(()=>this.inFlight.delete(id));this.inFlight.set(id,job);return job;
  }
  private async uploadOnce(data:Buffer,filename:string,hash:string,scope:string) {
    const registered=this.db?.getAsset(scope,hash);
    const key=registered ?? `music/files/${hash}/${musicFilename(filename)}`;
    if(await this.exists(key)){this.db?.saveAsset(scope,hash,key);return {ossKey:key};}
    const headers={'x-oss-forbid-overwrite':'true'};
    const url = await this.url(key, 'PUT',headers);
    try {
      const response = await this.request(url, { method: 'PUT', headers, body: new Uint8Array(data), redirect: 'error', signal: AbortSignal.timeout(120000) });
      if (!response.ok) {
        if(response.status!==409 || !await this.exists(key))throw new OssUploadError(await ossFailure(response));
        await response.body?.cancel();
      }
    } catch (error) {
      if (error instanceof OssUploadError) throw error;
      const timeout = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
      throw new OssUploadError({ ossCode: timeout ? 'Timeout' : 'NetworkError' });
    }
    this.db?.saveAsset(scope,hash,key);
    return { ossKey: key };
  }
}
