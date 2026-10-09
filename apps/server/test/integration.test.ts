import { afterAll, beforeAll, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
let child: ChildProcess, base: string, port: number, log = '';
const clients: WebSocket[] = [];
class Client {
 ws: WebSocket; queue: any[] = [];
 constructor(token: string) { this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); clients.push(this.ws); this.ws.on('open', () => this.send({ type: 'auth', token })); this.ws.on('message', raw => this.queue.push(JSON.parse(raw.toString()))); }
 send(message: unknown) { this.ws.send(JSON.stringify(message)); }
 async wait(predicate: (message: any) => boolean, timeout = 5000): Promise<any> { const start = Date.now(); while (Date.now() - start < timeout) { const index = this.queue.findIndex(predicate); if (index >= 0) return this.queue.splice(index, 1)[0]; await new Promise(r => setTimeout(r, 10)); } throw new Error(`WebSocket timeout: ${JSON.stringify(this.queue)}\n${log}`); }
}
async function api(path: string, body?: unknown, token?: string) { const res = await fetch(base + '/api' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: res.status, data: await res.json() }; }
beforeAll(async () => {
 const temporary = createServer(); await new Promise<void>(r => temporary.listen(0, '127.0.0.1', r)); port = (temporary.address() as { port: number }).port; await new Promise<void>(r => temporary.close(() => r())); base = `http://127.0.0.1:${port}`;
 child = spawn(process.execPath, [resolve('apps/server/dist/apps/server/src/main.js')], { env: { ...process.env, PORT: String(port), DATABASE_PATH: ':memory:', TOKEN_SECRET: 'integration-secret-'.repeat(3), TURN_SECRET: 'integration-turn-'.repeat(3), TURN_PUBLIC_HOST: 'turn.example.com', TURN_PROVIDER: 'static', TURN_URLS: 'turn:relay.example.com:80?transport=udp,turns:relay.example.com:443?transport=tcp', TURN_USERNAME: 'integration-user', TURN_PASSWORD: 'integration-password' }, stdio: ['ignore', 'pipe', 'pipe'] });
 child.stdout?.on('data', data => log += data.toString()); child.stderr?.on('data', data => log += data.toString());
 for (let i = 0; i < 100; i++) { try { if ((await api('/health')).status === 200) return; } catch {} if (child.exitCode !== null) throw new Error(log); await new Promise(r => setTimeout(r, 50)); } throw new Error(log);
}, 10000);
afterAll(async () => { for (const ws of clients) ws.terminate(); if (child && child.exitCode === null) { const exit = new Promise<void>(r => child.once('exit', () => r())); child.kill(); await exit; } });
it('HTTP auth plus two real WebSocket clients: room snapshots, forbidden controls, conflict recovery and isolated signaling', async () => {
 expect((await api('/rooms')).status).toBe(401);
 const a = (await api('/login', { name: 'alice', password: 'alice-password', register: true })).data;
 const b = (await api('/login', { name: 'bob', password: 'bob-password-long', register: true })).data;
 const room = (await api('/rooms', { name: 'integration room' }, a.token)).data;
 const host = new Client(a.token), member = new Client(b.token);
 await host.wait(m => m.type === 'authenticated'); await member.wait(m => m.type === 'authenticated');
 host.send({ type: 'join', roomId: room.id }); await host.wait(m => m.type === 'snapshot');
 member.send({ type: 'join', roomId: room.id }); const snapshot = (await member.wait(m => m.type === 'snapshot' && m.data.members.length === 2)).data;
 const forbidden = randomUUID(); member.send({ type: 'command', data: { commandId: forbidden, roomId: room.id, expectedStateVersion: snapshot.stateVersion, action: { type: 'next', payload: {} } } }); expect((await member.wait(m => m.type === 'result' && m.commandId === forbidden)).error).toBe('FORBIDDEN');
 const track = { id: randomUUID(), name: 'integration.flac', durationMs: 120000, sizeBytes: 4000000, spec: { sampleRate: 48000, bits: 24, channels: 2 }, lossless: true, bitrateBps: 900000, contentHash: 'a'.repeat(64) };
 const enqueue = randomUUID(); member.send({ type: 'command', data: { commandId: enqueue, roomId: room.id, expectedStateVersion: snapshot.stateVersion, action: { type: 'enqueue', payload: track } } }); expect((await member.wait(m => m.type === 'result' && m.commandId === enqueue)).ok).toBe(true);
 const updated = (await host.wait(m => m.type === 'snapshot' && m.data.playlist.length === 1)).data;
 const stale = randomUUID(); host.send({ type: 'command', data: { commandId: stale, roomId: room.id, expectedStateVersion: 0, action: { type: 'play', payload: { trackId: track.id } } } }); expect((await host.wait(m => m.type === 'result' && m.commandId === stale)).error).toBe('STATE_CONFLICT');
 const play = randomUUID(); host.send({ type: 'command', data: { commandId: play, roomId: room.id, expectedStateVersion: updated.stateVersion, action: { type: 'play', payload: { trackId: track.id } } } }); expect((await host.wait(m => m.type === 'result' && m.commandId === play)).ok).toBe(true);
 const pending = (await member.wait(m => m.type === 'snapshot' && m.data.pending)).data.pending;
 member.send({ type: 'signal', roomId: room.id, toId: a.user.id, sourceEpoch: pending.playback.sourceEpoch, data: { kind: 'candidate', candidate: 'candidate:test', mid: '0' } }); expect((await host.wait(m => m.type === 'signal')).fromId).toBe(b.user.id);
 member.send({ type: 'signal', roomId: room.id, toId: randomUUID(), sourceEpoch: pending.playback.sourceEpoch, data: { kind: 'candidate', candidate: 'candidate:test', mid: '0' } }); expect((await member.wait(m => m.type === 'error')).error).toBe('INVALID_SIGNAL_TARGET');
 const relay = randomUUID(); member.send({ type: 'admission', requestId: relay, roomId: room.id, sourceEpoch: pending.playback.sourceEpoch, relay: true, peerId: a.user.id, receiveBps: 0, sourceUploadBps: 0 });
 const admission = await member.wait(m => m.type === 'admission' && m.requestId === relay); expect(admission.ok).toBe(true); expect(admission.iceServers).toContain('turns:integration-user:integration-password@relay.example.com:443?transport=tcp');
 const health = (await api('/health')).data; expect(health.publicRelayUsedBps).toBe(1080000); expect(health.relayUsedBps).toBe(0);
 const invalidRelay = randomUUID(); host.send({ type: 'admission', requestId: invalidRelay, roomId: room.id, sourceEpoch: pending.playback.sourceEpoch, relay: true, peerId: b.user.id, receiveBps: 0, sourceUploadBps: 0 }); expect((await host.wait(m => m.type === 'admission' && m.requestId === invalidRelay)).error).toBe('INVALID_RELAY_PEER');
 const clock = randomUUID(); host.send({ type: 'clock', requestId: clock, clientSentAt: Date.now() }); const sample = await host.wait(m => m.type === 'clock' && m.requestId === clock); expect(sample.serverSentAt).toBeGreaterThanOrEqual(sample.serverReceivedAt);
}, 10000);
