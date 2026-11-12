import { createServer } from 'node:http';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { Collector } from './collector.mjs';
import { displayOptions } from './normalize.mjs';
import { ensureState, notePairing, rotatePairing, writeState } from './state.mjs';
import { detect } from './tailnet.mjs';
import { applyForward, removeForward } from './forward.mjs';
import { dataUri as qrDataUri } from './qr.mjs';

// The page of the plugin and the page of the phone are both plain documents.
// Nothing is loaded from anywhere else, and no document may frame or submit
// anything.
const SECURITY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const BROWSERS = new Set(['Mozilla/5.0', 'curl', 'node']);

// A request that arrives from this computer is the one of the Magpie window
// or of a tool on it. A request from the tailnet is a phone.
function isLocal(request) {
  const address = String(request.socket?.remoteAddress || '');
  return LOOPBACK.has(address) || address.startsWith('127.');
}

function authorized(request, token) {
  const given = Buffer.from(String(request.headers.authorization || ''));
  const wanted = Buffer.from('Bearer ' + token);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

function send(response, status, type, body, extra = {}) {
  response.writeHead(status, {
    'Content-Type': type,
    'Content-Security-Policy': SECURITY,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
  response.end(body);
}

const json = (response, status, value) =>
  send(response, status, 'application/json; charset=utf-8', JSON.stringify(value));

// The colours of the Magpie window are handed over as a small list of CSS
// variables. Only the names and the values of variables are taken.
function themeVariables(encoded) {
  if (!encoded) return '';
  try {
    const parsed = JSON.parse(Buffer.from(String(encoded), 'base64').toString('utf8'));
    const parts = [];
    for (const [name, value] of Object.entries(parsed || {})) {
      if (!/^--[a-zA-Z0-9_-]{1,60}$/.test(name)) continue;
      if (!/^[\x20-\x7e]{1,160}$/.test(String(value))) continue;
      parts.push(`${name}:${String(value)}`);
    }
    return parts.length ? `:root{${parts.join(';')}}\n` : '';
  } catch {
    return '';
  }
}

async function body(request) {
  const parts = [];
  let size = 0;
  for await (const part of request) {
    size += part.length;
    if (size > 64 * 1024) throw new Error('The request is too large.');
    parts.push(part);
  }
  return Buffer.concat(parts).toString('utf8');
}

export async function startServer({ root, dataDir, magpieDir, options = {} }) {
  const port = Number(options.port ?? 8790);
  const upstream = String(options.gatewayURL || 'http://127.0.0.1:3425');
  const stateFile = path.join(dataDir, 'state.json');
  const snapshotFile = path.join(dataDir, 'snapshot.json');
  const forwardFile = path.join(dataDir, 'forward.json');
  const { state } = await ensureState(stateFile);

  // The phone reaches this computer through a forwarding of Tailscale. The
  // forwarding is made here and taken away again when the plugin stops.
  let forward = { port: null, owned: false };
  let forwardError = '';

  const display = displayOptions({ ...(state.settings || {}), ...(options.settings || {}) });
  const collector = new Collector({ upstream, magpieDir, snapshotFile, display });
  await collector.load();
  void collector.refresh();

  let tailnet = await detect();
  const servers = [];
  const listening = new Set();
  const failures = new Map();
  const pages = new Map();

  const read = async (name) => {
    if (!pages.has(name)) {
      const file = path.join(root, 'page', name);
      pages.set(name, await readFile(file, 'utf8'));
    }
    return pages.get(name);
  };

  const serviceURL = () =>
    tailnet.tailnetIP ? `http://${tailnet.tailnetIP}:${port}` : '';

  const pairingURL = () => {
    const base = serviceURL();
    return base ? `${base}/p/${state.pairing.code}` : '';
  };

  const consoleState = () => ({
    plugin: 'magpie-page-token-widget',
    port,
    upstream,
    serviceURL: serviceURL(),
    pairingURL: pairingURL(),
    pairingCode: state.pairing.code,
    token: state.token,
    qr: pairingURL() ? qrDataUri(pairingURL()) : '',
    tailnet: {
      installed: tailnet.installed,
      connected: tailnet.connected,
      backendState: tailnet.backendState,
      tailnetIP: tailnet.tailnetIP,
      dnsName: tailnet.dnsName,
      ios: tailnet.ios,
      error: tailnet.error,
    },
    paired: state.paired || [],
    forward: { ready: forward.owned, port: forward.port, error: forwardError },
    display: collector.display,
  });

  const listen = async (host) => {
    if (listening.has(host)) return;
    const server = createServer(handle);
    server.on('error', error => {
      listening.delete(host);
      console.warn(`[token-widget] ${host}: ${error.message}`);
    });
    await new Promise(resolve => {
      server.once('error', resolve);
      server.listen(port, host, () => {
        listening.add(host);
        resolve();
      });
    });
    servers.push(server);
  };

  // A forwarding of Tailscale brings the port of this service into the
  // tailnet, where the phone can reach it. A forwarding of another service on
  // the same port is never touched.
  const syncForward = async () => {
    if (options.forward === false) return;
    if (!tailnet.tailnetIP) {
      if (forward.owned) {
        await removeForward(forward.port);
        forward = { port: null, owned: false };
        await rm(forwardFile, { force: true }).catch(() => {});
      }
      return;
    }
    if (forward.port === port) return;
    if (forward.owned) await removeForward(forward.port);
    const result = await applyForward(port);
    if (!result.ok) {
      forwardError = result.error;
      forward = { port: null, owned: false };
      return;
    }
    forwardError = '';
    forward = { port, owned: true };
    await writeFile(
      forwardFile,
      JSON.stringify({ port, target: '127.0.0.1:' + port, at: new Date().toISOString() }) + '\n',
    );
  };

  const widget = async () => {
    const source = await readFile(path.join(root, 'scriptable', 'UsageWidget.js'), 'utf8');
    return source;
  };

  const handle = async (request, response) => {
    try {
      await route(request, response);
    } catch (error) {
      json(response, 500, { error: String(error?.message || error) });
    }
  };

  const route = async (request, response) => {
    const url = new URL(request.url || '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    // Magpie puts the service behind a path of its own. The prefix is removed
    // here, so the service answers the same way with and without it.
    const prefixed = pathname.match(/^\/_magpie\/service\/[^/]+(\/.*)?$/);
    if (prefixed) pathname = prefixed[1] || '/';
    const method = request.method || 'GET';

    if (pathname === '/health') {
      return json(response, 200, {
        ok: true,
        service: 'magpie-page-token-widget',
        tailnetIP: tailnet.tailnetIP,
        connected: tailnet.connected,
      });
    }

    if (pathname === '/api/v1/overview') {
      if (!authorized(request, state.token)) return json(response, 401, { error: 'The token is not valid.' });
      return json(response, 200, collector.overview());
    }

    // The phone exchanges the one-time code of the pairing for the token of
    // the service. The code is used once and is then worthless.
    if (pathname === '/api/v1/session' && method === 'POST') {
      const address = request.socket?.remoteAddress || '';
      const failed = failures.get(address) || { count: 0, until: 0 };
      if (failed.until > Date.now()) return json(response, 429, { error: 'Too many tries. Try again later.' });
      let code = '';
      try { code = String(JSON.parse(await body(request)).code || ''); } catch { /* An empty body is a failed try. */ }
      if (!code || code !== state.pairing.code) {
        failed.count += 1;
        if (failed.count >= 10) { failed.until = Date.now() + 5 * 60_000; failed.count = 0; }
        failures.set(address, failed);
        return json(response, 403, { error: 'The pairing code is not valid or has expired.' });
      }
      failures.delete(address);
      rotatePairing(state);
      notePairing(state, address);
      await writeState(stateFile, state);
      return json(response, 200, { token: state.token, baseURL: serviceURL() });
    }

    // Everything below belongs to the window of the plugin on this computer.
    if (pathname.startsWith('/api/v1/console/')) {
      if (!isLocal(request)) return json(response, 403, { error: 'This page is only opened on the computer of the service.' });
      if (pathname === '/api/v1/console/state' && method === 'GET') {
        return json(response, 200, consoleState());
      }
      if (pathname === '/api/v1/console/pair' && method === 'POST') {
        rotatePairing(state);
        await writeState(stateFile, state);
        return json(response, 200, consoleState());
      }
      if (pathname === '/api/v1/console/options' && method === 'POST') {
        let sent = {};
        try { sent = JSON.parse(await body(request)); } catch { /* Nothing to change. */ }
        const next = displayOptions({ ...collector.display, ...sent });
        collector.display = next;
        state.settings = { ...(state.settings || {}), ...next };
        await writeState(stateFile, state);
        void collector.refresh();
        return json(response, 200, { display: next });
      }
      return json(response, 404, { error: 'Unknown console action.' });
    }

    // The phone opens this page after it has read the code.
    if (pathname.startsWith('/p/')) {
      const code = pathname.slice(3);
      const html = await read('pair.html');
      if (code !== state.pairing.code) {
        return send(response, 200, 'text/html; charset=utf-8',
          html.replace('<!--CONTENT-->', '<div class="card"><h1>这个配对码已经失效</h1><p>回到电脑上的 Magpie 插件页，重新生成配对码再扫码。</p></div>'));
      }
      const base = serviceURL();
      const body_ = `<div class="card">
        <h1>安装额度组件</h1>
        <p class="lead">${base}</p>
        <ol>
          <li>点击下面的按钮，把组件脚本下载到这台 iPhone。</li>
          <li>在"文件"App 里打开刚下载的 <code>UsageWidget.js</code>，选择"共享 → 用 Scriptable 打开"。</li>
          <li>回到桌面，长按空白处添加 Scriptable 小组件，选择 <code>UsageWidget</code>。</li>
        </ol>
        <a class="button" href="/scriptable/UsageWidget.js?code=${encodeURIComponent(code)}" download="UsageWidget.js">下载组件脚本</a>
        <p class="note">脚本里没有你的密钥：它只带一个一次性配对码，第一次运行时换成自己的令牌。</p>
      </div>`;
      return send(response, 200, 'text/html; charset=utf-8', html.replace('<!--CONTENT-->', body_));
    }

    if (pathname === '/scriptable/UsageWidget.js') {
      const code = url.searchParams.get('code') || '';
      if (code !== state.pairing.code) return send(response, 403, 'text/plain; charset=utf-8', 'This pairing code is not valid or has expired.');
      const source = await widget();
      const paired = `let PAIRED = ${JSON.stringify({ baseURL: serviceURL(), code })};`;
      const injected = source.replace('let PAIRED = null;', paired);
      return send(response, 200, 'text/javascript; charset=utf-8', injected, {
        'Content-Disposition': 'attachment; filename="UsageWidget.js"',
      });
    }

    if (pathname === '/scriptable/SetupUsageWidget.js') {
      const source = await readFile(path.join(root, 'scriptable', 'SetupUsageWidget.js'), 'utf8');
      return send(response, 200, 'text/javascript; charset=utf-8', source);
    }

    if (pathname === '/console.html' || pathname === '/') {
      if (!isLocal(request)) {
        const html = await read('pair.html');
        return send(response, 200, 'text/html; charset=utf-8',
          html.replace('<!--CONTENT-->', '<div class="card"><h1>这一页在电脑上打开</h1><p>请在运行 Magpie 的电脑上打开插件页。手机只需要扫一次码。</p></div>'));
      }
      const html = await read('console.html');
      // The colours of the window travel in the query of the page, and the
      // style sheet is asked for on its own, so the link carries them along.
      const tokens = url.searchParams.get('tokens');
      const page = tokens
        ? html.replace('href="console.css"', `href="console.css?tokens=${encodeURIComponent(tokens)}"`)
        : html;
      return send(response, 200, 'text/html; charset=utf-8', page);
    }

    if (pathname === '/console.css') {
      const css = await read('console.css');
      return send(response, 200, 'text/css; charset=utf-8', themeVariables(url.searchParams.get('tokens')) + css);
    }

    if (pathname === '/pair.css') {
      const css = await read('pair.css');
      return send(response, 200, 'text/css; charset=utf-8', css);
    }

    if (pathname === '/console.js') {
      const js = await read('console.js');
      return send(response, 200, 'text/javascript; charset=utf-8', js);
    }

    if (pathname === '/console-state.js') {
      if (!isLocal(request)) return json(response, 403, { error: 'This file is only served on the computer of the service.' });
      const state = consoleState();
      return send(response, 200, 'text/javascript; charset=utf-8', `window.__WIDGET_STATE__ = ${JSON.stringify(state)};`);
    }

    if (pathname === '/icon.svg') {
      const svg = await read('icon.svg');
      return send(response, 200, 'image/svg+xml', svg);
    }

    return json(response, 404, { error: 'Not found.' });
  };

  // The service answers on this computer, and the phone reaches it through a
  // forwarding of Tailscale. When no forwarding can be made, the address of
  // the tailnet is tried directly.
  await listen('127.0.0.1');
  await syncForward();
  if (!forward.owned && options.listenTailnet !== false && tailnet.tailnetIP) {
    await listen(tailnet.tailnetIP);
  }

  const timers = [
    setInterval(() => { void collector.refresh(); }, 60_000),
    setInterval(async () => {
      const found = await detect();
      const changed =
        found.tailnetIP !== tailnet.tailnetIP || found.connected !== tailnet.connected;
      tailnet = found;
      if (changed) {
        await syncForward();
        if (!forward.owned && options.listenTailnet !== false && tailnet.tailnetIP) {
          await listen(tailnet.tailnetIP);
        }
      }
    }, 60_000),
  ];

  return {
    port,
    async close() {
      for (const timer of timers) clearInterval(timer);
      if (forward.owned) {
        await removeForward(forward.port);
        forward = { port: null, owned: false };
        await rm(forwardFile, { force: true }).catch(() => {});
      }
      await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    },
  };
}
