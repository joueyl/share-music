import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { json, raw } from 'express';
import { AppService } from './app.service';
import { NeteaseController } from './netease.controller';
import { ApiController } from './controller';
import { RoomGateway } from './gateway';
@Module({ controllers: [ApiController, NeteaseController], providers: [AppService, RoomGateway] })
class AppModule {}
async function main() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use('/api/music/upload', raw({ type: 'application/octet-stream', limit: '100mb' }));
  app.use(json({ limit: '32kb' }));
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableCors({ origin: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:11420,http://127.0.0.1:11420,http://localhost:1420,http://127.0.0.1:1420,tauri://localhost,http://tauri.localhost,https://tauri.localhost').split(',') });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000), process.env.BIND_ADDRESS ?? '127.0.0.1');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
