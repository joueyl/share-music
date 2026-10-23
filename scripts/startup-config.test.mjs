import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
test('desktop URL matches strict Vite development port and loopback host', () => {
  const client = JSON.parse(read('apps/client/package.json'));
  const config = JSON.parse(read('apps/client/src-tauri/tauri.conf.json'));
  const url = new URL(config.build.devUrl);
  assert.equal(url.hostname, '127.0.0.1');
  assert.match(client.scripts.dev, new RegExp(`--port ${url.port}($| )`));
  assert.match(client.scripts.dev, /--host 127\.0\.0\.1/);
  assert.notEqual(url.port, '1420');
});
test('HTTP, WebSocket and example configuration allow the desktop development origin', () => {
  const origin = JSON.parse(read('apps/client/src-tauri/tauri.conf.json')).build.devUrl;
  for (const path of ['apps/server/src/main.ts', 'apps/server/src/gateway.ts', 'apps/server/.env.example']) assert.ok(read(path).includes(origin), path);
});
