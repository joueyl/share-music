import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('main WebView keeps playback synchronization running while minimized on macOS 14+', () => {
  const config = JSON.parse(read('apps/client/src-tauri/tauri.conf.json'));
  const main = config.app.windows.find(window => window.label === 'main');
  assert.ok(main);
  assert.equal(main.backgroundThrottling, 'disabled');
  // Validate against the installed CLI contract, not a newer online schema.
  const schema = JSON.parse(read('node_modules/@tauri-apps/cli/config.schema.json'));
  assert.ok(schema.definitions.WindowConfig.properties.backgroundThrottling);
  assert.ok(schema.definitions.BackgroundThrottlingPolicy.oneOf.some(policy => policy.enum?.includes(main.backgroundThrottling)));
});
