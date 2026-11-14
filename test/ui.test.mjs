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

test('the console is a rail and a sheet, and the long lists are folded', async () => {
  const page = await read('ui/index.html');
  const css = await read('ui/style.css');
  // One rail with the code, one sheet with everything else. The row of
  // rounded cards is gone: a machine with a dozen network cards made the
  // page longer than anybody wanted to scroll.
  assert.match(page, /<aside class="rail">/);
  assert.match(page, /<div class="sheet">/);
  assert.doesNotMatch(page, /class="cards"/);
  assert.match(css, /grid-template-columns: 296px minmax\(0, 1fr\)/);
  assert.match(css, /align-items: start/);
  // The rail follows the page when it is long.
  assert.match(css, /\.rail \{\s*position: sticky;/);
  // One column on a narrow window.
  assert.match(css, /@media \(max-width: 880px\)/);
  // The type is smaller than it was.
  assert.match(css, /font: 13px\/1\.55/);
  // The lists that grow with the machine are folded away, and the lid says
  // how many are in there.
  for (const id of ['peersSummary', 'interfacesSummary', 'bindSummary']) {
    assert.match(page, new RegExp(`<summary id="${id}"`));
  }
  const script = await read('ui/app.js');
  assert.match(script, /尾网里的 iPhone（\$\{list\.length\} 台）/);
  assert.match(script, /这台电脑的网卡（\$\{list\.length\} 张）/);
  assert.match(script, /手机可以从这里连（\$\{candidates\.length\} 个地址）/);
});

test('every piece of the page the script reaches for is on the page', async () => {
  const page = await read('ui/index.html');
  const script = await read('ui/app.js');
  // The script looks a piece of the page up by its name and quietly does
  // nothing when it is not there. A rewritten page that drops one name
  // would blank that panel with no test saying so, so every name the
  // script asks for has to be in the page.
  const names = [...script.matchAll(/(?:element|text|fillFacts)\(\s*'([A-Za-z0-9_-]+)'/g)]
    .map((match) => match[1]);
  assert.ok(names.length >= 30, `only ${names.length} names found in the script`);
  // A few names are not in the page because the script writes them itself
  // (the cell of the countdown in the advanced settings). Those are the
  // ones that close an array of a row.
  const written = new Set([...script.matchAll(/'([A-Za-z0-9_-]+)'\s*\]/g)].map((match) => match[1]));
  assert.ok(written.size <= 3, `${written.size} names are written by the script, that is a lot`);
  for (const name of new Set(names)) {
    if (written.has(name)) continue;
    assert.match(page, new RegExp(`id="${name}"`), `the page has no #${name}`);
  }
});

test('the parameter of the subscription sits on the right', async () => {
  const script = await read('ui/app.js');
  const css = await read('ui/style.css');
  // The row is a grid: the name in the middle, the parameter of the small
  // widget at the end.
  assert.match(css, /\.checks label \{[^}]*display: grid;[^}]*grid-template-columns: auto minmax\(0, 1fr\) auto;/);
  assert.match(css, /\.checks \.param \{\s*justify-self: end;/);
  assert.match(script, /hint\.className = 'tag param'/);
});

test('a device can be taken off the list', async () => {
  const page = await read('ui/index.html');
  const script = await read('ui/app.js');
  // The console says why there is a token, and that the phone gets one by
  // itself when it scans the code.
  assert.match(page, /手机自己换到一枚只读的令牌/);
  assert.match(page, /令牌是每台手机一枚/);
  // A row can be deleted, not only revoked.
  assert.match(script, /node\('button', 'danger', '删除'\)/);
  assert.match(script, /action: 'delete'/);
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
