import { isTauri } from '@tauri-apps/api/core';

// Android preview reuses the existing pages and browser transport, not desktop IPC.
export function isDesktopRuntime(): boolean {
  return import.meta.env.VITE_ANDROID_PREVIEW !== '1' && isTauri();
}
