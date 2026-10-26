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
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.stubEnv('VITE_SERVER_URL','http://127.0.0.1:3000'); native.desktop = false; native.invoke.mockReset(); native.invoke.mockResolvedValue(undefined); Socket.instances = []; vi.stubGlobal('WebSocket', Socket); vi.stubGlobal('fetch', vi.fn(async () => response())); setActivePinia(createPinia()); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
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
 const {useApp} = await import('../src/store'); const app = useApp(); await app.initialize(); await app.login('tester','test-password',false);
 const old = Socket.instances[0]; old.open(); old.message({type:'authenticated'});
 old.message({type:'snapshot',data:{id:'room',hostId:'test-user',members:[],playback:{},pending:null}});
 app.offset=123; app.media={status:'playing',detail:'old',bufferedMs:3000,driftMs:5,receiveBps:100};
 await app.logout(); expect(app.user).toBeNull(); expect(app.room).toBeNull(); expect(app.connected).toBe(false); expect(app.offset).toBe(0); expect(app.media.status).toBe('idle'); expect(app.host).toBe(false); expect(app.permission.skip).toBe(false);
 old.message({type:'snapshot',data:{id:'stale'}}); expect(app.room).toBeNull();
 await app.login('tester','test-password',false); Socket.instances[1].open(); Socket.instances[1].message({type:'authenticated'});
 expect(app.user?.name).toBe('tester'); expect(app.connected).toBe(true); await app.logout();
});
it('desktop logout invokes the native session teardown', async () => {
 native.desktop=true; const bridge=await import('../src/bridge'); await bridge.logout(); expect(native.invoke).toHaveBeenCalledWith('logout');
});

it('remembers credentials only after successful desktop authentication and clears them on logout', async () => {
 native.desktop=true;
 const {useApp}=await import('../src/store'); const app=useApp();
 await app.login('tester','test-password',false,true);
 expect(app.user?.name).toBe('tester');
 expect(native.invoke).toHaveBeenCalledWith('save_login',{credentials:{serverUrl:'http://127.0.0.1:3000',name:'tester',password:'test-password'}});
 await app.logout();expect(native.invoke).toHaveBeenCalledWith('clear_saved_login');expect(app.user).toBeNull();
});
it('does not save failed logins and removes invalid remembered credentials', async () => {
 native.desktop=true;
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:401,json:async()=>({error:'INVALID_CREDENTIALS'})})));
 const {useApp}=await import('../src/store');const app=useApp();
 await app.login('tester','test-password',false,true);
 expect(app.user).toBeNull();expect(app.notice).toBe('用户名或密码错误');
 expect(native.invoke).not.toHaveBeenCalledWith('save_login',expect.anything());
 expect(native.invoke).toHaveBeenCalledWith('clear_saved_login');
});
it('clears old saved credentials when logging in without remember and retains the session if saving fails', async () => {
 native.desktop=true;
 const {useApp}=await import('../src/store');const app=useApp();
 await app.login('tester','test-password',false);
 expect(native.invoke).toHaveBeenCalledWith('clear_saved_login');
 native.invoke.mockRejectedValueOnce('SAVED_LOGIN_WRITE_FAILED');
 await app.login('tester','test-password',false,true);
 expect(app.user?.name).toBe('tester');expect(app.notice).toContain('无法保存密码');expect(app.busy).toBe(false);
});

it('desktop uses WebSocket clock samples, including an immediate sample on connect', async () => {
 native.desktop=true; native.invoke.mockResolvedValue({native:true,reason:''});
 const {useApp}=await import('../src/store'); const app=useApp(); await app.initialize();
 await app.login('tester','test-password',false);
 const socket=Socket.instances[0]; socket.open(); socket.message({type:'authenticated'});
 expect(socket.sent.some(message=>message.type==='clock')).toBe(true);
 const now=Date.now(); socket.message({type:'clock',clientSentAt:now-100,serverReceivedAt:now+9950,serverSentAt:now+9950});
 expect(app.offset).toBe(10000);
 await app.logout();
});

it('leaving drops late snapshots and media status and works while disconnected', async () => {
 const bridge = await import('../src/bridge'); const {useApp} = await import('../src/store'); const app=useApp(); await app.initialize();
 await app.login('tester','test-password',false);
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

it('automatically authenticates with saved server and credentials without registering again', async () => {
 native.desktop=true;
 native.invoke.mockImplementation(async(command:string)=>command==='load_saved_login'?{serverUrl:'http://127.0.0.1:3000',name:'tester',password:'test-password'}:undefined);
 const {useApp}=await import('../src/store');const app=useApp();
 expect(await app.restoreLogin()).toEqual({name:'tester'});
 expect(app.user?.name).toBe('tester');
 const options=vi.mocked(fetch).mock.calls[0][1];
 expect(JSON.parse(String(options?.body))).toEqual({name:'tester',password:'test-password',register:false});
});
it('does not attempt automatic login when nothing is saved', async () => {
 native.desktop=true;native.invoke.mockResolvedValue(null);
 const {useApp}=await import('../src/store');const app=useApp();
 expect(await app.restoreLogin()).toBeNull();expect(fetch).not.toHaveBeenCalled();expect(app.user).toBeNull();
});
it('does not send saved development credentials to the production server', async () => {
 native.desktop=true;vi.stubEnv('VITE_SERVER_URL','https://share.jouei.cn');
 native.invoke.mockResolvedValue({serverUrl:'http://127.0.0.1:3000',name:'tester',password:'test-password'});
 const {useApp}=await import('../src/store');const app=useApp();
 expect(await app.restoreLogin()).toBeNull();expect(fetch).not.toHaveBeenCalled();expect(app.user).toBeNull();
 expect(app.notice).toContain('请重新登录');
});
it('uses the production environment address for manual authentication and remembered credentials', async () => {
 native.desktop=true;vi.stubEnv('VITE_SERVER_URL','https://share.jouei.cn');
 const {useApp}=await import('../src/store');const app=useApp();
 await app.login('tester','test-password',false,true);
 expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://share.jouei.cn/api/login');
 expect(native.invoke).toHaveBeenCalledWith('save_login',{credentials:{serverUrl:'https://share.jouei.cn',name:'tester',password:'test-password'}});
});
it('does not erase saved credentials after a temporary auto-login network failure', async () => {
 native.desktop=true;
 native.invoke.mockResolvedValue({serverUrl:'http://127.0.0.1:3000',name:'tester',password:'test-password'});
 vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('Network unavailable');}));
 const {useApp}=await import('../src/store');const app=useApp();await app.restoreLogin();
 expect(app.user).toBeNull();expect(app.busy).toBe(false);expect(app.notice).toBe('Network unavailable');
 expect(native.invoke).not.toHaveBeenCalledWith('clear_saved_login');
});

it('waits for chat confirmation, propagates rejection and times out without losing the request ID',async()=>{
 const bridge=await import('../src/bridge');await bridge.login('http://127.0.0.1:3000','tester','test-password',false);
 const socket=Socket.instances[0];socket.open();
 const data={id:'message',requestId:'request',roomId:'room',userId:'test-user',userName:'tester',text:'hello',sentAt:Date.now()};
 const pending=bridge.sendChat('room','hello','request');await Promise.resolve();
 expect(socket.sent.at(-1)).toEqual({type:'chat',roomId:'room',text:'hello',requestId:'request'});
 socket.message({type:'chat',data});await expect(pending).resolves.toEqual(data);
 const failed=bridge.sendChat('room','hello','failed');const rejected=expect(failed).rejects.toThrow('RATE_LIMITED');await Promise.resolve();socket.message({type:'chat-error',requestId:'failed',error:'RATE_LIMITED'});await rejected;
 const timed=bridge.sendChat('room','hello','timed');const timeout=expect(timed).rejects.toThrow('发送超时');await vi.advanceTimersByTimeAsync(8001);await timeout;
 await bridge.logout();await expect(bridge.sendChat('room','hello','offline')).rejects.toThrow('控制连接未就绪');
});
it('accepts an independent chat receipt without waiting for a broadcast',async()=>{
 const bridge=await import('../src/bridge');await bridge.login('http://127.0.0.1:3000','tester','test-password',false);
 const socket=Socket.instances[0];socket.open();
 const data={id:'message',requestId:'request',roomId:'room',userId:'test-user',userName:'tester',text:'hello',sentAt:Date.now()};
 const pending=bridge.sendChat('room','hello','request');await Promise.resolve();
 socket.message({type:'chat-result',requestId:'other',data});
 socket.message({type:'chat-result',requestId:'request',data});await expect(pending).resolves.toEqual(data);
});
it('reports an old server protocol rejection immediately instead of timing out',async()=>{
 const bridge=await import('../src/bridge');await bridge.login('http://127.0.0.1:3000','tester','test-password',false);
 const socket=Socket.instances[0];socket.open();
 for(const [error,expected] of [['UNKNOWN_MESSAGE','CHAT_UNSUPPORTED'],['INVALID_REQUEST','INVALID_REQUEST']]){
  const pending=bridge.sendChat('room','hello','request');const rejected=expect(pending).rejects.toThrow(expected);await Promise.resolve();
  socket.message({type:'error',error});await rejected;
 }
});
it('ends pending chat confirmation on disconnect or room leave',async()=>{
 const bridge=await import('../src/bridge');await bridge.login('http://127.0.0.1:3000','tester','test-password',false);
 const socket=Socket.instances[0];socket.open();
 const pending=bridge.sendChat('room','hello','request');const disconnected=expect(pending).rejects.toThrow('CHAT_DISCONNECTED');await Promise.resolve();
 socket.close();await disconnected;
 socket.open();
 const next=bridge.sendChat('room','hello','retry');const left=expect(next).rejects.toThrow('NOT_IN_ROOM');
 await bridge.leave();await left;
 expect(socket.sent.some(m=>m.type==='chat'&&m.requestId==='retry')).toBe(false);
});
it('keeps room chat isolated, deduplicated and bounded and clears it on leave',async()=>{
 const {useApp}=await import('../src/store');const app=useApp();await app.initialize();await app.login('tester','test-password',false);
 const socket=Socket.instances[0];socket.open();socket.message({type:'authenticated'});
 const snapshot={id:'room',hostId:'test-user',members:[],playback:{},pending:null};socket.message({type:'snapshot',data:snapshot});
 const message=(i:number)=>({id:`msg-${i}`,roomId:'room',requestId:`request-${i}`,userId:'test-user',userName:'tester',text:`hello ${i}`,sentAt:Date.now()});
 socket.message({type:'chat-history',roomId:'other',messages:[message(0)]});expect(app.chatMessages).toEqual([]);
 socket.message({type:'chat-history',roomId:'room',messages:[message(0)]});
 socket.message({type:'chat-result',requestId:'request-0',data:message(0)});expect(app.chatMessages).toHaveLength(1);
 socket.message({type:'chat',data:message(0)});expect(app.chatMessages).toHaveLength(1);
 socket.message({type:'chat',data:{...message(1),roomId:'other'}});expect(app.chatMessages).toHaveLength(1);
 for(let i=1;i<=105;i++)socket.message({type:'chat',data:message(i)});
 expect(app.chatMessages).toHaveLength(100);expect(app.chatMessages[0].id).toBe('msg-6');
 socket.message({type:'snapshot',data:{...snapshot,id:'next'}});expect(app.chatMessages).toEqual([]);
 socket.message({type:'snapshot',data:snapshot});socket.message({type:'chat-result',requestId:'request-1',data:message(1)});expect(app.chatMessages).toHaveLength(1);await app.exitRoom();expect(app.chatMessages).toEqual([]);
 socket.message({type:'chat-result',requestId:'request-2',data:message(2)});expect(app.chatMessages).toEqual([]);
 socket.message({type:'chat',data:message(2)});expect(app.chatMessages).toEqual([]);
});

it('routes native media callbacks through the authenticated room command channel and rejects stale callbacks',async()=>{
 native.desktop=true;native.invoke.mockResolvedValue({native:true,reason:''});const {listen}=await import('@tauri-apps/api/event');vi.mocked(listen).mockClear();
 const {useApp}=await import('../src/store');const app=useApp();await app.initialize();await app.login('tester','test-password',false);
 const socket=Socket.instances[0];socket.open();socket.message({type:'authenticated'});
 const roomId='00000000-0000-4000-8000-000000000001',trackId='00000000-0000-4000-8000-000000000002';
 socket.message({type:'snapshot',data:{id:roomId,hostId:'test-user',members:[],stateVersion:9,playlist:[{id:trackId,name:'歌曲',durationMs:120000}],pending:null,playback:{sourceId:trackId,sourceEpoch:7,playState:'playing',positionMs:1000,effectiveAtServerMs:Date.now()}}});
 const callback=vi.mocked(listen).mock.calls.find(([name])=>name==='system-media-control')![1];
 const event={action:'toggle',roomId,trackId,sourceEpoch:7};callback({payload:event} as any);await Promise.resolve();
 expect(socket.sent.at(-1)).toMatchObject({type:'command',data:{roomId,expectedStateVersion:9,action:{type:'pause',payload:{}}}});
 const count=socket.sent.length;callback({payload:{...event,sourceEpoch:6}} as any);expect(socket.sent).toHaveLength(count);
 await app.logout();callback({payload:event} as any);expect(socket.sent).toHaveLength(count);
});
