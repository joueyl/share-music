import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
const native = vi.hoisted(() => ({ desktop: false, invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => native.desktop, invoke: native.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
class Socket {
 static OPEN = 1; static instances: Socket[] = [];
 readyState = 0; sent: any[] = []; onopen?: () => void; onclose?: (event: any) => void; onmessage?: (event: any) => void;
 constructor(public url: string) { Socket.instances.push(this); }
 send(value: string) { this.sent.push(JSON.parse(value)); }
 open() { this.readyState = 1; this.onopen?.(); }
 message(value: any) { this.onmessage?.({ data: JSON.stringify(value) }); }
 close(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
}
const response = () => ({ ok: true, json: async () => ({ token: 'test-token', user: { id: 'test-user', name: 'tester' } }) });
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); native.desktop = false; native.invoke.mockReset(); native.invoke.mockResolvedValue(undefined); Socket.instances = []; vi.stubGlobal('WebSocket', Socket); vi.stubGlobal('fetch', vi.fn(async () => response())); setActivePinia(createPinia()); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('closes the browser session, ignores old messages and does not reconnect after logout', async () => {
 const bridge = await import('../src/bridge'); const messages: any[] = []; await bridge.subscribe('server-message', message => messages.push(message));
 await bridge.login('http://127.0.0.1:3000','tester','test-password',false); const old = Socket.instances[0]; old.open();
 expect(old.sent[0]).toEqual({ type: 'auth', token: 'test-token' });
 await bridge.logout(); expect(old.readyState).toBe(3);
 old.message({type:'snapshot',data:{id:'stale'}}); await vi.advanceTimersByTimeAsync(5000);
 expect(messages).toEqual([]); expect(Socket.instances).toHaveLength(1);
 await expect(bridge.send({type:'clock'})).rejects.toThrow('控制连接未就绪');
 await bridge.login('http://127.0.0.1:3000','other','test-password',false);
 old.message({type:'snapshot',data:{id:'stale'}}); const current = Socket.instances[1]; current.open(); current.message({type:'snapshot',data:{id:'fresh'}});
 expect(messages).toEqual([{type:'snapshot',data:{id:'fresh'}}]);
 await bridge.logout();
});
it('cancels a reconnect timer that was already scheduled', async () => {
 const bridge = await import('../src/bridge'); await bridge.login('http://127.0.0.1:3000','tester','test-password',false);
 Socket.instances[0].open(); Socket.instances[0].close(); await bridge.logout(); await vi.advanceTimersByTimeAsync(3000);
 expect(Socket.instances).toHaveLength(1);
});
it('an in-flight login cannot restore credentials after logout', async () => {
 let complete!: (value: any) => void; vi.stubGlobal('fetch',vi.fn(()=>new Promise(resolve=>{complete=resolve;})));
 const bridge = await import('../src/bridge'); const login = bridge.login('http://127.0.0.1:3000','tester','test-password',false);
 const rejected = expect(login).rejects.toThrow('LOGIN_CANCELLED'); await bridge.logout(); complete(response()); await rejected;
 expect(Socket.instances).toHaveLength(0);
});
it('resets room, playback, clock and permissions and accepts a new login', async () => {
 const {useApp} = await import('../src/store'); const app = useApp(); await app.initialize(); await app.login('http://127.0.0.1:3000','tester','test-password',false);
 const old = Socket.instances[0]; old.open(); old.message({type:'authenticated'});
 old.message({type:'snapshot',data:{id:'room',hostId:'test-user',members:[],playback:{},pending:null}});
 app.offset=123; app.media={status:'playing',detail:'old',bufferedMs:3000,driftMs:5,receiveBps:100};
 await app.logout(); expect(app.user).toBeNull(); expect(app.room).toBeNull(); expect(app.connected).toBe(false); expect(app.offset).toBe(0); expect(app.media.status).toBe('idle'); expect(app.host).toBe(false); expect(app.permission.skip).toBe(false);
 old.message({type:'snapshot',data:{id:'stale'}}); expect(app.room).toBeNull();
 await app.login('http://127.0.0.1:3000','tester','test-password',false); Socket.instances[1].open(); Socket.instances[1].message({type:'authenticated'});
 expect(app.user?.name).toBe('tester'); expect(app.connected).toBe(true); await app.logout();
});
it('desktop logout invokes the native session teardown', async () => {
 native.desktop=true; const bridge=await import('../src/bridge'); await bridge.logout(); expect(native.invoke).toHaveBeenCalledWith('logout');
});

it('leaving drops late snapshots and media status and works while disconnected', async () => {
 const bridge = await import('../src/bridge'); const {useApp} = await import('../src/store'); const app=useApp(); await app.initialize();
 await app.login('http://127.0.0.1:3000','tester','test-password',false);
 const socket=Socket.instances[0];socket.open();socket.message({type:'authenticated'});
 socket.message({type:'snapshot',data:{id:'room',hostId:'test-user',members:[],playback:{},pending:null}});
 app.media={status:'playing',detail:'old',bufferedMs:3000,driftMs:10,receiveBps:100};
 await app.exitRoom();expect(app.room).toBeNull();expect(app.media.status).toBe('idle');
 socket.message({type:'snapshot',data:{id:'room',playback:{}}});expect(app.room).toBeNull();
 socket.close();await expect(bridge.leave()).resolves.toBeUndefined();
 await vi.advanceTimersByTimeAsync(3000);const reconnect=Socket.instances.at(-1)!;reconnect.open();reconnect.message({type:'authenticated'});
 expect(reconnect.sent.some(message=>message.type==='join')).toBe(false);
 await bridge.logout();
});
