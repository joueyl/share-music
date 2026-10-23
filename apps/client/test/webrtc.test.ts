import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
const native = vi.hoisted(() => ({ handlers: {} as Record<string, (event: any) => void> }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: vi.fn(async () => ({ native: true, reason: '' })) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (name, handler) => { native.handlers[name] = handler; return () => {}; }) }));
const emit = (name: string, payload: any) => native.handlers[name]?.({ payload });
const snapshot = () => ({ id: 'room', hostId: 'host', members: [{ id: 'peer', name: 'Listener', online: true }],
  playback: { sourceId: 'track', sourceEpoch: 4 }, pending: null });
const failure = () => ({ roomId: 'room', peerId: 'peer', sourceEpoch: 4, status: 'failed', detail: 'WebRTC 连接失败' });
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); native.handlers = {}; setActivePinia(createPinia()); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
it('keeps connection warnings while playback status changes and clears them on recovery', async () => {
  const { useApp } = await import('../src/store'); const app = useApp(); await app.initialize();
  emit('server-message', { type: 'snapshot', data: snapshot() }); emit('webrtc-status', failure());
  emit('media-status', { status: 'buffering', detail: '正在缓冲', bufferedMs: 0, driftMs: 0, receiveBps: 0 });
  expect(app.webrtcWarnings).toHaveLength(1); expect(app.webrtcWarnings[0].detail).toBe('WebRTC 连接失败');
  emit('webrtc-status', { ...failure(), status: 'connected', detail: '' }); expect(app.webrtcWarnings).toHaveLength(0);
});
it('ignores obsolete source/room diagnostics and hides peers that have left', async () => {
  const { useApp } = await import('../src/store'); const app = useApp(); await app.initialize();
  emit('server-message', { type: 'snapshot', data: snapshot() });
  emit('webrtc-status', { ...failure(), sourceEpoch: 3 }); emit('webrtc-status', { ...failure(), roomId: 'old-room' });
  expect(app.webrtcWarnings).toHaveLength(0);
  emit('webrtc-status', failure()); emit('server-message', { type: 'snapshot', data: { ...snapshot(), members: [] } });
  expect(app.webrtcWarnings).toHaveLength(0);
});
it('clears warnings on leave and ignores late diagnostics', async () => {
  const { useApp } = await import('../src/store'); const app = useApp(); await app.initialize();
  emit('server-message', { type: 'snapshot', data: snapshot() }); emit('webrtc-status', failure());
  await app.exitRoom(); emit('webrtc-status', failure()); expect(app.webrtcWarnings).toHaveLength(0); expect(app.room).toBeNull();
});
it('old active-source recovery does not erase a preparing-source failure', async () => {
  const { useApp } = await import('../src/store'); const app = useApp(); await app.initialize();
  emit('server-message', { type: 'snapshot', data: { ...snapshot(), pending: { playback: { sourceId: 'next', sourceEpoch: 5 } } } });
  emit('webrtc-status', { ...failure(), sourceEpoch: 5 });
  emit('webrtc-status', { ...failure(), status: 'connected', detail: '' });
  expect(app.webrtcWarnings).toHaveLength(1); expect(app.webrtcWarnings[0].sourceEpoch).toBe(5);
  emit('server-message', { type: 'snapshot', data: snapshot() }); expect(app.webrtcWarnings).toHaveLength(0);
});
