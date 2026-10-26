import { invoke, isTauri } from '@tauri-apps/api/core';

export type SavedLogin = { serverUrl: string; name: string; password: string };
export async function canRememberLogin(): Promise<boolean> {
  return isTauri() && await invoke('can_remember_login') === true;
}
export async function loadSavedLogin(): Promise<SavedLogin | null> {
  if (!isTauri()) return null;
  return await invoke<SavedLogin | null>('load_saved_login');
}
export async function saveLogin(credentials: SavedLogin): Promise<void> {
  if (!isTauri()) throw new Error('SAVED_LOGIN_UNSUPPORTED');
  await invoke('save_login', { credentials });
}
export async function clearSavedLogin(): Promise<void> {
  if (isTauri()) await invoke('clear_saved_login');
}
