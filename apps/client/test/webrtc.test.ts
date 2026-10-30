import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
const native = vi.hoisted(() => ({ handlers: {} as Record<string, (event: any) => void> }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: vi.fn(async () => ({ native: false, capture: false, reason: 'HTML Audio · WebView2' })) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (name, handler) => { native.handlers[name] = handler; return () => {}; }) }));
const emit = (name: string, payload: any) => native.handlers[name]?.({ payload });
const snapshot = () => ({ id: 'room', hostId: 'host', members: [{ id: 'peer', name: 'Listener', online: true }], playback: { sourceId: 'track', sourceEpoch: 4 }, pending: null });
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); native.handlers = {}; setActivePinia(createPinia()); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
it('initializes HTML Audio without native media or WebRTC subscriptions', async () => {
 const {useApp} = await import('../src/store'); const app = useApp(); await app.initialize();
 expect(app.native).toBe(false); expect(app.nativeReason).toContain('HTML Audio');
 expect(native.handlers['webrtc-status']).toBeUndefined();
});
it('renders actual HTML Audio status independently of obsolete P2P diagnostics', async () => {
 const {useApp} = await import('../src/store'); const app = useApp(); await app.initialize();
 emit('server-message', {type:'snapshot', data:snapshot()});
 emit('media-status', {status:'buffering',detail:'音频加载中',bufferedMs:1200,driftMs:40,receiveBps:0});
 emit('webrtc-status', {status:'failed',detail:'retired transport'});
 expect(app.media.detail).toBe('音频加载中'); expect(app.media.bufferedMs).toBe(1200);
});
it('clears playback on leave and ignores late media status', async () => {
 const {useApp} = await import('../src/store'); const app = useApp(); await app.initialize();
 emit('server-message', {type:'snapshot',data:snapshot()}); await app.exitRoom();
 emit('media-status', {status:'playing',detail:'stale'});
 expect(app.media.status).toBe('idle'); expect(app.room).toBeNull();
});
