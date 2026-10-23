import { afterEach, expect, it, vi } from 'vitest';
import OSS from 'ali-oss';
import { Database } from '../src/database';
import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OssStorage, ossOptions, ossFailure, OssUploadError, musicFilename, validMusicKey } from '../src/oss';

const env = {
  OSS_BUCKET: 'jouei-music-share', OSS_REGION: 'cn-hangzhou',
  OSS_ACCESS_POINT_ENDPOINT: 'node-1463865318371961.oss-cn-hangzhou.oss-accesspoint.aliyuncs.com',
  OSS_ACCESS_POINT_ALIAS: 'node-c20dbedd7a8f7525f7acb47894c523771a-ossalias',
  OSS_ACCESS_KEY_ID: 'test-id', OSS_ACCESS_KEY_SECRET: 'test-secret',
};
const user = '11111111-1111-4111-8111-111111111111';
const key = `music/${user}/22222222-2222-4222-8222-222222222222`;
afterEach(() => vi.useRealTimers());

it('routes to the complete access-point host and signs with the alias, not the associated bucket', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-23T00:00:00Z'));
  const options = ossOptions(env);
  expect(options.bucket).toBe(env.OSS_ACCESS_POINT_ALIAS);
  expect(options.cname).toBe(true); expect(options.authorizationV4).toBe(true);
  const url = new URL(await new OssStorage(env).url(key));
  expect(url.protocol).toBe('https:'); expect(url.hostname).toBe(env.OSS_ACCESS_POINT_ENDPOINT);
  expect(url.pathname).toBe('/' + key);
  expect(url.searchParams.get('x-oss-signature-version')).toBe('OSS4-HMAC-SHA256');
  expect(url.searchParams.get('x-oss-credential')).toBe('test-id/20261023/cn-hangzhou/oss/aliyun_v4_request');
  expect(url.searchParams.get('x-oss-expires')).toBe('3600');
  expect(url.searchParams.get('x-oss-signature')).toMatch(/^[a-f0-9]{64}$/);
  expect(url.href).not.toContain('test-secret'); expect(url.href).not.toContain('jouei-music-share.');
  const wrongResource = new OSS({ ...options, bucket: env.OSS_BUCKET });
  const wrong = new URL(await wrongResource.signatureUrlV4('GET', 3600, {}, key));
  expect(url.searchParams.get('x-oss-signature')).not.toBe(wrong.searchParams.get('x-oss-signature'));
});
it('keeps standard bucket endpoints supported with V4 signatures', async () => {
  const standard = { ...env, OSS_ACCESS_POINT_ENDPOINT: '', OSS_ACCESS_POINT_ALIAS: '', OSS_ENDPOINT: 'oss-cn-hangzhou.aliyuncs.com' };
  const url = new URL(await new OssStorage(standard).url(key));
  expect(url.hostname).toBe('jouei-music-share.oss-cn-hangzhou.aliyuncs.com');
  expect(url.searchParams.get('x-oss-signature-version')).toBe('OSS4-HMAC-SHA256');
});
it('signs upload and playback differently, and supports STS tokens', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-23T00:00:00Z'));
  const oss = new OssStorage({ ...env, OSS_SECURITY_TOKEN: 'temporary-token' });
  const get = new URL(await oss.url(key)), put = new URL(await oss.url(key, 'PUT'));
  expect(get.searchParams.get('x-oss-signature')).not.toBe(put.searchParams.get('x-oss-signature'));
  expect(get.searchParams.get('x-oss-security-token')).toBe('temporary-token');
});
it('requires credentials and rejects incomplete access-point settings without falling back to the bucket', () => {
  expect(() => ossOptions({ ...env, OSS_ACCESS_KEY_SECRET: '' })).toThrow('OSS_NOT_CONFIGURED');
  expect(() => ossOptions({ ...env, OSS_ACCESS_POINT_ALIAS: '' })).toThrow('OSS_ACCESS_POINT_INCOMPLETE');
  expect(() => ossOptions({ ...env, OSS_ACCESS_POINT_ENDPOINT: '' })).toThrow('OSS_ACCESS_POINT_INCOMPLETE');
});
it.each([
  { OSS_REGION: 'cn-shanghai' }, { OSS_ACCESS_POINT_ALIAS: 'not-an-alias' },
  { OSS_ACCESS_POINT_ENDPOINT: 'http://example.com' },
  { OSS_ACCESS_POINT_ENDPOINT: 'node.oss-cn-hangzhou.oss-accesspoint.aliyuncs.com.evil.test' },
  { OSS_ACCESS_POINT_ENDPOINT: env.OSS_ACCESS_POINT_ENDPOINT + '/path?x=y' },
])('rejects malformed or region-mismatched configuration %#', change => {
  expect(() => ossOptions({ ...env, ...change })).toThrow('OSS_INVALID_CONFIG');
});
it('uploads original bytes only to the signed access-point address without redirects', async () => {
  const request = vi.fn(async (_url:unknown,options?:RequestInit) => new Response(null, { status: options?.method==='HEAD'?404:200 }));
  const data = Buffer.from('audio fixture');
  const result = await new OssStorage(env, request as typeof fetch).upload(user, data, '晴天.mp3');
  expect(result.ossKey).toMatch(/^music\/files\/[a-f0-9]{64}\/晴天\.mp3$/);
  expect(request).toHaveBeenCalledTimes(2);
  const [address, options] = request.mock.calls[1] as unknown as [string, RequestInit];
  expect(new URL(address).hostname).toBe(env.OSS_ACCESS_POINT_ENDPOINT);
  expect(options.method).toBe('PUT'); expect(options.redirect).toBe('error');
  expect(Buffer.from(options.body as Uint8Array)).toEqual(data);
});
it('sanitizes network/provider failures and rejects invalid keys and empty files before network access', async () => {
  const request = vi.fn().mockRejectedValue(new Error('sensitive signed URL'));
  const oss = new OssStorage(env, request);
  await expect(oss.upload(user, Buffer.from('audio'))).rejects.toThrow(/^OSS_UPLOAD_FAILED$/);
  await expect(oss.upload(user, Buffer.alloc(0))).rejects.toThrow('INVALID_AUDIO');
  await expect(oss.url('music/../../private')).rejects.toThrow('OSS_INVALID_KEY');
  expect(request).toHaveBeenCalledOnce();
});

it('returns only allowlisted OSS failure details and never returns raw upstream messages or signatures', async () => {
  const xml = '<Error><Code>AccessDenied</Code><Message>secret raw signed URL</Message><RequestId>ABC123</RequestId><EC>0003-00000001</EC><StringToSign>sensitive</StringToSign></Error>';
  const request = vi.fn(async () => new Response(xml, { status: 403 }));
  try { await new OssStorage(env, request as typeof fetch).upload(user, Buffer.from('audio')); throw new Error('expected failure'); }
  catch (e) {
    expect(e).toBeInstanceOf(OssUploadError);
    expect((e as OssUploadError).details).toEqual({ status: 403, ossCode: 'AccessDenied', requestId: 'ABC123', ec: '0003-00000001' });
    expect(JSON.stringify(e)).not.toContain('sensitive'); expect(JSON.stringify(e)).not.toContain('secret raw');
  }
});
it('bounds unknown error bodies and uses request headers only when safe', async () => {
  const details = await ossFailure(new Response('<Code>UntrustedSecretValue</Code><RequestId>bad request</RequestId>' + 'x'.repeat(20000), { status: 500 }));
  expect(details).toEqual({ status: 500, ossCode: 'Unknown' });
  expect(await ossFailure(new Response('not XML', { status: 503, headers: { 'x-oss-request-id': 'SAFE-ID' } }))).toEqual({ status: 503, ossCode: 'Unknown', requestId: 'SAFE-ID' });
});
it('keeps timeout separate from other transport errors', async () => {
  const request = vi.fn().mockRejectedValue(new DOMException('URL must not be exposed', 'TimeoutError'));
  await expect(new OssStorage(env, request).upload(user, Buffer.from('audio'))).rejects.toMatchObject({ code: 'OSS_UPLOAD_FAILED', details: { ossCode: 'Timeout' } });
});

function objectStore(){
 const objects=new Set<string>();
 const request=vi.fn(async(address:unknown,options?:RequestInit)=>{const url=new URL(String(address)),key=url.host+decodeURIComponent(url.pathname);if(options?.method==='HEAD')return new Response(null,{status:objects.has(key)?200:404});objects.add(key);return new Response(null,{status:200});});
 return {request,objects,puts:()=>request.mock.calls.filter(([,options])=>options?.method==='PUT').length};
}
it('preserves real Unicode names and extensions while excluding unsafe paths',async()=>{
 expect(musicFilename('晴天.mp3')).toBe('晴天.mp3');expect(musicFilename('Love Story.MP3')).toBe('Love Story.mp3');
 const safe=musicFilename('../坏/名字?.mp3');expect(safe).not.toContain('/');expect(safe).not.toContain('..');
 const key='music/files/'+'a'.repeat(64)+'/晴天.mp3';expect(validMusicKey(key)).toBe(true);
 expect(decodeURIComponent(new URL(await new OssStorage(env).url(key)).pathname)).toBe('/'+key);
 expect(validMusicKey('music/files/'+'a'.repeat(64)+'/../private.mp3')).toBe(false);
});
it('deduplicates by content across names and survives closing/reopening the database',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'music-assets-')),path=join(dir,'test.sqlite');let db=new Database(path);const store=objectStore();
 try{
 const first=await new OssStorage(env,store.request as typeof fetch,db).upload(user,Buffer.from('same audio'),'晴天.mp3');db.close();db=new Database(path);
 const second=await new OssStorage(env,store.request as typeof fetch,db).upload(user,Buffer.from('same audio'),'改名.mp3');
 expect(second.ossKey).toBe(first.ossKey);expect(second.ossKey).toContain('/晴天.mp3');expect(store.puts()).toBe(1);
 }finally{db.close();unlinkSync(path);rmdirSync(dir);}
});
it('coalesces concurrent uploads of identical content and keeps different same-name recordings separate',async()=>{
 const store=objectStore(),oss=new OssStorage(env,store.request as typeof fetch);
 const [a,b]=await Promise.all([oss.upload(user,Buffer.from('one'),'歌曲.mp3'),oss.upload(user,Buffer.from('one'),'other.mp3')]);expect(a.ossKey).toBe(b.ossKey);expect(store.puts()).toBe(1);
 const c=await oss.upload(user,Buffer.from('two'),'歌曲.mp3');expect(c.ossKey).not.toBe(a.ossKey);expect(store.puts()).toBe(2);
});
it('recovers without duplicate PUT when OSS already has the deterministic object, even without an index',async()=>{
 const request=vi.fn(async()=>new Response(null,{status:200}));const result=await new OssStorage(env,request as typeof fetch).upload(user,Buffer.from('existing'),'歌曲.mp3');
 expect(result.ossKey).toContain('/歌曲.mp3');expect(request).toHaveBeenCalledOnce();expect(request.mock.calls[0]).toBeDefined();
});
it('does not treat denied existence checks as missing objects and never issues PUT on 403',async()=>{
 const request=vi.fn(async()=>new Response(null,{status:403}));await expect(new OssStorage(env,request as typeof fetch).upload(user,Buffer.from('audio'),'歌曲.mp3')).rejects.toMatchObject({details:{status:403}});expect(request).toHaveBeenCalledOnce();
});
it('re-uploads an indexed object only if it was actually removed from OSS',async()=>{
 const db=new Database(':memory:'),store=objectStore();try{const oss=new OssStorage(env,store.request as typeof fetch,db);const a=await oss.upload(user,Buffer.from('audio'),'歌曲.mp3');store.objects.clear();const b=await oss.upload(user,Buffer.from('audio'),'歌曲.mp3');expect(b.ossKey).toBe(a.ossKey);expect(store.puts()).toBe(2);}finally{db.close();}
});
