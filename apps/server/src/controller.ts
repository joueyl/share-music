import { Body, Controller, Get, Headers, HttpException, Inject, Param, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { permissionsSchema } from '../../../packages/shared/src';
import { AppService } from './app.service';
import { OssStorage, OssUploadError } from './oss';
import { DomainError } from './engine';
const loginSchema = z.object({ name: z.string().trim().min(2).max(40), password: z.string().min(10).max(128), register: z.boolean().default(false) }).strict();
export function httpError(error: unknown): never {
  if (error instanceof OssUploadError) throw new HttpException({ error: error.code, details: error.details }, error.details.ossCode === 'Timeout' ? 504 : 502);
  if (error instanceof z.ZodError) throw new HttpException({ error: 'INVALID_REQUEST', issues: error.issues.map(i => ({ path: i.path, message: i.message })) }, 400);
  if (error instanceof DomainError) throw new HttpException({ error: error.code }, error.code === 'UNAUTHORIZED' || error.code === 'INVALID_CREDENTIALS' ? 401 : error.code === 'RATE_LIMITED' ? 429 : error.code === 'HOST_ONLY' || error.code === 'FORBIDDEN' ? 403 : 400);
  throw error;
}
@Controller('api')
export class ApiController {
  constructor(@Inject(AppService) private app: AppService) {}
  private get oss() { return this.app.oss; }
  @Post('rooms/:id/music/netease') async addNetease(@Param('id') id: string, @Body() body: unknown, @Headers('authorization') header?: string) {
    try { const user=this.user(header); this.app.limit(`music-import:${user.id}`,10,60000);
      const {songId,requestId}=z.object({songId:z.string().regex(/^\d{1,20}$/),requestId:z.string().uuid()}).strict().parse(body);
      const track=await this.app.musicImport.add(z.string().uuid().parse(id),user.id,songId,requestId);
      return {ok:true,track};
    } catch(e) {httpError(e);}
  }
  @Post('music/upload') async upload(@Req() req: Request, @Headers('authorization') header?: string, @Headers('x-music-filename') encodedName?:string) {
    try { const user = this.user(header); this.app.limit(`upload:${user.id}`, 10, 60000);
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw new DomainError('INVALID_AUDIO');
      let name='音乐.bin';if(encodedName){try{name=decodeURIComponent(encodedName);}catch{throw new DomainError('INVALID_AUDIO');}if(name.length>500)throw new DomainError('INVALID_AUDIO');}
      return await this.oss.upload(user.id, req.body,name);
    } catch (e) { httpError(e); }
  }
  @Get('rooms/:id/music/:trackId') async music(@Param('id') id: string, @Param('trackId') trackId: string, @Headers('authorization') header?: string) {
    try { const user = this.user(header), room = this.app.engine.snapshot(id);
      if (!room.members.some(m => m.id === user.id && m.online)) throw new DomainError('NOT_IN_ROOM');
      const track = room.playlist.find(t => t.id === trackId);
      if (!track?.ossKey) throw new DomainError('TRACK_NOT_FOUND');
      return { url: await this.oss.url(track.ossKey) };
    } catch (e) { httpError(e); }
  }
  private user(header?: string) { if (!header?.startsWith('Bearer ')) throw new DomainError('UNAUTHORIZED'); return this.app.auth.verify(header.slice(7)); }
  @Get('health') health() { return { ok: true, protocolVersion: 1, relayUsedBps: this.app.capacity.usedBps, relayBudgetBps: this.app.capacity.budget, turnProvider: this.app.turn.provider, publicRelayUsedBps: this.app.publicCapacity.usedBps, publicRelayBudgetBps: this.app.publicCapacity.budget }; }
  @Post('login') async login(@Body() body: unknown, @Req() req: Request) {
    try { this.app.limit(`login:${req.ip}`, 10, 60000); const v = loginSchema.parse(body); return await this.app.auth.login(v.name, v.password, v.register); } catch (e) { httpError(e); }
  }
  @Get('rooms') rooms(@Headers('authorization') header?: string) { try { this.user(header); return this.app.engine.list(); } catch (e) { httpError(e); } }
  @Post('rooms') create(@Body() body: unknown, @Headers('authorization') header?: string) {
    try { const user = this.user(header); this.app.limit(`create:${user.id}`, 5, 60000); const { name } = z.object({ name: z.string().trim().min(1).max(80) }).strict().parse(body); return this.app.engine.create(name, user.id); } catch (e) { httpError(e); }
  }
  @Get('rooms/:id') room(@Param('id') id: string, @Headers('authorization') header?: string) {
    try { const user = this.user(header); const room = this.app.engine.snapshot(z.string().uuid().parse(id)); if (room.hostId !== user.id && !room.members.some(m => m.id === user.id && m.online)) throw new DomainError('NOT_IN_ROOM'); return room; } catch (e) { httpError(e); }
  }
  @Put('rooms/:id/permissions') defaults(@Param('id') id: string, @Body() body: unknown, @Headers('authorization') header?: string) {
    try {
      const user = this.user(header); const room = this.app.engine.snapshot(z.string().uuid().parse(id));
      const data = z.object({ expectedStateVersion: z.number().int().nonnegative(), defaults: permissionsSchema }).strict().parse(body);
      this.app.engine.command(user.id, { roomId: room.id, commandId: randomUUID(), expectedStateVersion: data.expectedStateVersion, action: { type: 'defaults', payload: data.defaults } });
      return this.app.engine.snapshot(id);
    } catch (e) { httpError(e); }
  }
}
