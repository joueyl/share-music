import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { Database } from './database';
import { DomainError } from './engine';

type Result = { body: Record<string, any>; cookie?: string[] };
export type MusicInvoker = (name: string, params: Record<string, unknown>) => Promise<Result>;
// The upstream library logs raw error responses. Isolate and discard its output so
// login cookies never reach server logs; terminating the worker also bounds requests.
const invoke: MusicInvoker = (name, params) => new Promise((resolve, reject) => {
  const worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads');
    (async()=>{try{const api=require(workerData.module);if(!Object.hasOwn(api,workerData.name)||typeof api[workerData.name]!=='function')throw Error();const result=await api[workerData.name](workerData.params);parentPort.postMessage({ok:true,result});}catch{parentPort.postMessage({ok:false});}})();`,
    { eval: true, workerData: { module: require.resolve('NeteaseCloudMusicApi'), name, params }, stdout: true, stderr: true });
  worker.stdout?.resume(); worker.stderr?.resume();
  const timer = setTimeout(() => { void worker.terminate(); reject(new DomainError('NETEASE_UNAVAILABLE')); }, 18000);
  const finish = () => { clearTimeout(timer); void worker.terminate(); };
  worker.once('message', message => { finish(); message.ok ? resolve(message.result) : reject(new DomainError('NETEASE_UNAVAILABLE')); });
  worker.once('error', () => { finish(); reject(new DomainError('NETEASE_UNAVAILABLE')); });
  worker.once('exit', () => { clearTimeout(timer); reject(new DomainError('NETEASE_UNAVAILABLE')); });
});
export const musicMethods = new Set(['search', 'search_suggest', 'cloudsearch', 'song_detail', 'song_url', 'song_url_v1', 'lyric', 'playlist_detail', 'user_playlist', 'user_account', 'user_cloud', 'login_status']);
function publicBody(value: any): any {
  if (Array.isArray(value)) return value.map(publicBody);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !/^(cookie|token|accessToken|refreshToken|__csrf|MUSIC_U)$/i.test(k)).map(([k, v]) => [k, publicBody(v)]));
  return value;
}
export class NeteaseService {
  private attempt?: { id: string; key: string; expiresAt: number; lastCheck: number; code: number; pending?: Promise<{ code: number }> };
  private generation = 0;
  constructor(private db: Database, private api: MusicInvoker = invoke, private now = Date.now) {}
  private async request(name: string, params: Record<string, unknown> = {}) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.api(name, { ...params, cookie: this.db.getSetting('netease.cookie') ?? '', timestamp: this.now() }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DomainError('NETEASE_UNAVAILABLE')), 20000); }),
      ]);
    } catch { throw new DomainError('NETEASE_UNAVAILABLE'); }
    finally { clearTimeout(timer); }
  }
  async call(name: string, params: Record<string, unknown>) {
    if (!musicMethods.has(name)) throw new DomainError('NETEASE_METHOD_NOT_ALLOWED');
    // Do not allow browser callers to inject credentials, proxies or network addresses.
    const allowed = new Set(['keywords', 'limit', 'offset', 'type', 'id', 'ids', 'uid', 'level', 'br']);
    const clean = Object.fromEntries(Object.entries(params).filter(([key]) => allowed.has(key)));
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
        const cookie = Array.isArray(result.cookie) && result.cookie.length ? result.cookie.map(c => c.split(';')[0]).join('; ') : result.body.cookie;
        if (typeof cookie !== 'string' || cookie.length > 64000 || !/(?:^|;\s*)MUSIC_U=[^;\s]+/.test(cookie)) throw new DomainError('NETEASE_INVALID_RESPONSE');
        this.db.setSetting('netease.cookie', cookie);
      }
      attempt.code = code; return { code };
    })();
    try { return await attempt.pending; } finally { attempt.pending = undefined; }
  }
}
