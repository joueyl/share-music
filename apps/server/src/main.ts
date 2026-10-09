import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { json } from 'express';
import { AppService } from './app.service';
import { ApiController } from './controller';
import { RoomGateway } from './gateway';
@Module({ controllers: [ApiController], providers: [AppService, RoomGateway] })
class AppModule {}
async function main() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: '32kb' }));
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableCors({ origin: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:1420,http://127.0.0.1:1420,tauri://localhost,http://tauri.localhost,https://tauri.localhost').split(',') });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000), process.env.BIND_ADDRESS ?? '127.0.0.1');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
