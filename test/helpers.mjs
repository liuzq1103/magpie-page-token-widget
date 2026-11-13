// The helpers of the tests. Nothing here touches the real Tailscale of this
// computer and nothing here reaches the real Magpie gateway: the tests speak
// with a mock of the command of Tailscale and with a gateway of their own.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';

export const ask = (origin, route, headers = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request(origin + route, { headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });

export const tempDir = async () => mkdtemp(path.join(tmpdir(), 'token-widget-'));

// A port of its own for every test, so the files of the tests can run at the
// same time without fighting over the same number.
export const freePort = async () => {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
};

export const cleanup = async (dir) => {
  if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
};

export const readJSON = async (file) => JSON.parse(await (await import('node:fs/promises')).readFile(file, 'utf8'));

// A Magpie gateway of the tests. Every request is written down, so a test can
// count how many times the service asked for something.
export async function startGateway(routes = {}) {
  const calls = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const key = url.pathname + url.search;
    calls.push(key);
    let handler = routes[key];
    if (!handler) {
      const bare = url.pathname;
      handler = routes[bare];
    }
    if (!handler) handler = routes['*'];
    if (!handler) {
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    const answer = typeof handler === 'function' ? await handler() : handler;
    if (answer === 'hang') return; // the answer never comes
    if (answer === 'broken') {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'broken' }));
      return;
    }
    if (answer === 'garbage') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('this is not json');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(answer));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// A mock of the command of Tailscale. The published ports live in it, so a
// test can see what the plugin did to the forwarding.
export function mockTailscale({ status = {}, ping = 'pong from 100.64.0.1:41641' } = {}) {
  const calls = [];
  // The shape of the real answer of "tailscale serve status --json".
  const serve = { TCP: {} };
  const runner = async (args) => {
    const line = args.join(' ');
    calls.push(line);
    if (args[0] === 'status') {
      return { ok: true, stdout: JSON.stringify(status) };
    }
    if (args[0] === 'serve') {
      if (args[1] === 'status') {
        return { ok: true, stdout: JSON.stringify(serve) };
      }
      const flag = args.find((arg) => arg.startsWith('--tcp='));
      const published = flag ? Number(flag.split('=')[1]) : 0;
      if (args.includes('off')) {
        delete serve.TCP[String(published)];
        return { ok: true, stdout: '' };
      }
      const target = String(args[args.length - 1] || '').replace('tcp://', '');
      serve.TCP[String(published)] = { TCPForward: target };
      return { ok: true, stdout: '' };
    }
    if (args[0] === 'ping') {
      return { ok: true, stdout: ping };
    }
    return { ok: false, error: `unknown command: ${line}` };
  };
  return { runner, calls, serve };
}

// The status that Tailscale answers with on this computer.
export const tailscaleStatus = {
  Version: '1.104.6',
  BackendState: 'Running',
  Self: {
    HostName: 'liuzqPC',
    DNSName: 'testnode.tail1234.ts.net.',
    OS: 'windows',
    TailscaleIPs: ['100.64.0.1', 'fd7a:115c:a1e0::1'],
    Relay: 'hkg',
    CurAddr: '',
    Online: true,
  },
  Peer: {
    p1: {
      HostName: 'iphone',
      DNSName: 'iphone.tail1234.ts.net.',
      OS: 'iOS',
      Online: true,
      Active: true,
      Relay: '',
      CurAddr: '192.168.123.44:41641',
      TailscaleIPs: ['100.83.33.90'],
    },
  },
};
