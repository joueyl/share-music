import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { json } from 'express';
import { AppService } from './app.service';
import { NeteaseController } from './netease.controller';
import { QqController } from './qq.controller';
import { ApiController } from './controller';
import { RoomGateway } from './gateway';
@Module({ controllers: [ApiController, NeteaseController, QqController], providers: [AppService, RoomGateway] })
class AppModule {}
async function main() {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('服务端需要 Node.js 24+（hana-music-api 编程式 SDK）');
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // Only explicit proxy IPs/subnets may supply the client address. Never trust arbitrary forwarding headers.
  const proxies = (process.env.TRUST_PROXY ?? '').split(',').map(v => v.trim()).filter(Boolean);
  app.getHttpAdapter().getInstance().set('trust proxy', proxies.length ? proxies : false);
  app.use(json({ limit: '32kb' }));
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableCors({ origin: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:11420,http://127.0.0.1:11420,http://localhost:1420,http://127.0.0.1:1420,tauri://localhost,http://tauri.localhost,https://tauri.localhost').split(',') });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000), process.env.BIND_ADDRESS ?? '127.0.0.1');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
