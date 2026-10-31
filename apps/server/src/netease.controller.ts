import { Body, Controller, Get, Headers, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppService } from './app.service';
import { DomainError } from './engine';
import { httpError } from './controller';
import { loginPage } from './netease.page';

const password = z.string().min(1).max(128);
export const neteasePasswordSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('phone'), phone: z.string().trim().regex(/^\d{5,20}$/), countrycode: z.string().trim().regex(/^\d{1,4}$/).default('86'), password }).strict(),
  z.object({ type: z.literal('email'), email: z.string().trim().email().max(254), password }).strict(),
]);

export function adminAllowed(req: Pick<Request, 'headers' | 'socket'>, secret = process.env.NETEASE_ADMIN_TOKEN) {
  if (secret) {
    const expected = 'Basic ' + Buffer.from('admin:' + secret).toString('base64');
    const hash = (v: string) => createHash('sha256').update(v).digest();
    return timingSafeEqual(hash(req.headers.authorization ?? ''), hash(expected));
  }
  const ip = req.socket.remoteAddress;
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip ?? '') && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host ?? '') && !req.headers['x-forwarded-for'];
}
function normalizedOrigin(value:string):string|undefined {
  try {const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)return undefined;return url.origin;}catch{return undefined;}
}
/** Forwarded protocol is accepted only from a directly connected loopback proxy.
 * Docker/remote proxies should set the explicit public origin instead. */
export function loginOriginAllowed(req:Pick<Request,'headers'|'socket'|'protocol'>, configured=process.env.NETEASE_LOGIN_ORIGIN):boolean {
  if(req.headers['sec-fetch-site']==='cross-site')return false;
  const raw=req.headers.origin;
  if(!raw)return true; // Authenticated non-browser clients may omit Origin.
  if(typeof raw!=='string')return false;
  const origin=normalizedOrigin(raw);if(!origin)return false;
  if(configured?.trim())return origin===normalizedOrigin(configured.trim());
  const loopback=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'');
  const forwarded=req.headers['x-forwarded-proto'];
  const protocol=loopback&&(forwarded==='http'||forwarded==='https')?forwarded:req.protocol;
  return origin===normalizedOrigin(`${protocol}://${req.headers.host}`);
}
@Controller()
export class NeteaseController {
  constructor(@Inject(AppService) private app: AppService) {}
  private admin(req: Request, res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    if (!adminAllowed(req)) { res.setHeader('WWW-Authenticate', 'Basic realm="Music login", charset="UTF-8"'); throw new DomainError('UNAUTHORIZED'); }
    // JSON POSTs must originate from this page, not a cross-origin form.
    if (req.method === 'POST' && !loginOriginAllowed(req)) throw new DomainError('NETEASE_LOGIN_ORIGIN_FORBIDDEN');
    this.app.limit(`netease-admin:${req.socket.remoteAddress}`, 60, 60000);
  }
  @Get('loginServe') page(@Req() req: Request, @Res() res: Response) {
    try { this.admin(req, res); res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); return res.type('html').send(loginPage); } catch (e) { httpError(e); }
  }
  @Post('loginServe/qr') async qr(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try { this.admin(req, res); this.app.limit('netease-qr', 10, 60000); return await this.app.netease.begin(); } catch (e) { httpError(e); }
  }
  @Post('loginServe/check') async check(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    try { this.admin(req, res); const { sessionId } = z.object({ sessionId: z.string().uuid() }).strict().parse(body); return await this.app.netease.check(sessionId); } catch (e) { httpError(e); }
  }
  @Post('loginServe/password') async password(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    try { this.admin(req, res); this.app.limit(`netease-password:${req.socket.remoteAddress}`, 5, 60000); this.app.limit('netease-password', 10, 60000); return await this.app.netease.passwordLogin(neteasePasswordSchema.parse(body)); } catch (e) { httpError(e); }
  }
  @Get('api/netease/:method') async get(@Param('method') method: string, @Query() query: unknown, @Headers('authorization') header?: string) { return this.call(method, query, header); }
  @Post('api/netease/:method') async post(@Param('method') method: string, @Body() body: unknown, @Headers('authorization') header?: string) { return this.call(method, body, header); }
  private async call(method: string, params: unknown, header?: string) {
    try {
      if (!header?.startsWith('Bearer ')) throw new DomainError('UNAUTHORIZED');
      const user = await this.app.auth.verify(header.slice(7)); this.app.limit(`netease:${method === 'search_suggest' ? 'suggest:' : ''}${user.id}`, method === 'search_suggest' ? 120 : 60, 60000);
      const input = z.record(z.union([z.string().max(4000), z.number().finite(), z.boolean()])).parse(params);
      return await this.app.netease.call(method, input);
    } catch (e) { httpError(e); }
  }
}
