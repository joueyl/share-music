import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const native=vi.hoisted(()=>({active:false,invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>native.active,invoke:native.invoke}));
beforeEach(()=>{vi.resetModules();native.active=false;native.invoke.mockReset();});
afterEach(()=>vi.unstubAllEnvs());
const credentials={serverUrl:'https://example.com',name:'tester',password:'example-password'};
it.each(['desktop','apk'])('%s browser never stores passwords or invokes native commands',async target=>{
 vi.stubEnv('VITE_CLIENT_TARGET',target);
 const login=await import('../src/saved-login');
 expect(await login.canRememberLogin()).toBe(false);expect(await login.loadSavedLogin()).toBeNull();
 await login.clearSavedLogin();await expect(login.saveLogin(credentials)).rejects.toThrow('SAVED_LOGIN_UNSUPPORTED');
 expect(native.invoke).not.toHaveBeenCalled();
});
it.each([['desktop',''],['apk','plugin:saved-login|']])('%s routes only credential commands to its secure backend',async(target,prefix)=>{
 vi.stubEnv('VITE_CLIENT_TARGET',target);native.active=true;
 const login=await import('../src/saved-login');
 native.invoke.mockResolvedValueOnce(true).mockResolvedValueOnce(credentials);
 expect(await login.canRememberLogin()).toBe(true);expect(await login.loadSavedLogin()).toEqual(credentials);
 await login.saveLogin(credentials);await login.clearSavedLogin();
 expect(native.invoke.mock.calls).toEqual([[prefix+'can_remember_login'],[prefix+'load_saved_login'],[prefix+'save_login',{credentials}],[prefix+'clear_saved_login']]);
});
it('does not claim success when native storage fails',async()=>{
 vi.stubEnv('VITE_CLIENT_TARGET','apk');native.active=true;native.invoke.mockRejectedValue('SAVED_LOGIN_WRITE_FAILED');
 const login=await import('../src/saved-login');await expect(login.saveLogin(credentials)).rejects.toBe('SAVED_LOGIN_WRITE_FAILED');
});
