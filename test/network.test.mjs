import { after, before, test } from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, TOKEN_HEADER } from '../lib/server.mjs';
import { bindCandidates } from '../lib/tailnet.mjs';
import { cleanup, freePort, mockTailscale, tailscaleStatus, tempDir } from './helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const start = async (dir, options = {}) => startServer({
  root,
  dataDir: dir,
  magpieDir: dir,
  options: {
    port: await freePort(),
    phonePort: await freePort(),
    listenTailnet: false,
    forward: false,
    gatewayURL: 'http://127.0.0.1:1',
    // The tests never touch the real Tailscale of this computer.
    tailscaleRunner: mockTailscale().runner,
    ...options,
  },
});

const post = (base, route, value, headers = {}) => fetch(base + route, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(value || {}),
});

const stateOf = async (dir) => JSON.parse(await readFile(path.join(dir, 'state.json'), 'utf8'));

// A request of our own: fetch will not carry a Host of our own.
const rawGet = (host, port, route, headers = {}) => new Promise((resolve, reject) => {
  const request = http.request({ host, port, path: route, headers }, (response) => {
    let body = '';
    response.on('data', (piece) => { body += piece; });
    response.on('end', () => resolve({ status: response.statusCode, body }));
  });
  request.on('error', reject);
  request.end();
});

const waitForConsole = async (base, token) => {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const response = await fetch(base + '/api/v1/console/state', { headers: { [TOKEN_HEADER]: token } });
    if (response.status !== 503) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('the console of the service never opened');
};

// A service of its own, so that one test cannot bother another.
const withService = async (fn, options = {}, prepared = null) => {
  const dir = await tempDir();
  if (prepared) await writeFile(path.join(dir, 'state.json'), JSON.stringify(prepared));
  const service = await start(dir, options);
  const base = `http://127.0.0.1:${service.port}`;
  const token = (await stateOf(dir)).consoleToken;
  await waitForConsole(base, token);
  try {
    await fn({ dir, service, base, token });
  } finally {
    await service.close();
    await cleanup(dir);
  }
};

test('the address the phone is told to use is checked', async () => {
  await withService(async ({ base, token }) => {
    const good = [
      'http://192.168.1.50:8791',
      'https://example.com',
      'https://example.com/widget',
      'http://[::1]:8791',
      'http://myserver:8080',
    ];
    for (const value of good) {
      const answer = await post(base, '/api/v1/console/options', { externalURL: value }, { [TOKEN_HEADER]: token });
      assert.equal(answer.status, 200, value);
    }
    const bad = [
      'example.com',
      'ftp://example.com',
      'http://user@example.com',
      'http://example.com:99999',
      'http://example.com:0',
      'http://exa mple.com',
    ];
    for (const value of bad) {
      const answer = await post(base, '/api/v1/console/options', { externalURL: value }, { [TOKEN_HEADER]: token });
      assert.equal(answer.status, 400, value);
    }
  });
});

test('a refused address changes nothing at all', async () => {
  await withService(async ({ base, token }) => {
    await post(base, '/api/v1/console/options', { subscriptions: ['codex'] }, { [TOKEN_HEADER]: token });
    const answer = await post(
      base,
      '/api/v1/console/options',
      { externalURL: 'example.com', subscriptions: ['minimax'] },
      { [TOKEN_HEADER]: token },
    );
    assert.equal(answer.status, 400);
    const state = await (await fetch(base + '/api/v1/console/state', { headers: { [TOKEN_HEADER]: token } })).json();
    assert.equal(state.external.url, '');
    assert.deepEqual(state.display.subscriptions, ['codex']);
  });
});

test('the phone is told the address of the user', async () => {
  await withService(async ({ dir, base, token }) => {
    await post(base, '/api/v1/console/options', { externalURL: 'http://192.168.1.50:8791' }, { [TOKEN_HEADER]: token });
    const state = await (await fetch(base + '/api/v1/console/state', { headers: { [TOKEN_HEADER]: token } })).json();
    assert.equal(state.external.url, 'http://192.168.1.50:8791');
    assert.equal(state.serviceURL, 'http://192.168.1.50:8791');
    assert.ok(state.pairingURL.startsWith('http://192.168.1.50:8791/p/'), state.pairingURL);
    // A phone that pairs is told the same address.
    await post(base, '/api/v1/console/pair', {}, { [TOKEN_HEADER]: token });
    const code = (await stateOf(dir)).pairing.code;
    const session = await post(base, '/api/v1/session', { code });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).baseURL, 'http://192.168.1.50:8791');
  });
});

test('the forwarding of the tailnet is not built when the user has an address of his own', async () => {
  const mock = mockTailscale();
  await withService(async ({ base, token }) => {
    const built = mock.calls.filter((line) => line.includes('--bg'));
    assert.equal(built.length, 0);
  }, { forward: true, tailscaleRunner: mock.runner }, {
    version: 1,
    consoleToken: 'console-token-for-the-test-of-a-network-of-ones-own',
    pairing: { code: 'code-for-the-test', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString() },
    settings: { externalURL: 'http://192.168.1.50:8791' },
    paired: [],
    devices: [],
  });
});

test('the phone side does not listen on an address that is not of this computer', async () => {
  await withService(async ({ base, token }) => {
    const answer = await post(base, '/api/v1/console/options', { listenAddress: '10.9.9.9' }, { [TOKEN_HEADER]: token });
    assert.equal(answer.status, 400);
    const state = await (await fetch(base + '/api/v1/console/state', { headers: { [TOKEN_HEADER]: token } })).json();
    assert.equal(state.external.listenAddress, '');
  });
});

test('the phone side listens on an address of this computer', async (t) => {
  const candidates = bindCandidates();
  if (!candidates.length) {
    t.skip('this computer has no address of its own to bind');
    return;
  }
  const address = candidates[0].address;
  await withService(async ({ base, service, token }) => {
    const answer = await post(base, '/api/v1/console/options', { listenAddress: address }, { [TOKEN_HEADER]: token });
    assert.equal(answer.status, 200);
    const state = await (await fetch(base + '/api/v1/console/state', { headers: { [TOKEN_HEADER]: token } })).json();
    assert.equal(state.external.listenAddress, address);
    // The socket is open there, and it answers as the phone side.
    const health = await fetch(`http://${address.includes(':') ? `[${address}]` : address}:${service.phonePort}/health`);
    assert.equal(health.status, 200);
  });
});

test('the door of the phone on the own network opens the phone side only', async (t) => {
  const candidates = bindCandidates();
  if (!candidates.length) {
    t.skip('this computer has no address of its own to bind');
    return;
  }
  const address = candidates[0].address;
  const host = address.includes(':') ? `[${address}]` : address;
  await withService(async ({ base, service, dir, token }) => {
    const answer = await post(base, '/api/v1/console/options', { listenAddress: address }, { [TOKEN_HEADER]: token });
    assert.equal(answer.status, 200);
    const phone = `http://${host}:${service.phonePort}`;
    // The console of this computer is not on that door, even with its token.
    const consoleAnswer = await fetch(`${phone}/api/v1/console/state`, { headers: { [TOKEN_HEADER]: token } });
    assert.equal(consoleAnswer.status, 403);
    // And the port of the console is not open on that address at all.
    await assert.rejects(fetch(`http://${host}:${service.port}/health`));
    // A name that is not ours is refused.
    const forged = await rawGet(address, service.phonePort, '/health', { Host: 'made-up.example' });
    assert.equal(forged.status, 403);
    // The page of the pairing code is open there: that is the way in.
    const code = (await stateOf(dir)).pairing.code;
    const page = await fetch(`${phone}/p/${code}`);
    assert.equal(page.status, 200);
  });
});

test('the address of the user can be cleared, and the tailnet comes back', async () => {
  const mock = mockTailscale({ status: tailscaleStatus });
  await withService(async ({ base, token }) => {
    await post(base, '/api/v1/console/options', { externalURL: 'http://192.168.1.50:8791' }, { [TOKEN_HEADER]: token });
    const before = await (await fetch(base + '/api/v1/console/state', { headers: { [TOKEN_HEADER]: token } })).json();
    assert.equal(before.serviceURL, 'http://192.168.1.50:8791');
    const answer = await post(base, '/api/v1/console/options', { externalURL: '' }, { [TOKEN_HEADER]: token });
    assert.equal(answer.status, 200);
    const after = await (await fetch(base + '/api/v1/console/state', { headers: { [TOKEN_HEADER]: token } })).json();
    assert.equal(after.external.url, '');
    // The tailnet is the way in again.
    assert.equal(after.serviceURL, `http://100.64.0.1:${after.port}`);
    // And the forwarding of the tailnet is built again.
    assert.ok(mock.calls.some((line) => line.includes('--bg')), 'the forwarding was not built');
  }, { tailscaleRunner: mock.runner, forward: true });
});
