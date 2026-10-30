import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webviewBundle } from './package-webview.mjs';
for (const platform of ['win32','darwin','linux']) test(`${platform} bundles WebView without native media libraries`, () => {
 const {bundle} = webviewBundle(process.cwd(), platform);
 assert.equal(bundle.active, true);
 assert.equal(Object.keys(bundle.resources).length, 2);
 assert(!JSON.stringify(bundle).match(/ffmpeg|vcpkg|avcodec|music_native|pipewire/i));
 if (platform === 'win32') assert.equal(bundle.windows.webviewInstallMode.type, 'downloadBootstrapper');
 if (platform === 'darwin') assert.equal(bundle.macOS.frameworks, undefined);
});
