import { expect, it } from 'vitest';
import { apiResponse } from '../src/api-response';
it('shows the safe provider code and RequestId for OSS failures', async () => {
 const response = new Response(JSON.stringify({ error: 'OSS_UPLOAD_FAILED', details: { ossCode: 'AccessDenied', requestId: 'ABC123', message: 'must not expose' } }), { status: 502 });
 await expect(apiResponse(response)).rejects.toThrow('OSS 拒绝访问，请检查 RAM、Bucket 委派及接入点策略（AccessDenied，RequestId=ABC123）');
});
it('handles non-JSON proxy errors without showing HTML or failing JSON parsing', async () => {
 await expect(apiResponse(new Response('<html>secret</html>', { status: 413 }))).rejects.toThrow('HTTP 413');
 await expect(apiResponse(new Response('<html>secret</html>', { status: 502 }))).rejects.toThrow('非 JSON');
});
it('does not display arbitrary provider fields or non-code error strings', async () => {
 await expect(apiResponse(new Response(JSON.stringify({ error: 'https://secret-link?Signature=secret' }), { status: 400 }))).rejects.toThrow(/^HTTP 400$/);
 await expect(apiResponse(new Response(JSON.stringify({ error: 'OSS_UPLOAD_FAILED', details: { ossCode: 'Unknown', requestId: 'https://secret-link' } }), { status: 502 }))).rejects.toThrow(/^OSS 上传失败（Unknown）$/);
});
it('preserves successful data and normal domain errors', async () => {
 await expect(apiResponse(new Response(JSON.stringify({ ossKey: 'key' }), { status: 200 }))).resolves.toEqual({ ossKey: 'key' });
 await expect(apiResponse(new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 }))).rejects.toThrow('UNAUTHORIZED');
});
