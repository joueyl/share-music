import { Inject, OnModuleDestroy } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { WebSocket, WebSocketServer as WSS } from 'ws';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { envelopeSchema, type RoomSnapshot } from '../../../packages/shared/src';
import { AppService } from './app.service';
import { DomainError } from './engine';
type Session = { user: { id: string; name: string; expiresAt: number }; roomId: string | null; lastPong: number };
const uuid = z.string().uuid();
const schemas = {
  join: z.object({ type: z.literal('join'), roomId: uuid }).strict(),
  ready: z.object({ type: z.literal('ready'), roomId: uuid, transitionId: uuid, sourceEpoch: z.number().int().nonnegative() }).strict(),
  signal: z.object({ type: z.literal('signal'), roomId: uuid, toId: uuid, sourceEpoch: z.number().int().nonnegative(), data: z.union([z.object({ kind: z.literal('description'), sdp: z.string().max(24000), descriptionType: z.enum(['offer', 'answer']) }).strict(), z.object({ kind: z.literal('candidate'), candidate: z.string().max(4096), mid: z.string().max(100) }).strict()]) }).strict(),
  admission: z.object({ type: z.literal('admission'), requestId: uuid, roomId: uuid, sourceEpoch: z.number().int().nonnegative(), relay: z.boolean(), peerId: uuid.optional(), receiveBps: z.number().finite().nonnegative(), sourceUploadBps: z.number().finite().nonnegative(), leaseId: uuid.optional() }).strict(),
  clock: z.object({ type: z.literal('clock'), requestId: uuid, clientSentAt: z.number().finite() }).strict(),
  exhausted: z.object({ type: z.literal('exhausted'), roomId: uuid, sourceEpoch: z.number().int().nonnegative() }).strict(),
  sourceFailed: z.object({ type: z.literal('sourceFailed'), roomId: uuid, sourceEpoch: z.number().int().nonnegative() }).strict(),
};
@WebSocketGateway({ path: '/ws', maxPayload: 32768 })
export class RoomGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer() server!: WSS;
  private sessions = new Map<WebSocket, Session>();
  private authTimers = new Map<WebSocket, ReturnType<typeof setTimeout>>();
  private heartbeat: ReturnType<typeof setInterval>;
  private publish = (room: RoomSnapshot) => { for (const [ws, s] of this.sessions) if (s.roomId === room.id) this.send(ws, { type: 'snapshot', data: room }); };
  constructor(@Inject(AppService) private app: AppService) {
    app.subscribers.add(this.publish);
    this.heartbeat = setInterval(() => { const now = Date.now(); for (const [ws, s] of this.sessions) { if (now - s.lastPong > 20000 || now >= s.user.expiresAt) ws.close(4001, 'Session expired'); else ws.ping(); } }, 5000); this.heartbeat.unref();
  }
  private send(ws: WebSocket, message: unknown) { if (ws.readyState !== WebSocket.OPEN) return; if (ws.bufferedAmount > 256000) { ws.close(4008, 'Slow client'); return; } ws.send(JSON.stringify(message)); }
  handleConnection(ws: WebSocket, request: IncomingMessage) {
    const allowed = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:1420,http://127.0.0.1:1420,tauri://localhost,http://tauri.localhost,https://tauri.localhost').split(',');
    if (request.headers.origin && !allowed.includes(request.headers.origin)) { ws.close(4003, 'Origin forbidden'); return; }
    this.authTimers.set(ws, setTimeout(() => ws.close(4001, 'Authentication timeout'), 5000));
    ws.on('pong', () => { const s = this.sessions.get(ws); if (s) s.lastPong = Date.now(); });
    ws.on('message', async raw => {
      let commandId: string | undefined;
      try {
        const message = JSON.parse(raw.toString());
        let s = this.sessions.get(ws);
        if (!s) {
          this.app.limit(`ws-auth:${request.socket.remoteAddress}`, 20, 60000);
          const auth = z.object({ type: z.literal('auth'), token: z.string().max(4096) }).strict().parse(message);
          const user = this.app.auth.verify(auth.token);
          // One control connection per identity: close the old connection before replacement.
          for (const [old, previous] of this.sessions) if (previous.user.id === user.id) { this.handleDisconnect(old); old.close(4009, 'Replaced by another session'); }
          clearTimeout(this.authTimers.get(ws)); this.authTimers.delete(ws);
          s = { user, roomId: null, lastPong: Date.now() }; this.sessions.set(ws, s); this.send(ws, { type: 'authenticated', user: { id: user.id, name: user.name }, iceServers: this.app.turn.stun() }); return;
        }
        if (Date.now() >= s.user.expiresAt) throw new DomainError('UNAUTHORIZED');
        this.app.limit(`ws:${s.user.id}`, 120, 10000);
        if (message.type === 'command') {
          const command = envelopeSchema.parse(message.data); commandId = command.commandId;
          this.requireRoom(s, command.roomId);
          const stateVersion = this.app.engine.command(s.user.id, command);
          this.send(ws, { type: 'result', commandId, ok: true, stateVersion }); return;
        }
        if (message.type === 'leave') {
          z.object({ type: z.literal('leave') }).strict().parse(message);
          const previousRoom = s.roomId; s.roomId = null;
          if (previousRoom) this.app.engine.leave(previousRoom, s.user.id); return;
        }
        if (message.type === 'join') {
          const v = schemas.join.parse(message);
          // Validate target before leaving the previous room.
          const target = this.app.engine.snapshot(v.roomId);
          if (!target.members.some(m => m.id === s!.user.id && m.online) && target.members.filter(m => m.online).length >= 8) throw new DomainError('ROOM_FULL');
          if (s.roomId && s.roomId !== v.roomId) this.app.engine.leave(s.roomId, s.user.id);
          s.roomId = v.roomId; const snapshot = this.app.engine.join(v.roomId, s.user); this.send(ws, { type: 'snapshot', data: snapshot }); return;
        }
        if (message.type === 'clock') { const received = Date.now(); const v = schemas.clock.parse(message); this.send(ws, { ...v, serverReceivedAt: received, serverSentAt: Date.now() }); return; }
        if (message.type === 'ready') { const v = schemas.ready.parse(message); this.requireRoom(s, v.roomId); this.app.engine.ready(v.roomId, s.user.id, v.transitionId, v.sourceEpoch); return; }
        if (message.type === 'exhausted' || message.type === 'sourceFailed') { const v = schemas[message.type as 'exhausted' | 'sourceFailed'].parse(message); this.requireRoom(s, v.roomId); this.app.engine[message.type as 'exhausted' | 'sourceFailed'](v.roomId, s.user.id, v.sourceEpoch); return; }
        if (message.type === 'signal') {
          const v = schemas.signal.parse(message); this.requireRoom(s, v.roomId);
          const room = this.app.engine.snapshot(v.roomId); const source = room.pending?.playback.sourceEpoch === v.sourceEpoch ? room.pending.playback : room.playback;
          if (source.sourceEpoch !== v.sourceEpoch || !source.providerId || !room.members.some(m => m.id === v.toId && m.online)) throw new DomainError('INVALID_SIGNAL_TARGET');
          if (s.user.id !== source.providerId && v.toId !== source.providerId) throw new DomainError('INVALID_SIGNAL_TARGET');
          for (const [peer, session] of this.sessions) if (session.roomId === v.roomId && session.user.id === v.toId) this.send(peer, { type: 'signal', fromId: s.user.id, sourceEpoch: v.sourceEpoch, data: v.data }); return;
        }
        if (message.type === 'admission') {
          const v = schemas.admission.parse(message); this.requireRoom(s, v.roomId);
          try {
            const room = this.app.engine.snapshot(v.roomId); const source = room.pending?.playback.sourceEpoch === v.sourceEpoch ? room.pending.playback : room.playback;
            if (source.sourceEpoch !== v.sourceEpoch || !source.providerId) throw new DomainError('STALE_SOURCE');
            const required = Math.ceil(source.bitrateBps * 1.2);
            if (!v.relay && (v.receiveBps < required || v.sourceUploadBps < required)) throw new DomainError('INSUFFICIENT_BANDWIDTH');
            let leaseId: string | undefined; const iceServers = this.app.turn.stun();
            if (v.relay) {
              if (s.user.id !== source.providerId || !v.peerId || v.peerId === s.user.id || !room.members.some(m => m.id === v.peerId && m.online)) throw new DomainError('INVALID_RELAY_PEER');
              if (this.app.turn.external) {
                const servers = await this.app.turn.credentials();
                // Provider fetch is asynchronous: reject disconnected or obsolete requests.
                if (this.sessions.get(ws) !== s || s.roomId !== v.roomId || Date.now() >= s.user.expiresAt) throw new DomainError('NOT_IN_ROOM');
                const fresh = this.app.engine.snapshot(v.roomId);
                const current = fresh.pending?.playback.sourceEpoch === v.sourceEpoch ? fresh.pending.playback : fresh.playback;
                if (current.sourceEpoch !== v.sourceEpoch || current.providerId !== s.user.id || !fresh.members.some(m => m.id === v.peerId && m.online)) throw new DomainError('STALE_SOURCE');
                const budget = this.app.publicCapacity;
                const lease = v.leaseId ? budget.renew(v.leaseId, s.user.id, v.roomId, v.sourceEpoch, v.peerId) : budget.reserve(v.roomId, v.sourceEpoch, s.user.id, current.bitrateBps, v.peerId);
                leaseId = lease.id; iceServers.splice(0, iceServers.length, ...this.app.turn.iceServers(servers));
              } else {
                const host = process.env.TURN_PUBLIC_HOST, secret = process.env.TURN_SECRET;
                if (!host || !secret || secret.length < 32) throw new DomainError('TURN_NOT_CONFIGURED');
                const lease = v.leaseId ? this.app.capacity.renew(v.leaseId, s.user.id, v.roomId, v.sourceEpoch, v.peerId) : this.app.capacity.reserve(v.roomId, v.sourceEpoch, s.user.id, source.bitrateBps, v.peerId);
                leaseId = lease.id; iceServers.push(...this.app.capacity.credentials(lease, host, secret));
              }
            }
            this.send(ws, { type: 'admission', requestId: v.requestId, ok: true, iceServers: [...new Set(iceServers)].slice(0, 8), leaseId });
          } catch (e) { this.send(ws, { type: 'admission', requestId: v.requestId, ok: false, error: e instanceof DomainError ? e.code : 'INTERNAL_ERROR' }); }
          return;
        }
        throw new DomainError('UNKNOWN_MESSAGE');
      } catch (e) {
        const error = e instanceof DomainError ? e.code : e instanceof z.ZodError || e instanceof SyntaxError ? 'INVALID_REQUEST' : 'INTERNAL_ERROR';
        this.send(ws, commandId ? { type: 'result', commandId, ok: false, error } : { type: 'error', error });
        if (error === 'STATE_CONFLICT') { const s = this.sessions.get(ws); if (s?.roomId) this.send(ws, { type: 'snapshot', data: this.app.engine.snapshot(s.roomId) }); }
      }
    });
  }
  private requireRoom(s: Session, roomId: string) { if (s.roomId !== roomId) throw new DomainError('NOT_IN_ROOM'); }
  handleDisconnect(ws: WebSocket) { clearTimeout(this.authTimers.get(ws)); this.authTimers.delete(ws); const s = this.sessions.get(ws); this.sessions.delete(ws); if (s?.roomId) this.app.engine.leave(s.roomId, s.user.id); }
  onModuleDestroy() { clearInterval(this.heartbeat); this.app.subscribers.delete(this.publish); for (const timer of this.authTimers.values()) clearTimeout(timer); for (const ws of this.sessions.keys()) ws.close(1001, 'Shutdown'); }
}
