import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, TOKEN_HEADER } from '../lib/server.mjs';
import { noteAccess } from '../lib/state.mjs';
import { cleanup, freePort, mockTailscale, tempDir } from './helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const start = async (dir, options = {}) =>
  startServer({
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

const post = (base, route, value, headers = {}) =>
  fetch(base + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(value || {}),
  });

// The console of the computer opens a moment after the service starts.
const waitForConsole = async (base, consoleToken) => {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const response = await fetch(base + '/api/v1/console/state', {
      headers: { [TOKEN_HEADER]: consoleToken },
    });
    if (response.status !== 503) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('the console of the service never opened');
};

const consoleTokenOf = async (dir) =>
  JSON.parse(await readFile(path.join(dir, 'state.json'), 'utf8')).consoleToken;

let dir;
let service;
let base;

before(async () => {
  dir = await tempDir();
  service = await start(dir);
  base = `http://127.0.0.1:${service.port}`;
  await waitForConsole(base, await consoleTokenOf(dir));
});

after(async () => {
  await service?.close();
  await cleanup(dir);
});

test('a pairing code that is too old does not open the door', async () => {
  const file = path.join(dir, 'state.json');
  const state = JSON.parse(await readFile(file, 'utf8'));
  // The code was handed out ten minutes ago and is past its time.
  state.pairing.expiresAt = new Date(Date.now() - 60_000).toISOString();
  await writeFile(file, JSON.stringify(state));
  await service.close();
  service = await start(dir);
  base = `http://127.0.0.1:${service.port}`;
  await waitForConsole(base, state.consoleToken);

  const answer = await post(base, '/api/v1/session', { code: state.pairing.code });
  assert.equal(answer.status, 403);
  // The page of the phone says the same thing.
  const page = await fetch(base + '/p/' + state.pairing.code);
  assert.equal(page.status, 410);
});

test('a code that was rotated does not open the door any more', async () => {
  const file = path.join(dir, 'state.json');
  const state = JSON.parse(await readFile(file, 'utf8'));
  const old = state.pairing.code;
  const consoleToken = state.consoleToken;
  const rotated = await post(base, '/api/v1/console/pair', {}, { [TOKEN_HEADER]: consoleToken });
  assert.equal(rotated.status, 200);
  const answer = await post(base, '/api/v1/session', { code: old });
  assert.equal(answer.status, 403);
});

test('ten wrong tries at one code shut that code for a while', async () => {
  // A service of its own, so that the door of the other tests stays open.
  const otherDir = await tempDir();
  const other = await start(otherDir);
  const otherBase = `http://127.0.0.1:${other.port}`;
  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const wrong = await post(otherBase, '/api/v1/session', { code: 'wrong' });
      assert.equal(wrong.status, 403);
    }
    const locked = await post(otherBase, '/api/v1/session', { code: 'wrong' });
    assert.equal(locked.status, 429);
  } finally {
    await other.close();
    await cleanup(otherDir);
  }
});

test('a wrong try does not shut the pairing of the other phones', async () => {
  // Behind the forwarding of Tailscale every phone of the tailnet arrives as
  // the loopback of this computer, so they all share one address. The lock
  // follows the code, not the address: a peer that guesses wrong can only
  // lock the code it guessed wrong at.
  const otherDir = await tempDir();
  const other = await start(otherDir);
  const otherBase = `http://127.0.0.1:${other.port}`;
  try {
    const state = JSON.parse(await readFile(path.join(otherDir, 'state.json'), 'utf8'));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const wrong = await post(otherBase, '/api/v1/session', { code: 'wrong-' + attempt });
      assert.equal(wrong.status, 403);
    }
    // The phone that has the real code still gets in.
    const good = await post(otherBase, '/api/v1/session', { code: state.pairing.code, name: 'iPhone' });
    assert.equal(good.status, 200);
    const body = await good.json();
    assert.equal(typeof body.token, 'string');
  } finally {
    await other.close();
    await cleanup(otherDir);
  }
});

test('two phones get two tokens of their own', async () => {
  const file = path.join(dir, 'state.json');
  const state = JSON.parse(await readFile(file, 'utf8'));
  const consoleToken = state.consoleToken;
  await waitForConsole(base, consoleToken);

  // The code of the last test is too old, so a new one is handed out.
  await post(base, '/api/v1/console/pair', {}, { [TOKEN_HEADER]: consoleToken });
  const fresh = JSON.parse(await readFile(file, 'utf8'));

  const first = await post(base, '/api/v1/session', { code: fresh.pairing.code, name: 'iPhone A' });
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.device.name, 'iPhone A');

  await post(base, '/api/v1/console/pair', {}, { [TOKEN_HEADER]: consoleToken });
  const again = JSON.parse(await readFile(file, 'utf8'));
  const second = await post(base, '/api/v1/session', { code: again.pairing.code, name: 'iPhone B' });
  assert.equal(second.status, 200);
  const secondBody = await second.json();

  assert.notEqual(firstBody.token, secondBody.token);
  assert.notEqual(firstBody.token, again.token);

  // Behind the forwarding of Tailscale every phone of the tailnet arrives as
  // the loopback of this computer, so the address in the history cannot tell
  // the phones apart. The name of the device can.
  const history = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(history.paired[0].name, 'iPhone B');
  assert.equal(history.paired[1].name, 'iPhone A');

  // Both phones read the numbers.
  for (const token of [firstBody.token, secondBody.token]) {
    const answer = await fetch(base + '/api/v1/overview', {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.equal(answer.status, 200);
  }

  // One phone is revoked. The other one keeps working.
  const revoked = await post(
    base,
    '/api/v1/console/device',
    { id: firstBody.device.id, action: 'revoke' },
    { [TOKEN_HEADER]: consoleToken }
  );
  assert.equal(revoked.status, 200);
  const after = await fetch(base + '/api/v1/overview', {
    headers: { Authorization: 'Bearer ' + firstBody.token },
  });
  assert.equal(after.status, 401);
  const untouched = await fetch(base + '/api/v1/overview', {
    headers: { Authorization: 'Bearer ' + secondBody.token },
  });
  assert.equal(untouched.status, 200);

  // The list of the devices says who is gone.
  const list = await fetch(base + '/api/v1/console/state', {
    headers: { [TOKEN_HEADER]: consoleToken },
  });
  const body = await list.json();
  const gone = body.devices.find((device) => device.id === firstBody.device.id);
  assert.ok(gone.revokedAt);
  assert.doesNotMatch(JSON.stringify(body.devices), /"hash"/);
});

test('the service starts again and the devices are still there', async () => {
  const file = path.join(dir, 'state.json');
  const before = JSON.parse(await readFile(file, 'utf8'));
  await service.close();
  service = await start(dir);
  base = `http://127.0.0.1:${service.port}`;
  await waitForConsole(base, before.consoleToken);
  const after = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(after.devices.length, before.devices.length);
  assert.deepEqual(
    after.devices.map((device) => device.id).sort(),
    before.devices.map((device) => device.id).sort()
  );
});

test('the phones of the old version keep working after the change', async () => {
  // A state file of the old version: a shared token, a pairing code and the
  // record of the phones that were paired before.
  const oldDir = await tempDir();
  const legacyToken = 'legacy-shared-token-'.padEnd(43, 'x');
  await writeFile(
    path.join(oldDir, 'state.json'),
    JSON.stringify({
      version: 1,
      token: legacyToken,
      pairing: { code: 'old-code', createdAt: new Date().toISOString() },
      settings: { subscriptions: ['codex'] },
      paired: [{ at: new Date().toISOString(), address: '100.64.0.9' }],
    })
  );
  const old = await start(oldDir);
  const oldBase = `http://127.0.0.1:${old.port}`;
  try {
    // The old token still opens the door of the phone.
    const answer = await fetch(oldBase + '/api/v1/overview', {
      headers: { Authorization: 'Bearer ' + legacyToken },
    });
    assert.equal(answer.status, 200);

    const oldConsole = JSON.parse(await readFile(path.join(oldDir, 'state.json'), 'utf8')).consoleToken;
    await waitForConsole(oldBase, oldConsole);
    const body = await (await fetch(oldBase + '/api/v1/console/state', {
      headers: { [TOKEN_HEADER]: oldConsole },
    })).json();
    // The shared token became the token of one old device, and it is still
    // there.
    const legacy = body.devices.find((device) => device.legacy);
    assert.ok(legacy);
    assert.equal(legacy.revokedAt, null);

    // A new phone gets a token of its own.
    const fresh = JSON.parse(await readFile(path.join(oldDir, 'state.json'), 'utf8'));
    const paired = await post(oldBase, '/api/v1/session', { code: fresh.pairing.code, name: 'new phone' });
    assert.equal(paired.status, 200);
    const pairedBody = await paired.json();
    assert.notEqual(pairedBody.token, legacyToken);
    const allowed = await fetch(oldBase + '/api/v1/overview', {
      headers: { Authorization: 'Bearer ' + pairedBody.token },
    });
    assert.equal(allowed.status, 200);

    // Only when the old device is revoked do the old phones stop working.
    const consoleToken = JSON.parse(await readFile(path.join(oldDir, 'state.json'), 'utf8')).consoleToken;
    const revoked = await post(
      oldBase,
      '/api/v1/console/device',
      { id: legacy.id, action: 'revoke' },
      { [TOKEN_HEADER]: consoleToken }
    );
    assert.equal(revoked.status, 200);
    const gone = await fetch(oldBase + '/api/v1/overview', {
      headers: { Authorization: 'Bearer ' + legacyToken },
    });
    assert.equal(gone.status, 401);
    // The new phone is not touched by it.
    const stillThere = await fetch(oldBase + '/api/v1/overview', {
      headers: { Authorization: 'Bearer ' + pairedBody.token },
    });
    assert.equal(stillThere.status, 200);
  } finally {
    await old.close();
    await cleanup(oldDir);
  }
});

test('the console and the phone put foreign words into the page as text', async () => {
  // There is no innerHTML left in the pages: everything that comes from
  // outside goes into the page as text.
  for (const file of ['ui/app.js', 'mobile/app.js', 'page/boot.js']) {
    const source = await readFile(path.join(root, file), 'utf8');
    for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write']) {
      assert.equal(source.includes(sink), false, `${file} must not use ${sink}`);
    }
  }
  // The console builds its rows with the API of the page.
  const app = await readFile(path.join(root, 'ui/app.js'), 'utf8');
  assert.match(app, /textContent/);
  assert.match(app, /createElement/);
});

test('the console and the service use the same header for the token', async () => {
  // A different letter in the name of the header would close the console
  // without the tests noticing, so the name is compared here.
  const app = await readFile(path.join(root, 'ui/app.js'), 'utf8');
  assert.ok(
    app.includes(TOKEN_HEADER),
    'ui/app.js must send the same token header as lib/server.mjs expects',
  );
});

test('the address in the header of the request is not believed', async () => {
  // A service of its own, so that the door of the other tests stays open.
  const otherDir = await tempDir();
  const other = await start(otherDir);
  const otherBase = `http://127.0.0.1:${other.port}`;
  try {
    // Every try comes with a different address in the header. The address is
    // written by whoever asks, so it must not count as a new computer.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const wrong = await post(otherBase, '/api/v1/session', { code: 'wrong' }, {
        'X-Forwarded-For': `10.0.0.${attempt + 1}`,
      });
      assert.equal(wrong.status, 403);
    }
    const locked = await post(otherBase, '/api/v1/session', { code: 'wrong' }, {
      'X-Forwarded-For': '10.9.9.9',
    });
    assert.equal(locked.status, 429);
  } finally {
    await other.close();
    await cleanup(otherDir);
  }
});

test('the page of the pairing code and the script are shut out as well', async () => {
  // The page of the code says whether a code is good. It is a door as well,
  // so it goes through the same limiter. Every door counts on its own: the
  // script is shut after ten tries, the page after thirty, and the door of
  // the pairing itself is not touched by them.
  const otherDir = await tempDir();
  const other = await start(otherDir);
  const otherBase = `http://127.0.0.1:${other.port}`;
  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await fetch(otherBase + '/scriptable/UsageWidget.js?code=wrong');
    }
    const script = await fetch(otherBase + '/scriptable/UsageWidget.js?code=wrong');
    assert.equal(script.status, 429);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const page = await fetch(otherBase + '/p/wrong');
      assert.equal(page.status, 410);
    }
    const page = await fetch(otherBase + '/p/wrong');
    assert.equal(page.status, 429);
    // The pairing itself is still open.
    const session = await post(otherBase, '/api/v1/session', { code: 'wrong' });
    assert.equal(session.status, 403);
  } finally {
    await other.close();
    await cleanup(otherDir);
  }
});

test('the file of the state belongs to the user of this computer alone', async () => {
  // Windows does not keep the rights of a file, so the check is only of
  // meaning on the other systems.
  if (process.platform === 'win32') return;
  const file = path.join(dir, 'state.json');
  const mode = (await stat(file)).mode & 0o777;
  assert.equal(mode, 0o600);
  const folder = (await stat(dir)).mode & 0o777;
  assert.equal(folder, 0o700);
});

test('the time of the last visit is written at most every five minutes', async () => {
  const device = { lastAccessAt: null };
  const now = Date.now();
  // The first visit is written down.
  assert.equal(noteAccess(device, now), true);
  assert.equal(device.lastAccessAt, new Date(now).toISOString());
  // The next one is not, the file is not written every time.
  assert.equal(noteAccess(device, now + 1000), false);
  assert.equal(device.lastAccessAt, new Date(now).toISOString());
  // After five minutes it is written again.
  assert.equal(noteAccess(device, now + 5 * 60_000), true);
  assert.equal(device.lastAccessAt, new Date(now + 5 * 60_000).toISOString());
});
