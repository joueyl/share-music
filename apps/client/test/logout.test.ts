import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
const native = vi.hoisted(() => ({ desktop: false, invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => native.desktop, invoke: native.invoke }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ setShadow: vi.fn().mockResolvedValue(undefined) }) }));
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
it('loads playlist metadata, user pages, paginated songs and word lyrics through the authenticated API',async()=>{
 const bridge=await import('../src/bridge');await bridge.login('http://127.0.0.1:3000','tester','test-password',false);
 const song={id:123,name:'歌曲',ar:[{name:'歌手'}],al:{name:'专辑',picUrl:'http://p1.music.126.net/a.jpg'},dt:120000};
 vi.mocked(fetch).mockImplementation(async(input)=>{
  const url=String(input);const body=url.includes('playlist_detail')?{code:200,playlist:{id:2991837660,name:'收藏',trackCount:1,creator:{userId:288364640}}}:
   url.includes('user_playlist')?{code:200,playlist:[],more:false}:url.includes('playlist_track_all')?{code:200,songs:[song]}:{code:200,yrc:{lyric:'[0,100](0,100,0)你'}};
  return {ok:true,json:async()=>body} as Response;
 });
 expect(await bridge.playlistDetail('2991837660')).toMatchObject({id:'2991837660',creatorId:'288364640'});
 await bridge.userPlaylists('288364640',30);
 expect((await bridge.playlistSongs('2991837660',50))[0]).toMatchObject({id:'123',artists:'歌手',album:'专辑',coverUrl:'https://p1.music.126.net/a.jpg'});
 expect((await bridge.songLyrics('123')).yrc.lyric).toContain('(0,100,0)');
 expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes('offset=50'))).toBe(true);
 expect(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.headers).toMatchObject({Authorization:'Bearer test-token'});
});

it('adds uploaded music using its hash and a stable request ID without uploading audio',async()=>{
 const bridge=await import('../src/bridge');await bridge.login('http://127.0.0.1:3000','tester','test-password',false);
 const hash='f'.repeat(64),track={id:crypto.randomUUID(),name:'已上传歌曲',contentHash:hash,sourceUrl:'https://m801.music.126.net/song.mp3'};
 const fetcher=vi.fn(async()=>({ok:true,json:async()=>({ok:true,track})}));vi.stubGlobal('fetch',fetcher);
 const requestId=crypto.randomUUID();expect(await bridge.addUploadedMusic('room-id',hash,requestId)).toEqual(track);
 const [url,options]=fetcher.mock.calls[0] as unknown as [string,RequestInit];
 expect(url).toBe('http://127.0.0.1:3000/api/rooms/room-id/music/uploaded');
 expect(options.method).toBe('POST');expect(JSON.parse(options.body as string)).toEqual({hash,requestId});
 expect(options.headers).toMatchObject({Authorization:'Bearer test-token'});
});

it('fetches Web playback bytes through the authenticated room endpoint and verifies integrity',async()=>{
 const bridge=await import('../src/bridge');await bridge.login('http://127.0.0.1:3000','tester','test-password',false);
 const bytes=new Uint8Array([255,251,144,0]);const {audioMd5}=await import('../src/audio-integrity');const hash=await audioMd5(bytes);
 const fetcher=vi.fn(async()=>new Response(bytes));vi.stubGlobal('fetch',fetcher);
 const track={sizeBytes:bytes.length,contentHash:hash,name:'song.mp3'} as any;
 expect(new Uint8Array(await bridge.browserAudio('room','song',track))).toEqual(bytes);
 const [url,options]=fetcher.mock.calls[0] as unknown as [string,RequestInit];
 expect(url).toBe('http://127.0.0.1:3000/api/rooms/room/music/song/audio');expect(options.headers).toMatchObject({Authorization:'Bearer test-token'});
 const {loadPlaybackSource}=await import('../src/playback-source');
 const corrupt={...track,contentHash:'0'.repeat(32)};
 await expect(loadPlaybackSource('unused',false,corrupt,()=>bridge.browserAudio('room','song',corrupt))).rejects.toThrow('PLAYBACK_AUDIO_INTEGRITY_FAILED');
});

it('loads and searches uploaded OSS music through the authenticated API with cancellation',async()=>{
 const bridge=await import('../src/bridge');await bridge.login('http://127.0.0.1:3000','tester','test-password',false);
 const result={songs:[{id:'a'.repeat(64),name:'已上传歌曲',artists:'歌手',album:'专辑',coverUrl:'',durationMs:120000,sizeBytes:2048}],total:21};
 const fetcher=vi.fn(async()=>({ok:true,json:async()=>result}));vi.stubGlobal('fetch',fetcher);
 const abort=new AbortController();expect(await bridge.uploadedMusic(' 歌手 & 专辑 ',20,abort.signal)).toEqual(result);
 const [url,options]=fetcher.mock.calls[0] as unknown as [string,RequestInit];
 const parsed=new URL(url);expect(parsed.pathname).toBe('/api/music/uploaded');
 expect(parsed.searchParams.get('keywords')).toBe('歌手 & 专辑');expect(parsed.searchParams.get('offset')).toBe('20');expect(parsed.searchParams.get('limit')).toBe('20');
 expect(options.headers).toMatchObject({Authorization:'Bearer test-token'});expect(options.signal).toBe(abort.signal);
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

it('keeps action feedback until each server receipt and clears it on failure, timeout or disconnect',async()=>{
 const {useApp}=await import('../src/store');const app=useApp();await app.initialize();await app.login('tester','test-password',false);
 const socket=Socket.instances[0];socket.open();socket.message({type:'authenticated'});
 socket.message({type:'snapshot',data:{id:'room',hostId:'test-user',members:[],playlist:[],stateVersion:1,playback:{}}});
 await app.act({type:'stop',payload:{}});const first=socket.sent.at(-1).data.commandId;
 await app.act({type:'clear',payload:{}});const second=socket.sent.at(-1).data.commandId;
 expect(app.pendingActions).toBe(2);
 socket.message({type:'result',commandId:first,ok:true});expect(app.pendingActions).toBe(1);
 socket.message({type:'result',commandId:first,ok:true});expect(app.pendingActions).toBe(1);
 socket.message({type:'result',commandId:second,ok:false,error:'FORBIDDEN'});expect(app.pendingActions).toBe(0);
 await app.act({type:'stop',payload:{}});await vi.advanceTimersByTimeAsync(15000);expect(app.pendingActions).toBe(0);
 await app.act({type:'stop',payload:{}});expect(app.pendingActions).toBe(1);
 socket.close();expect(app.pendingActions).toBe(0);await app.logout();
});
