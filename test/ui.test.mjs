import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pairingLeft, remainingText } from '../ui/timing.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

test('the time left on a pairing code is counted on the page', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const state = { pairingExpiresAt: new Date(now + 9 * 60 * 1000 + 59 * 1000).toISOString() };
  assert.equal(pairingLeft(state, now), 599);
  assert.equal(remainingText(599), '还剩 9 分 59 秒');
  assert.equal(remainingText(60), '还剩 1 分 0 秒');
  assert.equal(remainingText(59), '还剩 59 秒');
  assert.equal(remainingText(0), '已经作废');
  assert.equal(remainingText(-5), '已经作废');
  // A code without a time is gone already.
  assert.equal(pairingLeft({}, now), 0);
  assert.equal(pairingLeft({ pairingExpiresAt: 'nonsense' }, now), 0);
});

test('the console uses the width of the window', async () => {
  const page = await read('ui/index.html');
  const css = await read('ui/style.css');
  assert.match(page, /<div class="cards">/);
  assert.match(css, /max-width: 1120px/);
  assert.match(css, /grid-template-columns: repeat\(auto-fit, minmax\(300px, 1fr\)\)/);
  assert.match(css, /align-items: start/);
  // Every card is inside the grid, and the grid is closed at the end.
  const cards = page.split('<section class="card">').length - 1;
  assert.equal(cards, 8);
  assert.ok(page.indexOf('<div class="cards">') < page.indexOf('<section class="card">'));
  assert.match(page, /<\/section>\n\s*<\/div>\n\s*<\/main>/);
});

test('the buttons that sit in a row are smaller', async () => {
  const css = await read('ui/style.css');
  // Only the direct children of a row; the ones inside .actions keep their
  // size.
  assert.match(css, /\.row > button \{/);
});

test('the countdown moves while the page is open', async () => {
  const script = await read('ui/app.js');
  assert.match(script, /setInterval\(tickCountdown, 1000\)/);
  assert.match(script, /document\.hidden/);
  assert.match(script, /visibilitychange/);
  assert.match(script, /import \{ pairingLeft, remainingText \} from '\.\/timing\.mjs'/);
  // The note under the code is shared with the copy button and with the
  // errors, so the timer must not write it.
  assert.doesNotMatch(script, /setInterval\([^)]*pairNote/);
  assert.match(script, /text\('pairCountdown'/);
  assert.match(script, /element\('pairRemaining'\)/);
  const page = await read('ui/index.html');
  assert.match(page, /<script type="module" src="app\.js"><\/script>/);
  assert.match(page, /id="pairCountdown"/);
});

test('the gateway is not edited in the console any more', async () => {
  const page = await read('ui/index.html');
  const script = await read('ui/app.js');
  assert.doesNotMatch(page, /id="gateway"/);
  assert.doesNotMatch(page, /id="saveGateway"/);
  assert.doesNotMatch(script, /saveGateway/);
  // The console never sends a gateway of its own; the address comes from the
  // plugin settings of Magpie. The name may still be mentioned in the note.
  assert.doesNotMatch(script, /JSON\.stringify\(\{ gatewayURL/);
  assert.doesNotMatch(script, /gatewayURL: /);
});
