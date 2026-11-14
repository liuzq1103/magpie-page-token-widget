import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pairingLeft, remainingText } from '../ui/timing.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The line endings of the checkout are not the same on every computer: a
// page read on Windows ends its lines with CRLF. The tests look at the
// lines, so they all read the same line endings.
const read = async (file) => (await readFile(path.join(root, file), 'utf8')).replace(/\r\n/g, '\n');

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
  // A plain ".row button" would also shrink the buttons in .actions.
  assert.doesNotMatch(css, /\.row button \{/);
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

test('the way back to the tailnet is on the page', async () => {
  const page = await read('ui/index.html');
  const script = await read('ui/app.js');
  // A button that puts the tailnet back, and it has to say what it does.
  assert.match(page, /id="restoreTailscale"/);
  assert.match(page, /恢复 Tailscale 默认连接/);
  assert.match(page, /id="restoreNote"/);
  // The button has to ask the service, not only change the page.
  assert.match(script, /restoreTailscale/);
  assert.match(script, /api\/v1\/console\/network\/reset/);
  // And it has to tell the user how it went.
  assert.match(script, /restoreNote/);
});

test('the phone page does not ask for a tailnet of its own', async () => {
  const page = await read('mobile/index.html');
  const installer = await read('scriptable/SetupUsageWidget.js');
  // The address of the user may be a tailnet address, a home address or his
  // own https name: none of them needs the sentence "keep Tailscale on".
  assert.doesNotMatch(page, /保持 Tailscale 已连接/);
  assert.doesNotMatch(installer, /先连接 Tailscale/);
  assert.match(installer, /确保 iPhone 能访问你填写的服务地址/);
});
