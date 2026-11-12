import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../lib/server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 18799;
const base = `http://127.0.0.1:${port}`;

let service;
let dataDir;
let state;

const post = (route, value) =>
  fetch(base + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value || {}),
  });

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'token-widget-'));
  service = await startServer({
    root,
    dataDir,
    magpieDir: dataDir,
    options: { port, listenTailnet: false, forward: false, gatewayURL: 'http://127.0.0.1:1' },
  });
  state = JSON.parse(await readFile(path.join(dataDir, 'state.json'), 'utf8'));
});

after(async () => {
  await service?.close();
  if (dataDir) await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('the service tells that it is alive', async () => {
  const response = await fetch(base + '/health');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, 'magpie-page-token-widget');
});

test('the overview is only read with the token', async () => {
  const denied = await fetch(base + '/api/v1/overview');
  assert.equal(denied.status, 401);
  const allowed = await fetch(base + '/api/v1/overview', {
    headers: { Authorization: 'Bearer ' + state.token },
  });
  assert.equal(allowed.status, 200);
  const body = await allowed.json();
  assert.equal(body.schemaVersion, 1);
});

test('a pairing code is worth one try', async () => {
  const wrong = await post('/api/v1/session', { code: 'not-the-code' });
  assert.equal(wrong.status, 403);
  const right = await post('/api/v1/session', { code: state.pairing.code });
  assert.equal(right.status, 200);
  const body = await right.json();
  assert.equal(body.token, state.token);
  const again = await post('/api/v1/session', { code: state.pairing.code });
  assert.equal(again.status, 403);
});

test('the widget of the phone carries the pairing code', async () => {
  const rotated = await post('/api/v1/console/pair');
  assert.equal(rotated.status, 200);
  const consoleState = await rotated.json();
  const response = await fetch(base + '/scriptable/UsageWidget.js?code=' + consoleState.pairingCode);
  assert.equal(response.status, 200);
  const source = await response.text();
  assert.match(source, /let PAIRED = \{/);
  assert.match(source, /Script\.setWidget/);
  const denied = await fetch(base + '/scriptable/UsageWidget.js?code=nope');
  assert.equal(denied.status, 403);
});

test('the page of the phone explains the three steps', async () => {
  const rotated = await post('/api/v1/console/pair');
  const consoleState = await rotated.json();
  const response = await fetch(base + '/p/' + consoleState.pairingCode);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /下载组件脚本/);
  assert.match(html, /UsageWidget\.js/);
  const expired = await fetch(base + '/p/nope');
  assert.equal(expired.status, 200);
  assert.match(await expired.text(), /已经失效/);
});

test('the console answers on this computer only', async () => {
  const response = await fetch(base + '/api/v1/console/state');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.token, state.token);
  assert.equal(typeof body.pairingCode, 'string');
});

test('the choice of the subscriptions is remembered', async () => {
  const response = await post('/api/v1/console/options', { subscriptions: ['codex'] });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.display.subscriptions, ['codex']);
  await post('/api/v1/console/options', { subscriptions: ['*'] });
});
