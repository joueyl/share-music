import { test } from 'node:test';
import assert from 'node:assert/strict';
import { desktopEnvironment, tauriCli } from './desktop.mjs';
import { resolve } from 'node:path';
test('launcher ignores retired native media environment without mutating caller', () => {
 const source = { PATH: 'test', MUSIC_NATIVE_LIBRARY: 'stale.dll', MUSIC_NATIVE_LICENSES: 'old', MUSIC_NATIVE_DEPENDENCIES: 'old' };
 assert.deepEqual(desktopEnvironment(source), { PATH: 'test' });
 assert.equal(source.MUSIC_NATIVE_LIBRARY, 'stale.dll');
});
test('resolves the existing Tauri CLI', () => assert.match(tauriCli(resolve('.')), /tauri\.js$/));
