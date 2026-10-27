import { Body, Controller, Get, Header, Headers, HttpException, Inject, Param, Post, Put, Query, Req, StreamableFile } from '@nestjs/common';
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
  if (error instanceof DomainError) throw new HttpException({ error: error.code }, error.code === 'UNAUTHORIZED' || error.code === 'INVALID_CREDENTIALS' ? 401 : error.code === 'RATE_LIMITED' ? 429 : error.code === 'HOST_ONLY' || error.code === 'FORBIDDEN' || error.code === 'NETEASE_LOGIN_ORIGIN_FORBIDDEN' ? 403 : 400);
  throw error;
}
@Controller('api')
export class ApiController {
  constructor(@Inject(AppService) private app: AppService) {}
  private get oss() { return this.app.oss; }
  @Get('music/uploaded') uploadedMusic(@Query() query:unknown,@Headers('authorization') header?:string) {
    try {
      const user=this.user(header);this.app.limit(`music-uploaded:${user.id}`,60,60000);
      const {keywords,offset,limit}=z.object({keywords:z.string().trim().max(100).default(''),offset:z.coerce.number().int().min(0).max(1000000).default(0),limit:z.coerce.number().int().min(1).max(100).default(20)}).strict().parse(query);
      return this.app.database.uploadedMusic(this.oss.scope(),keywords,offset,limit);
    }catch(e){httpError(e);}
  }
  @Post('rooms/:id/music/netease') async addNetease(@Param('id') id: string, @Body() body: unknown, @Headers('authorization') header?: string) {
    try { const user=this.user(header); this.app.limit(`music-import:${user.id}`,200,600000);
      const {songId,requestId}=z.object({songId:z.string().regex(/^\d{1,20}$/),requestId:z.string().uuid()}).strict().parse(body);
      const track=await this.app.musicImport.add(z.string().uuid().parse(id),user.id,songId,requestId);
      return {ok:true,track};
    } catch(e) {httpError(e);}
  }
  @Post('rooms/:id/music/uploaded') async addUploaded(@Param('id') id:string,@Body() body:unknown,@Headers('authorization') header?:string) {
    try{
      const user=this.user(header);this.app.limit(`music-import:${user.id}`,200,600000);
      const {hash,requestId}=z.object({hash:z.string().regex(/^[a-f0-9]{64}$/),requestId:z.string().uuid()}).strict().parse(body);
      return {ok:true,track:await this.app.musicImport.addUploaded(z.string().uuid().parse(id),user.id,hash,requestId)};
    }catch(e){httpError(e);}
  }
  @Post('rooms/:id/music/play') playMusic(@Param('id') id:string,@Body() body:unknown,@Headers('authorization') header?:string) {
    try {
      const user=this.user(header);this.app.limit(`music-play:${user.id}`,60,60000);
      const {trackId,requestId}=z.object({trackId:z.string().uuid(),requestId:z.string().uuid()}).strict().parse(body);
      const roomId=z.string().uuid().parse(id),room=this.app.engine.snapshot(roomId);
      const stateVersion=this.app.engine.command(user.id,{roomId,commandId:requestId,expectedStateVersion:room.stateVersion,action:{type:'play',payload:{trackId}}});
      return {ok:true,stateVersion};
    }catch(e){httpError(e);}
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
  @Get('rooms/:id/music/:trackId/cover') async cover(@Param('id') id:string,@Param('trackId') trackId:string,@Headers('authorization') header?:string) {
    try {
      const user=this.user(header);this.app.limit(`music-cover:${user.id}`,30,60000);
      return {coverUrl:await this.app.musicImport.cover(z.string().uuid().parse(id),user.id,z.string().uuid().parse(trackId))};
    }catch(e){httpError(e);}
  }
  @Get('rooms/:id/music/:trackId/audio') @Header('Cache-Control','private, no-store') async browserAudio(@Param('id') id:string,@Param('trackId') trackId:string,@Headers('authorization') header?:string) {
    try{
      const user=this.user(header);this.app.limit(`browser-audio:${user.id}`,30,60000);
      const roomId=z.string().uuid().parse(id),songId=z.string().uuid().parse(trackId);
      const track=this.app.musicImport.metadata(roomId,user.id,songId);
      if(!track.ossKey)throw new DomainError('TRACK_NOT_FOUND');
      const bytes=await this.oss.readAudio(track.ossKey,track.sizeBytes,track.contentHash);
      // Recheck membership after downloading, before returning any audio bytes.
      this.app.musicImport.metadata(roomId,user.id,songId);
      return new StreamableFile(bytes,{type:'application/octet-stream',length:bytes.length});
    }catch(e){httpError(e);}
  }
  private user(header?: string) { if (!header?.startsWith('Bearer ')) throw new DomainError('UNAUTHORIZED'); return this.app.auth.verify(header.slice(7)); }
  @Get('rooms/:id/music/:trackId/metadata') metadata(@Param('id') id:string,@Param('trackId') trackId:string,@Headers('authorization') header?:string) {
    try { const user=this.user(header);return this.app.musicImport.metadata(z.string().uuid().parse(id),user.id,z.string().uuid().parse(trackId)); } catch(e){httpError(e);}
  }
  @Get('health') health() { return { ok: true, protocolVersion: 1, chatProtocolVersion: 1, relayUsedBps: this.app.capacity.usedBps, relayBudgetBps: this.app.capacity.budget, turnProvider: this.app.turn.provider, publicRelayUsedBps: this.app.publicCapacity.usedBps, publicRelayBudgetBps: this.app.publicCapacity.budget }; }
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
