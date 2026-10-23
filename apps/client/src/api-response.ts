const reasons: Record<string, string> = {
 AccessDenied: 'OSS 拒绝访问，请检查 RAM、Bucket 委派及接入点策略',
 SignatureDoesNotMatch: 'OSS 签名校验失败，请检查凭据、接入点别名和地域',
 InvalidAccessKeyId: 'OSS AccessKey 无效或已禁用', InvalidSecurityToken: 'OSS 临时凭据无效', SecurityTokenExpired: 'OSS 临时凭据已过期',
 RequestTimeTooSkewed: '服务器时间偏差过大，请校准时间', RequestHasExpired: 'OSS 签名已过期',
 NoSuchBucket: 'OSS Bucket 不存在', NoSuchAccessPoint: 'OSS 接入点不存在',
 PublicEndpointForbidden: 'OSS 拒绝当前公网访问入口', Timeout: '服务端连接 OSS 超时', NetworkError: '服务端无法连接 OSS，请检查 DNS、TLS 或代理网络',
};
export async function apiResponse(response: Response): Promise<any> {
 let data: any; try { data = await response.json(); } catch { throw new Error(response.status === 413 ? '上传文件超过服务器或代理限制（HTTP 413）' : `服务器返回非 JSON 响应（HTTP ${response.status}）`); }
 if (response.ok) return data;
 if (data?.error === 'OSS_UPLOAD_FAILED') {
   const d = data.details, reason = reasons[d?.ossCode] ?? 'OSS 上传失败';
   const code = typeof d?.ossCode === 'string' && /^[A-Za-z]{1,40}$/.test(d.ossCode) ? d.ossCode : 'Unknown';
   const requestId = typeof d?.requestId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(d.requestId) ? `，RequestId=${d.requestId}` : '';
   throw new Error(`${reason}（${code}${requestId}）`);
 }
 throw new Error(typeof data?.error === 'string' && /^[A-Z0-9_]{1,80}$/.test(data.error) ? data.error : `HTTP ${response.status}`);
}
