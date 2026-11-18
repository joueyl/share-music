import { afterEach, expect, it, vi } from 'vitest';
import { isDesktopRuntime } from '../src/native-runtime';

const native=vi.hoisted(()=>vi.fn());
vi.mock('@tauri-apps/api/core',()=>({isTauri:native}));
afterEach(()=>{vi.unstubAllEnvs();native.mockReset();});

it('keeps real desktop IPC available in ordinary builds',()=>{
 vi.stubEnv('VITE_ANDROID_PREVIEW','');native.mockReturnValue(true);
 expect(isDesktopRuntime()).toBe(true);
});
it('uses the existing browser path in Android preview even inside Tauri',()=>{
 vi.stubEnv('VITE_ANDROID_PREVIEW','1');native.mockReturnValue(true);
 expect(isDesktopRuntime()).toBe(false);
});
it('does not enable desktop commands in a browser',()=>{
 vi.stubEnv('VITE_ANDROID_PREVIEW','');native.mockReturnValue(false);
 expect(isDesktopRuntime()).toBe(false);
});
it('never enables desktop IPC in an independently built APK even without the legacy preview switch',()=>{
 vi.stubEnv('VITE_CLIENT_TARGET','apk');vi.stubEnv('VITE_ANDROID_PREVIEW','');native.mockReturnValue(true);expect(isDesktopRuntime()).toBe(false);
});
