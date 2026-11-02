import { Body, Controller, Get, Headers, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppService } from './app.service';
import { httpError } from './controller';
import { DomainError } from './engine';
import { requireMusicAdmin } from './netease.controller';
import { qqMid } from './qq';

@Controller()
export class QqController {
 constructor(@Inject(AppService) private app:AppService){}
 @Post('loginServe/qq/channels') async channels(@Req() req:Request,@Res({passthrough:true}) res:Response){
  try{requireMusicAdmin(this.app,req,res);return await this.app.qq.channels();}catch(e){httpError(e);}
 }
 @Post('loginServe/qq/status') async status(@Req() req:Request,@Res({passthrough:true}) res:Response){
  try{requireMusicAdmin(this.app,req,res);return await this.app.qq.status();}catch(e){httpError(e);}
 }
 @Post('loginServe/qq/qr') async qr(@Req() req:Request,@Res({passthrough:true}) res:Response,@Body() body:unknown){
  try{requireMusicAdmin(this.app,req,res);this.app.limit('qq-qr',10,60000);const {channel}=z.object({channel:z.enum(['qq','wechat','qqmusic'])}).strict().parse(body);return await this.app.qq.begin(channel);}catch(e){httpError(e);}
 }
 @Post('loginServe/qq/check') async check(@Req() req:Request,@Res({passthrough:true}) res:Response,@Body() body:unknown){
  try{requireMusicAdmin(this.app,req,res);const {sessionId}=z.object({sessionId:z.string().uuid()}).strict().parse(body);return await this.app.qq.check(sessionId);}catch(e){httpError(e);}
 }
 @Post('loginServe/qq/cancel') async cancel(@Req() req:Request,@Res({passthrough:true}) res:Response,@Body() body:unknown){
  try{requireMusicAdmin(this.app,req,res);const {sessionId}=z.object({sessionId:z.string().uuid()}).strict().parse(body);return await this.app.qq.cancel(sessionId);}catch(e){httpError(e);}
 }
 private async user(header?:string){
  await this.app.flush();if(!header?.startsWith('Bearer '))throw new DomainError('UNAUTHORIZED');
  const user=await this.app.auth.verify(header.slice(7));this.app.limit('qq:'+user.id,60,60000);
 }
 @Get('api/qq/search') async search(@Query() query:unknown,@Headers('authorization') header?:string){
  try{await this.user(header);const {keyword,offset}=z.object({keyword:z.string().trim().min(1).max(60),offset:z.coerce.number().int().min(0).max(100000).multipleOf(20).default(0)}).strict().parse(query);return await this.app.qq.search(keyword,offset);}catch(e){httpError(e);}
 }
 @Get('api/qq/lyrics/:mid') async lyrics(@Param('mid') mid:string,@Headers('authorization') header?:string){
  try{await this.user(header);return await this.app.qq.lyrics(z.string().regex(qqMid).parse(mid));}catch(e){httpError(e);}
 }
 @Get('api/qq/suggest') async suggest(@Query() query:unknown,@Headers('authorization') header?:string){
  try{await this.user(header);const {keyword}=z.object({keyword:z.string().trim().min(1).max(60)}).strict().parse(query);return await this.app.qq.suggest(keyword);}catch(e){httpError(e);}
 }
}
