import { createHash, randomUUID } from 'node:crypto';
import { invokeHana, type MusicInvoker, type MusicResult as Result } from './hana-music';
export type { MusicInvoker } from './hana-music';
import type { DatabaseStore } from './database';
import { DomainError } from './engine';

export type PasswordLogin = { type: 'phone'; phone: string; countrycode: string; password: string } | { type: 'email'; email: string; password: string };
export const musicMethods = new Set(['search', 'search_suggest', 'cloudsearch', 'simi_song', 'song_detail', 'song_url', 'song_url_v1', 'lyric', 'lyric_new', 'playlist_detail', 'playlist_track_all', 'user_playlist', 'user_account', 'user_cloud', 'login_status', 'album']);
function publicBody(value: any): any {
  if (Array.isArray(value)) return value.map(publicBody);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !/^(cookie|token|accessToken|refreshToken|__csrf|MUSIC_U)$/i.test(k)).map(([k, v]) => [k, publicBody(v)]));
  return value;
}
export class NeteaseService {
  private attempt?: { id: string; key: string; expiresAt: number; lastCheck: number; code: number; pending?: Promise<{ code: number }> };
  private generation = 0;
  constructor(private db: DatabaseStore, private api: MusicInvoker = invokeHana, private now = Date.now, private log:(message:string)=>void=message=>console.warn(message)) {}
  private async request(name: string, params: Record<string, unknown> = {}, credential?:string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.api(name, { ...params, cookie: credential ?? await this.db.getSetting('netease.cookie') ?? '', timestamp: this.now() }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DomainError('NETEASE_UNAVAILABLE')), 20000); }),
      ]);
    } catch { throw new DomainError('NETEASE_UNAVAILABLE'); }
    finally { clearTimeout(timer); }
  }
  private credentialKey(cookie:string):string|null {
    const token=/(?:^|;\s*)MUSIC_U=([^;\s]+)/.exec(cookie)?.[1];
    return token?createHash('sha256').update(token).digest('hex'):null;
  }
  async accountSessionKey():Promise<string|null> {
    return this.credentialKey(await this.db.getSetting('netease.cookie')??'');
  }
  /** Server-only account maintenance. Never extend the browser proxy allowlist. */
  async accountCall(name:string,params:Record<string,unknown>,expectedSession:string) {
    const cookie=await this.db.getSetting('netease.cookie')??'';
    if(!expectedSession||this.credentialKey(cookie)!==expectedSession)throw new DomainError('NETEASE_LOGIN_REPLACED');
    let clean:Record<string,unknown>;
    switch(name){
      case 'daily_signin':
        if(params.type!==undefined&&params.type!==0&&params.type!==1)throw new DomainError('INVALID_REQUEST');
        clean={type:params.type??0};break;
      case 'yunbei_sign':case 'vip_tasks':clean={};break;
      case 'vip_growthpoint_get':
        if(typeof params.ids!=='string'||params.ids.length>4000||!/^\d{1,20}(?:_\d{1,10})?(?:,\d{1,20}(?:_\d{1,10})?){0,99}$/.test(params.ids))throw new DomainError('INVALID_REQUEST');
        clean={ids:params.ids};break;
      case 'song_detail':
        if(!/^\d{1,20}$/.test(String(params.ids??'')))throw new DomainError('INVALID_REQUEST');
        clean={ids:String(params.ids)};break;
      case 'scrobble':
        if(!/^\d{1,20}$/.test(String(params.id??''))||!/^\d{1,20}$/.test(String(params.sourceid??''))||!Number.isInteger(params.time)||Number(params.time)<1||Number(params.time)>86400)throw new DomainError('INVALID_REQUEST');
        clean={id:String(params.id),sourceid:String(params.sourceid),time:Number(params.time)};break;
      default:throw new DomainError('NETEASE_METHOD_NOT_ALLOWED');
    }
    return publicBody((await this.request(name,clean,cookie)).body);
  }
  /** Fixed read-only batch for imports; never expose arbitrary batch routes to browsers. */
  async songBatch(ids:string[]) {
    if(!Array.isArray(ids)||ids.length<1||ids.length>50||ids.some(id=>!/^\d{1,20}$/.test(id))||new Set(ids).size!==ids.length)throw new DomainError('INVALID_REQUEST');
    const detailRoute='/api/v3/song/detail',urlRoute='/api/song/enhance/player/url/v1';
    const body=publicBody((await this.request('batch',{
      [detailRoute]:{c:'['+ids.map(id=>'{"id":'+id+'}').join(',')+']'},
      [urlRoute]:{ids:'['+ids.join(',')+']',level:'standard',encodeType:'flac'}
    })).body);
    const detail=body[detailRoute],source=body[urlRoute];
    const checks=[
      {stage:'batch',value:body,valid:body.code===200},
      {stage:'song_detail',value:detail,valid:detail?.code===200&&Array.isArray(detail.songs)},
      {stage:'song_url_v1',value:source,valid:source?.code===200&&Array.isArray(source.data)}
    ];
    const numeric=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&Math.abs(value)<=100000?value:undefined;
    const rejected=checks.find(check=>numeric(check.value?.code)!==undefined&&check.value.code!==200);
    const failed=rejected??checks.find(check=>!check.valid);
    if(failed){
      const type=(value:unknown)=>value===null?'null':Array.isArray(value)?'array':typeof value;
      // The batch HTTP response may be 200 while a nested business request was rejected.
      // Log only fixed labels, numeric codes and types; never bodies, URLs or credentials.
      this.log('网易云 batch 响应校验失败 '+JSON.stringify({phase:rejected?'business_rejected':'response_shape',stage:failed.stage,
        rootCode:numeric(body.code),detailCode:numeric(detail?.code),sourceCode:numeric(source?.code),
        rootCodeType:type(body.code),detailCodeType:type(detail?.code),sourceCodeType:type(source?.code),
        detailType:type(detail),sourceType:type(source),songsType:type(detail?.songs),dataType:type(source?.data)}));
      const loginRequired=checks.some(check=>check.value?.code===301);
      throw new DomainError(loginRequired?'NETEASE_LOGIN_REQUIRED':rejected?'NETEASE_UNAVAILABLE':'NETEASE_INVALID_RESPONSE');
    }
    return {detail,source};
  }
  async call(name: string, params: Record<string, unknown>) {
    if (!musicMethods.has(name)) throw new DomainError('NETEASE_METHOD_NOT_ALLOWED');
    // Do not allow browser callers to inject credentials, proxies or network addresses.
    const allowed = new Set(['keywords', 'limit', 'offset', 'type', 'id', 'ids', 'uid', 'level', 'br']);
    const clean = Object.fromEntries(Object.entries(params).filter(([key]) => allowed.has(key)));
    if(['simi_song','lyric_new','playlist_track_all','playlist_detail','user_playlist','album'].includes(name)){
      const key=name==='user_playlist'?'uid':'id';
      if(!/^\d{1,20}$/.test(String(clean[key]??'')))throw new DomainError('INVALID_REQUEST');
      if(name==='simi_song'||name==='playlist_track_all'||name==='user_playlist'){
        const limit=Number(clean.limit??(name==='user_playlist'?30:50)),offset=Number(clean.offset??0);
        if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>100000)throw new DomainError('INVALID_REQUEST');
        clean.limit=limit;clean.offset=offset;
      }
    }
    return publicBody((await this.request(name, clean)).body);
  }
  async begin() {
    const version = ++this.generation; this.attempt = undefined;
    const keyResult = await this.request('login_qr_key');
    const key = keyResult.body?.data?.unikey;
    if (typeof key !== 'string' || !key || key.length > 1000) throw new DomainError('NETEASE_INVALID_RESPONSE');
    const qr = await this.request('login_qr_create', { key, qrimg: true });
    const image = qr.body?.data?.qrimg;
    if (typeof image !== 'string' || image.length > 500000 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image)) throw new DomainError('NETEASE_INVALID_RESPONSE');
    if (version !== this.generation) throw new DomainError('NETEASE_LOGIN_REPLACED');
    const id = randomUUID(); this.attempt = { id, key, expiresAt: this.now() + 180000, lastCheck: -Infinity, code: 801 };
    return { sessionId: id, image, expiresAt: this.attempt.expiresAt };
  }
  async passwordLogin(input: PasswordLogin) {
    const version = ++this.generation; this.attempt = undefined;
    const params = input.type === 'phone'
      ? { phone: input.phone, countrycode: input.countrycode, password: input.password }
      : { email: input.email, password: input.password };
    const result = await this.request(input.type === 'phone' ? 'login_cellphone' : 'login', params);
    if (version !== this.generation) throw new DomainError('NETEASE_LOGIN_REPLACED');
    if (Number(result.body?.code) !== 200) {
      if ([501, 502].includes(Number(result.body?.code))) throw new DomainError('INVALID_CREDENTIALS');
      throw new DomainError('NETEASE_LOGIN_REJECTED');
    }
    await this.saveCredential(result);
    return { code: 200 };
  }
  private async saveCredential(result: Result) {
    const cookie = Array.isArray(result.cookie) && result.cookie.length ? result.cookie.map(c => c.split(';')[0]).join('; ') : result.body.cookie;
    if (typeof cookie !== 'string' || cookie.length > 64000 || !/(?:^|;\s*)MUSIC_U=[^;\s]+/.test(cookie)) throw new DomainError('NETEASE_INVALID_RESPONSE');
    await this.db.setSetting('netease.cookie', cookie);
  }
  async check(id: string): Promise<{ code: number }> {
    const attempt = this.attempt;
    if (!attempt || attempt.id !== id) throw new DomainError('NETEASE_LOGIN_REPLACED');
    if (attempt.code === 803) return { code: 803 };
    if (this.now() >= attempt.expiresAt || attempt.code === 800) return { code: 800 };
    if (attempt.pending) return attempt.pending;
    if (this.now() - attempt.lastCheck < 2000) return { code: attempt.code };
    attempt.lastCheck = this.now();
    attempt.pending = (async () => {
      const result = await this.request('login_qr_check', { key: attempt.key, noCookie: true });
      if (this.attempt !== attempt || this.now() >= attempt.expiresAt) throw new DomainError('NETEASE_LOGIN_REPLACED');
      const code = Number(result.body?.code);
      if (![800, 801, 802, 803].includes(code)) throw new DomainError('NETEASE_INVALID_RESPONSE');
      if (code === 803) {
        await this.saveCredential(result);
      }
      attempt.code = code; return { code };
    })();
    try { return await attempt.pending; } finally { attempt.pending = undefined; }
  }
}
