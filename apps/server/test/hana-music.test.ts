import { expect, it, vi } from 'vitest';
import { pathToFileURL } from 'node:url';
import { createHanaInvoker, HANA_MAX_WORKERS } from '../src/hana-music';
import { musicMethods } from '../src/netease';

const moduleUrl=(source:string)=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
it('reports only scrobble as Windows 10 with the two existing events and no identity overrides from query',async()=>{
 const invoke=createHanaInvoker(moduleUrl(`const calls=[];
 export async function invokeModule(){throw Error('macOS scrobble module must not run');}
 export async function createRequest(path,data,config){
  calls.push({path,event:JSON.parse(data.logs)[0],cookie:config.cookie,ua:config.ua,crypto:config.crypto,domain:config.domain,retry:config.retry});
  return {status:200,body:{code:200,calls},cookie:[]};
 }`));
 const result=await invoke('scrobble',{id:'42',sourceid:'7',time:185,cookie:'MUSIC_U=fixture; os=osx; mobilename=Old; osver=old',os:'android',mobilename:'bad',domain:'https://invalid.example',timeOverride:1});
 const calls=result.body.calls;
 expect(calls).toHaveLength(2);
 expect(calls.map((call:any)=>call.event)).toEqual([
  {action:'startplay',json:{id:'42',type:'song',mainsite:'1',mainsiteWeb:'1',content:'id=7'}},
  {action:'play',json:{id:'42',type:'song',mainsite:'1',mainsiteWeb:'1',content:'id=7',download:0,end:'playend',sourceId:'7',time:185,wifi:0,source:'list'}}
 ]);
 for(const call of calls){
  expect(call).toMatchObject({path:'/api/feedback/weblog',crypto:'eapi',domain:'https://clientlog.music.163.com',retry:{retries:0,retryNonIdempotent:false},cookie:{MUSIC_U:'fixture',os:'pc',mobilename:'Windows 10',osver:'Microsoft-Windows-10-Professional-build-19045-64bit',appver:'3.1.17.204416'}});
  expect(call.ua).toContain('Windows NT 10.0');
 }
});

it('the installed SDK transports the Windows identity in actual EAPI request headers offline',async()=>{
 const entry=pathToFileURL(require.resolve('hana-music-api')).href;
 const invoke=createHanaInvoker(moduleUrl(`import {createRequest as request} from ${JSON.stringify(entry)};
 const calls=[];
 export async function createRequest(path,data,config){
  const result=await request(path,data,{...config,e_r:false,fetcher:async(url,init)=>{
   const headers=new Headers(init.headers);const cookie=Object.fromEntries(headers.get('cookie').split('; ').map(part=>part.split('=').map(decodeURIComponent)));
   calls.push({url:String(url),os:cookie.os,osver:cookie.osver,mobilename:cookie.mobilename,ua:headers.get('user-agent'),authenticated:cookie.MUSIC_U==='fixture'});
   return new Response(JSON.stringify({code:200}),{status:200,headers:{'content-type':'application/json'}});
  }});
  return {...result,body:{...result.body,calls}};
 }`));
 const result=await invoke('scrobble',{id:'42',sourceid:'7',time:185,cookie:'MUSIC_U=fixture'});
 expect(result.body.calls).toHaveLength(2);
 for(const call of result.body.calls)expect(call).toMatchObject({url:'https://clientlog.music.163.com/eapi/feedback/weblog',os:'pc',mobilename:'Windows 10',authenticated:true,ua:expect.stringContaining('Windows NT 10.0')});
});

it.each([null,{}, {code:403}, {code:200.5}])('does not send the second scrobble event after invalid or rejected startplay: %j',async body=>{
 const invoke=createHanaInvoker(moduleUrl(`let calls=0;export async function createRequest(){
  if(++calls>1)return {status:200,body:{code:200},cookie:[]};
  return {status:200,body:${JSON.stringify(body)},cookie:[]};
 }`),18000,()=>{});
 const call=invoke('scrobble',{id:'42',sourceid:'7',time:185});
 if(body?.code===403)expect(await call).toMatchObject({body:{code:403}});
 else await expect(call).rejects.toThrow('NETEASE_UNAVAILABLE');
});
it('bounds mixed rapid-switch calls before SDK startup and releases all worker slots',async()=>{
 const state=new Int32Array(new SharedArrayBuffer(8)),log=vi.fn();
 const invoke=createHanaInvoker(moduleUrl(`export async function invokeModule(name,query){
  const state=new Int32Array(query.state);
  Atomics.add(state,0,1);
  Atomics.wait(state,1,0);
  return {status:200,body:{code:200},cookie:[]};
 }`),18000,log);
 const running=['lyric_new','simi_song','batch_probe','song_detail'].map(name=>invoke(name,{state:state.buffer}));
 const completed=Promise.allSettled(running);
 try {
  await vi.waitFor(()=>expect(Atomics.load(state,0)).toBe(HANA_MAX_WORKERS),{timeout:5000});
  const burst=await Promise.allSettled(Array.from({length:100},()=>invoke('lyric_new',{state:state.buffer,cookie:'private-cookie'})));
  expect(burst.every(result=>result.status==='rejected'&&result.reason.message==='NETEASE_UNAVAILABLE')).toBe(true);
  expect(Atomics.load(state,0)).toBe(HANA_MAX_WORKERS);
 } finally {
  Atomics.store(state,1,1);Atomics.notify(state,1);
  await completed;
 }
 expect((await completed).every(result=>result.status==='fulfilled')).toBe(true);
 // Successful completion means termination is finished, not just requested.
 const next=await Promise.all(Array.from({length:HANA_MAX_WORKERS},()=>invoke('lyric_new',{state:state.buffer})));
 expect(next).toHaveLength(HANA_MAX_WORKERS);expect(log).not.toHaveBeenCalled();
},15000);

it.each(['sdk_error','worker_error','worker_exit','setup_error','timeout'])('releases capacity after %s without retrying',async failure=>{
 const invoke=createHanaInvoker(moduleUrl(`export async function invokeModule(name){
  if(name==='sdk_error')throw Error('private');
  if(name==='worker_error'){setImmediate(()=>{throw Error('private');});await new Promise(()=>{});}
  if(name==='worker_exit')process.exit(1);
  if(name==='timeout'){setInterval(()=>{},1000);await new Promise(()=>{});}
  return {status:200,body:{code:200},cookie:[]};
 }`),1000,()=>{});
 const failed=await Promise.allSettled(Array.from({length:HANA_MAX_WORKERS},()=>invoke(failure,failure==='setup_error'?{uncloneable:()=>{}}:{})));
 expect(failed.every(result=>result.status==='rejected'&&result.reason.message==='NETEASE_UNAVAILABLE')).toBe(true);
 const recovered=await Promise.all(Array.from({length:HANA_MAX_WORKERS},()=>invoke('search',{})));
 expect(recovered).toHaveLength(HANA_MAX_WORKERS);
});
it('ignores loader/watch messages on parentPort until the SDK result arrives',async()=>{
 const log=vi.fn();
 const invoke=createHanaInvoker(moduleUrl(`import {parentPort} from 'node:worker_threads';
 parentPort.postMessage({type:'dependency',path:'private-loader-path'});
 parentPort.postMessage(null);
 parentPort.postMessage({ok:false,diagnostic:{phase:'import'}});
 export async function invokeModule(){return {status:200,body:{code:200},cookie:[]};}`),18000,log);
 await expect(invoke('cloudsearch',{})).resolves.toEqual({body:{code:200},cookie:[]});
 expect(log).not.toHaveBeenCalled();
});
it('reports safe failure stages and schema paths without raw errors, request input or credentials',async()=>{
 const log=vi.fn();
 const invoke=createHanaInvoker(moduleUrl(`export async function invokeModule(){throw {status:502,body:{code:502,cookie:'private-cookie',msg:'private-message',upstreamShape:{path:'body.result.songs[0].name',expected:'private-value'}}}}`),18000,log);
 await expect(invoke('cloudsearch',{keywords:'private-keyword',cookie:'private-request-cookie'})).rejects.toThrow(/^NETEASE_UNAVAILABLE$/);
 expect(log).toHaveBeenCalledExactlyOnceWith('网易云 SDK 调用失败 {"method":"cloudsearch","phase":"response_shape","status":502,"bodyCode":502,"shapePath":"body.result.songs[0].name"}');
 expect(log.mock.calls.flat().join(' ')).not.toContain('private-');
});
it('reports module import failures without logging paths or the raw loader error',async()=>{
 const log=vi.fn(),invoke=createHanaInvoker('file:///not-existing-private-module.js',18000,log);
 await expect(invoke('cloudsearch',{})).rejects.toThrow(/^NETEASE_UNAVAILABLE$/);
 expect(log).toHaveBeenCalledExactlyOnceWith('网易云 SDK 调用失败 {"method":"cloudsearch","phase":"import"}');
});

it('calls the ESM Promise SDK with business input and execution config separated',async()=>{
 const invoke=createHanaInvoker(moduleUrl(`export async function invokeModule(name,query,config){
  const {onRequestEvent,...safeConfig}=config;
  return {status:200,body:{name,query,config:safeConfig,hasDiagnosticsHook:typeof onRequestEvent==='function'},cookie:['MUSIC_U=fixture; Path=/']};
 }`));
 const result=await invoke('search',{keywords:'晴天',cookie:'MUSIC_U=fixture',timestamp:123,noCookie:true,realIP:'192.0.2.1'});
 expect(result).toEqual({body:{name:'search',query:{keywords:'晴天'},hasDiagnosticsHook:true,config:{cookie:'MUSIC_U=fixture',realIP:'122.228.189.154',timeoutMs:15000,retry:{retries:0,retryNonIdempotent:false}}},cookie:['MUSIC_U=fixture; Path=/']});
});

it('keeps only business login codes, never raw rejection credentials',async()=>{
 const invoke=createHanaInvoker(moduleUrl(`export async function invokeModule(){throw {status:400,body:{code:10004,cookie:'private',message:'private'}}}`));
 expect(await invoke('login_cellphone',{})).toEqual({body:{code:10004}});
 await expect(invoke('search',{})).rejects.toThrow(/^NETEASE_UNAVAILABLE$/);
});

it('preserves rejected scrobble bodies for the existing sanitized response logger',async()=>{
 const invoke=createHanaInvoker(moduleUrl(`export async function createRequest(){throw {status:403,body:{code:403,message:'rejected'}}}`));
 expect(await invoke('scrobble',{id:'42',sourceid:'7',time:185})).toEqual({body:{code:403,message:'rejected'},cookie:[]});
});
it('preserves the already-signed-in code without retrying or exposing extra response fields',async()=>{
 const invoke=createHanaInvoker(moduleUrl(`export async function invokeModule(){throw {status:400,body:{code:-2,cookie:'private'}}}`));
 expect(await invoke('daily_signin',{})).toEqual({body:{code:-2}});
});
it.each([499,502,504])('does not present SDK transport/cancellation status %s as a real scrobble response',async status=>{
 const invoke=createHanaInvoker(moduleUrl(`export async function createRequest(){throw {status:${status},body:{code:${status},msg:'private transport failure'}}}`));
 await expect(invoke('scrobble',{id:'42',sourceid:'7',time:185})).rejects.toThrow(/^NETEASE_UNAVAILABLE$/);
});

it.each([
 `return {status:500,body:{code:200},cookie:[]}`,
 `return {status:200,body:null,cookie:[]}`,
 `return {status:200,body:{code:200}}`,
 `throw {status:502,body:{code:502,upstreamShape:{module:'login'}}}`,
 `throw Error('private raw error')`,
])('rejects non-success or malformed SDK responses safely: %s',async action=>{
 const invoke=createHanaInvoker(moduleUrl(`export async function invokeModule(){${action}}`));
 await expect(invoke('login',{})).rejects.toThrow(/^NETEASE_UNAVAILABLE$/);
});

it('terminates stalled SDK workers instead of blocking the server',async()=>{
 const invoke=createHanaInvoker(moduleUrl(`export async function invokeModule(){setInterval(()=>{},1000);await new Promise(()=>{});}`),100);
 await expect(invoke('search',{})).rejects.toThrow(/^NETEASE_UNAVAILABLE$/);
});

it('loads the installed hana public SDK from the CommonJS worker and generates a QR locally',async()=>{
 const response=await createHanaInvoker()('login_qr_create',{key:'offline-test-key',qrimg:true,cookie:'MUSIC_U=fixture'});
 expect(response.body.code).toBe(200);expect(response.body.data.qrimg).toMatch(/^data:image\/png;base64,/);
 expect(response.body.data.qrurl).toContain('offline-test-key');expect(response.cookie).toEqual([]);
});
it('works with real Node watch dependency reports emitted before the installed SDK result',async()=>{
 const previous=process.env.WATCH_REPORT_DEPENDENCIES;
 process.env.WATCH_REPORT_DEPENDENCIES='1';
 const log=vi.fn();
 try {
  const response=await createHanaInvoker(undefined,18000,log)('login_qr_create',{key:'offline-watch-test',qrimg:true,cookie:'MUSIC_U=fixture'});
  expect(response.body.code).toBe(200);expect(response.body.data.qrimg).toMatch(/^data:image\/png;base64,/);
  expect(log).not.toHaveBeenCalled();
 } finally {
  if(previous===undefined)delete process.env.WATCH_REPORT_DEPENDENCIES;else process.env.WATCH_REPORT_DEPENDENCIES=previous;
 }
});

it('the installed SDK recognizes all existing read-only, login and maintenance module identifiers',async()=>{
 const entry=pathToFileURL(require.resolve('hana-music-api')).href;
 const invoke=createHanaInvoker(moduleUrl(`import {invokeModule as call} from ${JSON.stringify(entry)};
 export async function invokeModule(_,query,config){
  const results=[];
  for(const {name,params} of query.cases){
   try{await call(name,params,{...config,e_r:false,fetcher:async()=>new Response(JSON.stringify({code:403,message:'offline upstream rejected'}),{status:403,headers:{'content-type':'application/json'}})});results.push({name,recognized:false});}
   catch(error){results.push({name,recognized:error?.status===403,upstreamStatus:error?.status});}
  }
  return {status:200,body:{results},cookie:[]};
 }`));
 const queries:Record<string,Record<string,unknown>>={
  search:{keywords:'test'},search_suggest:{keywords:'test'},cloudsearch:{keywords:'test'},
  login:{email:'fixture@example.test',password:'fixture'},login_cellphone:{phone:'13800138000',password:'fixture'},
  login_qr_key:{},login_qr_check:{key:'fixture'},daily_signin:{type:0},yunbei_sign:{},vip_tasks:{},vip_growthpoint_get:{ids:'123_7'},
 };
 const names=[...musicMethods,'login','login_cellphone','login_qr_key','login_qr_check','daily_signin','yunbei_sign','vip_tasks','vip_growthpoint_get','scrobble'];
 // Import the real SDK once, so slower CI runners test every identifier without
 // paying the ESM startup cost in a separate worker for each mocked rejection.
 const result=await invoke('compatibility_probe',{cookie:'MUSIC_U=fixture',cases:names.map(name=>({name,params:queries[name]??{id:'42',ids:'42',uid:'42',sourceid:'7',time:10,level:'standard',br:128000}}))});
 expect(result.body.results.map((item:any)=>item.name)).toEqual(names);
 for(const item of result.body.results)expect(item.recognized,`${item.name}: ${JSON.stringify(item)}`).toBe(true);
},30000);

it('the installed SDK accepts fixed read-only batch parameters in a single mocked transport call',async()=>{
 const entry=pathToFileURL(require.resolve('hana-music-api')).href;
 const invoke=createHanaInvoker(moduleUrl(`import {invokeModule as call} from ${JSON.stringify(entry)};
 export async function invokeModule(_,query,config){
  let count=0;
  const result=await call('batch',query,{...config,e_r:false,fetcher:async()=>{count++;return new Response(JSON.stringify({code:200,'/api/v3/song/detail':{code:200,songs:[]},'/api/song/enhance/player/url':{code:200,data:[]}}),{status:200,headers:{'content-type':'application/json'}});}});
  return {status:200,body:{count,result:result.body},cookie:[]};
 }`));
 const result=await invoke('batch_probe',{cookie:'MUSIC_U=fixture','/api/v3/song/detail':{c:'[{"id":1},{"id":2}]'},'/api/song/enhance/player/url':{ids:'["1","2"]',br:128000}});
 expect(result.body.count).toBe(1);expect(result.body.result.code).toBe(200);
});

it.each([
 ['https://interface.music.163.com/eapi/song/enhance/player/url?private=query','song_url'],
 ['https://music.163.com/weapi/register/anonimous?private=query','anonymous_registration'],
 ['https://music.163.com/api/batch?private=query','batch'],
])('records only a fixed upstream step for a -460 rejection (%s)',async(url,upstreamStep)=>{
 const log=vi.fn(),invoke=createHanaInvoker(moduleUrl(`export async function invokeModule(name,query,config){
  config.onRequestEvent({type:'attempt',url:${JSON.stringify(url)},error:'private error'});
  throw {status:400,body:{code:-460,msg:'private message',cookie:'private cookie'}};
 }`),18000,log);
 await expect(invoke('song_url',{id:'42',cookie:'MUSIC_U=private-fixture'})).rejects.toThrow('NETEASE_UNAVAILABLE');
 expect(log).toHaveBeenCalledExactlyOnceWith('网易云 SDK 调用失败 '+JSON.stringify({method:'song_url',phase:'request',status:400,bodyCode:-460,upstreamStep}));
 expect(log.mock.calls.flat().join(' ')).not.toContain('private');
});
it.each(['https://private.example/credential?token=private','not a URL'])('does not log unrecognized or malformed upstream targets (%s)',async(url)=>{
 const log=vi.fn(),invoke=createHanaInvoker(moduleUrl(`export async function invokeModule(_,query,config){
  config.onRequestEvent({url:${JSON.stringify(url)}});throw {status:400,body:{code:-460}};
 }`),18000,log);
 await expect(invoke('song_url',{})).rejects.toThrow('NETEASE_UNAVAILABLE');
 expect(log).toHaveBeenCalledExactlyOnceWith('网易云 SDK 调用失败 {"method":"song_url","phase":"request","status":400,"bodyCode":-460}');
});
it('does not permit URL-like module names in diagnostic output',async()=>{
 const log=vi.fn(),invoke=createHanaInvoker(moduleUrl(`export async function invokeModule(){throw {status:400,body:{code:-460}};}`),18000,log);
 await expect(invoke('https://private.example/token',{})).rejects.toThrow('NETEASE_UNAVAILABLE');
 expect(log).toHaveBeenCalledExactlyOnceWith('网易云 SDK 调用失败 {"method":"unknown","phase":"request","status":400,"bodyCode":-460}');
});

it.each([['MUSIC_U=fixture','song_url'],['','anonymous_registration']])('classifies actual installed SDK request events with mocked -460 transport (%s)',async(cookie,upstreamStep)=>{
 const entry=pathToFileURL(require.resolve('hana-music-api')).href,log=vi.fn();
 const invoke=createHanaInvoker(moduleUrl(`import {invokeModule as call} from ${JSON.stringify(entry)};
 export async function invokeModule(name,query,config){
  return call(name,query,{...config,fetcher:async()=>new Response(JSON.stringify({code:-460,msg:'private upstream rejection'}),{status:400,headers:{'content-type':'application/json'}})});
 }`),18000,log);
 await expect(invoke('song_url',{id:'42',br:128000,cookie})).rejects.toThrow('NETEASE_UNAVAILABLE');
 expect(log).toHaveBeenCalledExactlyOnceWith('网易云 SDK 调用失败 '+JSON.stringify({method:'song_url',phase:'request',status:400,bodyCode:-460,upstreamStep}));
});

it('serializes only the fixed read batch routes through the public createRequest API',async()=>{
 const invoke=createHanaInvoker(moduleUrl(`export async function invokeModule(){throw Error('batch module must not be used');}
 export async function createRequest(path,data,config){
  return {status:200,body:{path,data,realIP:config.realIP,timeoutMs:config.timeoutMs,retry:config.retry},cookie:[]};
 }`));
 const detail='/api/v3/song/detail',source='/api/song/enhance/player/url';
 const query={[detail]:{c:'[{"id":1},{"id":2}]'},[source]:{ids:'["1","2"]',br:128000}};
 const result=await invoke('batch',query);
 expect(result.body).toEqual({path:'/api/batch',data:{[detail]:JSON.stringify(query[detail]),[source]:JSON.stringify(query[source])},realIP:'122.228.189.154',timeoutMs:15000,retry:{retries:0,retryNonIdempotent:false}});
});
it.each([
 {'/api/private/write':{}},
 {'/api/v3/song/detail':{},'/api/song/enhance/player/url':{},'/api/private/write':{}},
 {'/api/v3/song/detail':'already serialized','/api/song/enhance/player/url':{}},
])('rejects internal batch route injection or unsupported input shapes without making a request',async query=>{
 const invoke=createHanaInvoker(moduleUrl(`export async function invokeModule(){return {status:200,body:{code:200},cookie:[]};}
 export async function createRequest(){return {status:200,body:{code:200},cookie:[]};}`),18000,()=>{});
 await expect(invoke('batch',query)).rejects.toThrow('NETEASE_UNAVAILABLE');
});

it('retains numeric module identifiers in diagnostics without enabling a v1 music route',async()=>{
 const log=vi.fn(),invoke=createHanaInvoker(moduleUrl(`export async function invokeModule(){throw {status:400,body:{code:-460}};}`),18000,log);
 await expect(invoke('test_v2',{})).rejects.toThrow('NETEASE_UNAVAILABLE');
 expect(log).toHaveBeenCalledExactlyOnceWith('网易云 SDK 调用失败 {"method":"test_v2","phase":"request","status":400,"bodyCode":-460}');
});
it('rejects the former v1 batch subrequest instead of calling it as a fallback',async()=>{
 const invoke=createHanaInvoker(moduleUrl(`export async function invokeModule(){throw Error('must not call');}
 export async function createRequest(){return {status:200,body:{code:200},cookie:[]};}`),18000,()=>{});
 await expect(invoke('batch',{'/api/v3/song/detail':{c:'[{"id":1}]'},'/api/song/enhance/player/url/v1':{ids:'[1]',level:'standard'}})).rejects.toThrow('NETEASE_UNAVAILABLE');
});
