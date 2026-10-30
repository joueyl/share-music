import { Body, Controller, Get, Header, Headers, HttpException, Inject, Param, Post, Put, Query, Req, StreamableFile } from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { permissionsSchema, roomSettingsSchema } from '../../../packages/shared/src';
import { AppService } from './app.service';
import { DomainError } from './engine';
import { resolvePlaylistShareLink } from './playlist-link';
const loginSchema = z.object({ name: z.string().trim().min(2).max(40), password: z.string().min(10).max(128), register: z.boolean().default(false) }).strict();
export function httpError(error: unknown): never {
  if (error instanceof z.ZodError) throw new HttpException({ error: 'INVALID_REQUEST', issues: error.issues.map(i => ({ path: i.path, message: i.message })) }, 400);
  if (error instanceof DomainError) throw new HttpException({ error: error.code }, error.code === 'LOCAL_UPLOAD_NOT_SUPPORTED' ? 410 : error.code === 'DATABASE_UNAVAILABLE' ? 503 : error.code === 'UNAUTHORIZED' || error.code === 'INVALID_CREDENTIALS' ? 401 : error.code === 'RATE_LIMITED' ? 429 : error.code === 'HOST_ONLY' || error.code === 'FORBIDDEN' || error.code === 'NETEASE_LOGIN_ORIGIN_FORBIDDEN' ? 403 : 400);
  throw error;
}
@Controller('api')
export class ApiController {
  constructor(@Inject(AppService) private app: AppService) {}
  @Post('music/playlist/resolve') async resolvePlaylist(@Body() body:unknown,@Headers('authorization') header?:string) {
    try{
      const user=await this.user(header);this.app.limit(`playlist-resolve:${user.id}`,20,60000);this.app.limit('playlist-resolve:global',120,60000);
      const {input}=z.object({input:z.string().trim().min(1).max(4096)}).strict().parse(body);
      return await resolvePlaylistShareLink(input);
    }catch(e){httpError(e);}
  }
  @Get('music/uploaded') async uploadedMusic(@Query() query:unknown,@Headers('authorization') header?:string) {
    try {
      const user=await this.user(header);this.app.limit(`music-uploaded:${user.id}`,60,60000);
      const {keywords,offset,limit}=z.object({keywords:z.string().trim().max(100).default(''),offset:z.coerce.number().int().min(0).max(1000000).default(0),limit:z.coerce.number().int().min(1).max(100).default(20)}).strict().parse(query);
      return await this.app.database.musicLibrary(keywords,offset,limit);
    }catch(e){httpError(e);}
  }
  @Post('rooms/:id/music/netease') async addNetease(@Param('id') id: string, @Body() body: unknown, @Headers('authorization') header?: string) {
    try { const user=await this.user(header); this.app.limit(`music-import:${user.id}`,200,600000);
      const {songId,requestId}=z.object({songId:z.string().regex(/^\d{1,20}$/),requestId:z.string().uuid()}).strict().parse(body);
      const track=await this.app.musicImport.add(z.string().uuid().parse(id),user.id,songId,requestId);
      await this.app.flush();return {ok:true,track};
    } catch(e) {httpError(e);}
  }
  @Post('rooms/:id/music/uploaded') async addUploaded(@Param('id') id:string,@Body() body:unknown,@Headers('authorization') header?:string) {
    try{
      const user=await this.user(header);this.app.limit(`music-import:${user.id}`,200,600000);
      const {hash,requestId}=z.object({hash:z.string().regex(/^[a-f0-9]{64}$/),requestId:z.string().uuid()}).strict().parse(body);
      const track=await this.app.musicImport.addUploaded(z.string().uuid().parse(id),user.id,hash,requestId);await this.app.flush();return {ok:true,track};
    }catch(e){httpError(e);}
  }
  @Post('rooms/:id/music/play') async playMusic(@Param('id') id:string,@Body() body:unknown,@Headers('authorization') header?:string) {
    try {
      const user=await this.user(header);this.app.limit(`music-play:${user.id}`,60,60000);
      const {trackId,requestId}=z.object({trackId:z.string().uuid(),requestId:z.string().uuid()}).strict().parse(body);
      const roomId=z.string().uuid().parse(id),room=this.app.engine.snapshot(roomId);
      const stateVersion=this.app.engine.command(user.id,{roomId,commandId:requestId,expectedStateVersion:room.stateVersion,action:{type:'play',payload:{trackId}}});
      await this.app.flush();return {ok:true,stateVersion};
    }catch(e){httpError(e);}
  }
  @Post('music/upload') async upload(@Body() body:unknown,@Headers('authorization') header?:string,@Headers('content-type') contentType?:string) {
    try {const user=await this.user(header);this.app.limit(`upload:${user.id}`,10,60000);
      if(contentType?.startsWith('application/octet-stream'))throw new DomainError('LOCAL_UPLOAD_NOT_SUPPORTED');
      const {songId}=z.object({songId:z.string().regex(/^\d{1,20}$/)}).strict().parse(body);
      return {track:await this.app.musicImport.importSong(songId)};
    }catch(e){httpError(e);}
  }
  @Get('rooms/:id/music/:trackId') @Header('Cache-Control','private, no-store') async music(@Param('id') id:string,@Param('trackId') trackId:string,@Headers('authorization') header?:string,@Query() query?:unknown) {
    try {const user=await this.user(header);this.app.limit(`music-link:${user.id}`,60,60000);
      const q=z.object({refresh:z.enum(['0','1']).default('0')}).strict().parse(query??{});
      return {url:await this.app.musicImport.url(z.string().uuid().parse(id),user.id,z.string().uuid().parse(trackId),q.refresh==='1')};
    }catch(e){httpError(e);}
  }
  @Get('rooms/:id/music/:trackId/cover') async cover(@Param('id') id:string,@Param('trackId') trackId:string,@Headers('authorization') header?:string) {
    try {
      const user=await this.user(header);this.app.limit(`music-cover:${user.id}`,30,60000);
      return {coverUrl:await this.app.musicImport.cover(z.string().uuid().parse(id),user.id,z.string().uuid().parse(trackId))};
    }catch(e){httpError(e);}
  }
  @Get('rooms/:id/music/:trackId/audio') @Header('Cache-Control','private, no-store') async browserAudio(@Param('id') id:string,@Param('trackId') trackId:string,@Headers('authorization') header?:string) {
    try{
      const user=await this.user(header);this.app.limit(`browser-audio:${user.id}`,30,60000);
      const roomId=z.string().uuid().parse(id),songId=z.string().uuid().parse(trackId);
      const bytes=await this.app.musicImport.readAudio(roomId,user.id,songId);
      // Recheck membership after downloading, before returning any audio bytes.
      await this.app.musicImport.metadata(roomId,user.id,songId);
      return new StreamableFile(bytes,{type:'application/octet-stream',length:bytes.length});
    }catch(e){httpError(e);}
  }
  private async user(header?: string) { await this.app.flush(); if (!header?.startsWith('Bearer ')) throw new DomainError('UNAUTHORIZED'); return this.app.auth.verify(header.slice(7)); }
  @Get('rooms/:id/music/:trackId/metadata') async metadata(@Param('id') id:string,@Param('trackId') trackId:string,@Headers('authorization') header?:string) {
    try { const user=await this.user(header);return await this.app.musicImport.metadata(z.string().uuid().parse(id),user.id,z.string().uuid().parse(trackId)); } catch(e){httpError(e);}
  }
  @Get('health') async health() { try {await this.app.flush();await this.app.database.getSetting('__health__');}catch(e){httpError(e);} return { ok: true, protocolVersion: 1, chatProtocolVersion: 1, relayUsedBps: this.app.capacity.usedBps, relayBudgetBps: this.app.capacity.budget, turnProvider: this.app.turn.provider, publicRelayUsedBps: this.app.publicCapacity.usedBps, publicRelayBudgetBps: this.app.publicCapacity.budget }; }
  @Post('login') async login(@Body() body: unknown, @Req() req: Request) {
    try { this.app.limit(`login:${req.ip}`, 10, 60000); const v = loginSchema.parse(body); return await this.app.auth.login(v.name, v.password, v.register); } catch (e) { httpError(e); }
  }
  @Get('rooms') async rooms(@Headers('authorization') header?: string,@Query() query?:unknown) { try { const user=await this.user(header); const q=z.object({keywords:z.string().trim().max(100).default(''),category:z.string().trim().max(40).default('')}).strict().parse(query??{});return this.app.engine.list(user.id,q.keywords,q.category); } catch (e) { httpError(e); } }
  @Post('rooms') async create(@Body() body: unknown, @Headers('authorization') header?: string) {
    try { const user = await this.user(header); this.app.limit(`create:${user.id}`, 5, 60000); const v=z.object({name:z.string().trim().min(1).max(80),settings:roomSettingsSchema.optional(),defaults:permissionsSchema.optional()}).strict().parse(body); const room=this.app.engine.create(v.name,user.id,v.settings,v.defaults);await this.app.flush();return room; } catch (e) { httpError(e); }
  }
  @Get('me') async me(@Headers('authorization') header?:string) {
    try {const user=await this.user(header),saved=await this.app.database.getUser(user.id);return {id:user.id,name:user.name,displayName:saved?.displayName??user.name,avatarUrl:saved?.avatarUrl??null};}catch(e){httpError(e);}
  }
  @Get('rooms/resolve/:code') async resolve(@Param('code') code:string,@Headers('authorization') header?:string) {
    try {await this.user(header);return this.app.engine.resolveInvite(z.string().regex(/^[a-f0-9]{12}$/).parse(code));}catch(e){httpError(e);}
  }
  @Put('rooms/:id/settings') async settings(@Param('id') id:string,@Body() body:unknown,@Headers('authorization') header?:string) {
    try {const user=await this.user(header);const v=z.object({name:z.string().trim().min(1).max(80).optional(),settings:roomSettingsSchema,expectedStateVersion:z.number().int().nonnegative()}).strict().parse(body);
      const room=this.app.engine.updateSettings(z.string().uuid().parse(id),user.id,v.name,v.settings,v.expectedStateVersion);await this.app.flush();return room;
    }catch(e){httpError(e);}
  }
  @Get('rooms/:id') async room(@Param('id') id: string, @Headers('authorization') header?: string) {
    try { const user = await this.user(header); const room = this.app.engine.snapshot(z.string().uuid().parse(id)); if (room.hostId !== user.id && !room.members.some(m => m.id === user.id && m.online)) throw new DomainError('NOT_IN_ROOM'); return room; } catch (e) { httpError(e); }
  }
  @Put('rooms/:id/permissions') async defaults(@Param('id') id: string, @Body() body: unknown, @Headers('authorization') header?: string) {
    try {
      const user = await this.user(header); const room = this.app.engine.snapshot(z.string().uuid().parse(id));
      const data = z.object({ expectedStateVersion: z.number().int().nonnegative(), defaults: permissionsSchema }).strict().parse(body);
      this.app.engine.command(user.id, { roomId: room.id, commandId: randomUUID(), expectedStateVersion: data.expectedStateVersion, action: { type: 'defaults', payload: data.defaults } });
      await this.app.flush();return this.app.engine.snapshot(id);
    } catch (e) { httpError(e); }
  }
}
