import { isTauri } from '@tauri-apps/api/core';

// Independent APK UI shares browser transport and never enables desktop IPC.
export function isDesktopRuntime(): boolean {
  return import.meta.env.VITE_CLIENT_TARGET !== 'apk' && import.meta.env.VITE_ANDROID_PREVIEW !== '1' && isTauri();
}
