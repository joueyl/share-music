import { invoke, isTauri } from '@tauri-apps/api/core';

// Mobile gets only secure-login IPC; playback/transport still use the browser bridge.
const command = (name: string) => import.meta.env.VITE_CLIENT_TARGET === 'apk' ? `plugin:saved-login|${name}` : name;

export type SavedLogin = { serverUrl: string; name: string; password: string };
export async function canRememberLogin(): Promise<boolean> {
  return isTauri() && await invoke(command('can_remember_login')) === true;
}
export async function loadSavedLogin(): Promise<SavedLogin | null> {
  if (!isTauri()) return null;
  return await invoke<SavedLogin | null>(command('load_saved_login'));
}
export async function saveLogin(credentials: SavedLogin): Promise<void> {
  if (!isTauri()) throw new Error('SAVED_LOGIN_UNSUPPORTED');
  await invoke(command('save_login'), { credentials });
}
export async function clearSavedLogin(): Promise<void> {
  if (isTauri()) await invoke(command('clear_saved_login'));
}
