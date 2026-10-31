import { expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { loginPage } from '../src/netease.page';

function page() {
 const elements=new Map<string,any>();
 const element=(id:string)=>{
  if(!elements.has(id))elements.set(id,{value:'',hidden:false,disabled:false,textContent:'',type:'password',checked:false,dataset:{},setAttribute:vi.fn(),focus:vi.fn(),reportValidity:()=>true});
  return elements.get(id);
 };
 const tabs=['qr','phone','email'].map(mode=>Object.assign(element('tab-'+mode),{dataset:{mode}}));
 const pending:{path:string;data:any;resolve:(value:any)=>void}[]=[];
 const fetch=vi.fn((path:string,options:any)=>new Promise(resolve=>pending.push({path,data:JSON.parse(options.body),resolve})));
 const timers:any[]=[];
 const context={document:{getElementById:element,querySelectorAll:()=>tabs},fetch,setTimeout:vi.fn(fn=>{timers.push(fn);return timers.length;}),clearTimeout:vi.fn(),window:{addEventListener:vi.fn()}};
 runInNewContext(loginPage.match(/<script>([\s\S]*)<\/script>/)![1],context);
 const respond=async(index:number,body:any,ok=true)=>{pending[index].resolve({ok,json:async()=>body});for(let i=0;i<10;i++)await Promise.resolve();};
 const submit=()=>element('account-form').onsubmit({preventDefault(){}});
 return {element,tabs,pending,respond,submit,context};
}
it('switches login methods, disables irrelevant required fields and ignores stale QR responses',async()=>{
 const p=page();expect(p.pending[0].path).toBe('/loginServe/qr');
 p.tabs[1].onclick();expect(p.element('phone').disabled).toBe(false);expect(p.element('email').disabled).toBe(true);
 await p.respond(0,{image:'data:image/png;base64,AA==',sessionId:'stale'});
 expect(p.pending).toHaveLength(1);expect(p.element('qr').hidden).toBe(true);
 p.element('password').value='secret';p.tabs[2].onclick();
 expect(p.element('password').value).toBe('');expect(p.element('phone').disabled).toBe(true);expect(p.element('countrycode').disabled).toBe(true);expect(p.element('email').disabled).toBe(false);
});
it('submits phone/email login once, shows real status and clears passwords on success and failure',async()=>{
 const p=page();p.tabs[1].onclick();
 p.element('phone').value='13800138000';p.element('countrycode').value='86';p.element('password').value='test-secret';
 const task=p.submit();expect(p.pending[1].data).toEqual({type:'phone',phone:'13800138000',countrycode:'86',password:'test-secret'});
 await p.submit();expect(p.pending).toHaveLength(2);expect(p.tabs.every(tab=>tab.disabled)).toBe(true);
 await p.respond(1,{code:200});await task;
 expect(p.element('status').textContent).toContain('登录成功');expect(p.element('password').value).toBe('');expect(p.element('submit').disabled).toBe(false);
 p.tabs[2].onclick();p.element('email').value='test@example.com';p.element('password').value='wrong';
 const failed=p.submit();expect(p.pending[2].data.type).toBe('email');expect(p.pending[2].data).not.toHaveProperty('phone');
 await p.respond(2,{error:'INVALID_CREDENTIALS'},false);await failed;
 expect(p.element('status').textContent).toContain('账号或密码错误');expect(p.element('password').value).toBe('');
 p.element('show-password').checked=true;p.element('show-password').onchange();expect(p.element('password').type).toBe('text');
});
it('keeps QR polling and stops scheduling after confirmed success',async()=>{
 const p=page();await p.respond(0,{image:'data:image/png;base64,AA==',sessionId:'qr-session'});
 expect(p.pending[1].data).toEqual({sessionId:'qr-session'});
 await p.respond(1,{code:803});expect(p.element('status').textContent).toContain('登录成功');expect(p.element('qr').hidden).toBe(true);expect(p.context.setTimeout).not.toHaveBeenCalled();
});
