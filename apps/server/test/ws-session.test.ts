import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { AppService } from '../src/app.service';
import { DomainError } from '../src/engine';
import { RoomGateway } from '../src/gateway';

class Peer extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  bufferedAmount = 0;
  close = vi.fn((_code: number, _reason: string) => { this.readyState = WebSocket.CLOSING; });
  send = vi.fn();
  ping = vi.fn();
  authenticate(token = 'test-token') { this.emit('message', JSON.stringify({ type: 'auth', token })); }
}

const activeUser = () => ({ id: 'test-user', name: 'tester', expiresAt: Date.now() + 60000 });
let gateway: RoomGateway;
const verify = vi.fn(async (_token: string) => activeUser());
beforeEach(() => {
  vi.useFakeTimers();
  verify.mockReset().mockImplementation(async () => activeUser());
  gateway = new RoomGateway({
    subscribers: new Set(), activitySubscribers: new Set(), auth: { verify },
    flush: async () => {}, limit: () => {}, turn: { stun: () => [] },
  } as unknown as AppService);
});
afterEach(() => { gateway.onModuleDestroy(); vi.useRealTimers(); });

function connect() {
  const peer = new Peer();
  gateway.handleConnection(peer as unknown as WebSocket, { headers: {}, socket: {} } as IncomingMessage);
  return peer;
}

it('distinguishes handshake and heartbeat timeout from authenticated token expiry',async()=>{
  const noAuth = connect(), lostHeartbeat = connect(), expires = connect();
  verify.mockResolvedValueOnce({ ...activeUser(), id: 'expiring', expiresAt: Date.now() + 10000 });
  expires.authenticate(); await vi.advanceTimersByTimeAsync(0);
  lostHeartbeat.authenticate(); await vi.advanceTimersByTimeAsync(5000);
  expect(noAuth.close).toHaveBeenCalledExactlyOnceWith(4010, 'Authentication timeout');
  await vi.advanceTimersByTimeAsync(5000);
  expect(expires.close).toHaveBeenCalledWith(4401, 'Session expired');
  await vi.advanceTimersByTimeAsync(15000);
  expect(lostHeartbeat.close).toHaveBeenCalledWith(4010, 'Heartbeat timeout');
});

it('only rejects credentials on explicit verification failure and keeps replacements distinct',async()=>{
  const rejected = connect(), unavailable = connect();
  verify.mockRejectedValueOnce(new DomainError('UNAUTHORIZED'));
  rejected.authenticate(); await vi.advanceTimersByTimeAsync(0);
  expect(rejected.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ type: 'error', error: 'UNAUTHORIZED' }));
  expect(rejected.close).toHaveBeenCalledExactlyOnceWith(4401, 'Invalid credentials');
  verify.mockRejectedValueOnce(new DomainError('DATABASE_UNAVAILABLE'));
  unavailable.authenticate(); await vi.advanceTimersByTimeAsync(5000);
  expect(unavailable.close).toHaveBeenCalledExactlyOnceWith(4010, 'Authentication timeout');
  const a = connect(), b = connect();
  a.authenticate(); await vi.advanceTimersByTimeAsync(0);
  b.authenticate(); await vi.advanceTimersByTimeAsync(0);
  expect(a.close).toHaveBeenCalledExactlyOnceWith(4009, 'Replaced by another session');
  expect(b.close).not.toHaveBeenCalled();
});

it('does not replace a live session when an already timed-out verification finishes',async()=>{
  const live = connect();
  live.authenticate(); await vi.advanceTimersByTimeAsync(0);
  let finish!: (value: ReturnType<typeof activeUser>) => void;
  verify.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const slow = connect();
  slow.authenticate(); await vi.advanceTimersByTimeAsync(5000);
  expect(slow.close).toHaveBeenCalledWith(4010, 'Authentication timeout');
  finish(activeUser()); await vi.advanceTimersByTimeAsync(0);
  expect(live.close).not.toHaveBeenCalled();
  expect(slow.send).not.toHaveBeenCalled();
});
