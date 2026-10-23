import { Body, Controller, Get, Headers, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppService } from './app.service';
import { DomainError } from './engine';
import { httpError } from './controller';
import { loginPage } from './netease.page';

export function adminAllowed(req: Pick<Request, 'headers' | 'socket'>, secret = process.env.NETEASE_ADMIN_TOKEN) {
  if (secret) {
    const expected = 'Basic ' + Buffer.from('admin:' + secret).toString('base64');
    const hash = (v: string) => createHash('sha256').update(v).digest();
    return timingSafeEqual(hash(req.headers.authorization ?? ''), hash(expected));
  }
  const ip = req.socket.remoteAddress;
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip ?? '') && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host ?? '') && !req.headers['x-forwarded-for'];
}
@Controller()
export class NeteaseController {
  constructor(@Inject(AppService) private app: AppService) {}
  private admin(req: Request, res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    if (!adminAllowed(req)) { res.setHeader('WWW-Authenticate', 'Basic realm="Music login", charset="UTF-8"'); throw new DomainError('UNAUTHORIZED'); }
    // JSON POSTs must originate from this page, not a cross-origin form.
    if (req.method === 'POST' && req.headers.origin && req.headers.origin !== (process.env.NETEASE_LOGIN_ORIGIN || `${req.protocol}://${req.headers.host}`)) throw new DomainError('FORBIDDEN');
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
  @Get('api/netease/:method') async get(@Param('method') method: string, @Query() query: unknown, @Headers('authorization') header?: string) { return this.call(method, query, header); }
  @Post('api/netease/:method') async post(@Param('method') method: string, @Body() body: unknown, @Headers('authorization') header?: string) { return this.call(method, body, header); }
  private async call(method: string, params: unknown, header?: string) {
    try {
      if (!header?.startsWith('Bearer ')) throw new DomainError('UNAUTHORIZED');
      const user = this.app.auth.verify(header.slice(7)); this.app.limit(`netease:${method === 'search_suggest' ? 'suggest:' : ''}${user.id}`, method === 'search_suggest' ? 120 : 60, 60000);
      const input = z.record(z.union([z.string().max(4000), z.number().finite(), z.boolean()])).parse(params);
      return await this.app.netease.call(method, input);
    } catch (e) { httpError(e); }
  }
}
