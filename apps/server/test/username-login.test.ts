import { expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { ApiController } from '../src/controller';
import type { AppService } from '../src/app.service';

function fixture() {
  const login=vi.fn(async()=>({token:'test-token',user:{id:'user-id',name:'Alice'}}));
  const controller=new ApiController({limit:()=>{},auth:{login}} as unknown as AppService);
  const request={ip:'127.0.0.1'} as Request;
  return {controller,login,request};
}
it.each([false,true])('requires only a trimmed username and password (register=%s)',async register=>{
  const {controller,login,request}=fixture();
  await expect(controller.login({name:' Alice ',password:'test-password-123',register},request)).resolves.toHaveProperty('token');
  expect(login).toHaveBeenCalledExactlyOnceWith('Alice','test-password-123',register);
});
it.each([false,true])('rejects email fields before authentication (register=%s)',async register=>{
  const {controller,login,request}=fixture();
  for(const body of [{email:'alice@example.com'},{name:'Alice',email:'alice@example.com'}]) {
    await expect(controller.login({...body,password:'test-password-123',register},request)).rejects.toMatchObject({status:400});
  }
  expect(login).not.toHaveBeenCalled();
});
it('rejects missing, blank, too-short and too-long usernames',async()=>{
  const {controller,login,request}=fixture();
  for(const name of [undefined,'  ','a','x'.repeat(41)])await expect(controller.login({name,password:'test-password-123'},request)).rejects.toMatchObject({status:400});
  expect(login).not.toHaveBeenCalled();
});
