import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { startServer } from './lib/server.mjs';
import { removeForwardSync } from './lib/forward.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

let running;
let current;
let directory;

// The service is shut down and the forwarding of the tailnet is taken away.
// This is what the host asks for when the plugin is unloaded, and what the
// host asks for when the settings change.
async function shutdown() {
  const previous = running;
  running = undefined;
  current = undefined;
  if (!previous) return { ok: true, stopped: false };
  const service = await previous.catch(() => null);
  await service?.close?.();
  return { ok: true, stopped: true };
}

// The last way out. When the program ends, the sockets go with it, but the
// forwarding of Tailscale is a setting of Tailscale and would stay behind.
// It is taken away here, and only when it still points where this plugin
// left it: a forwarding of somebody else is never touched.
export function cleanupForward(directory, runner) {
  try {
    if (!directory) return { ok: false, error: '没有数据目录。' };
    const file = path.join(directory, 'token-widget', 'state.json');
    const record = JSON.parse(readFileSync(file, 'utf8'))?.forward;
    if (!record) return { ok: true, skipped: true };
    return removeForwardSync(record.publishedPort, record, runner);
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

function cleanupOnExit() {
  cleanupForward(directory);
}

process.once('exit', cleanupOnExit);

// The host calls this again when the options change, and calls it once when
// the plugin is loaded. The service is restarted whenever the hand-over
// changes, so a new port or a new gateway takes effect.
export default {
  id: 'token-widget',
  async server(input, options) {
    if (!input?.directory) throw new Error('The Magpie plugin host is required.');
    options ||= {};
    directory = input.directory;
    const wanted = JSON.stringify([input.directory, options]);
    if (wanted !== current) {
      const previous = running;
      current = wanted;
      running = (async () => {
        await (await previous?.catch(() => null))?.close();
        return startServer({
          root,
          dataDir: path.join(input.directory, 'token-widget'),
          magpieDir: input.directory,
          options,
        });
      })();
      running.catch(() => {
        if (current === wanted) current = undefined;
      });
    }
    await running;
    return {};
  },
  // A host that asks the plugin to stop gets the service closed and the
  // forwarding of the tailnet taken away. A host that does not ask still
  // ends up in the same state when the program ends.
  async stop() {
    return shutdown();
  },
  async uninstall() {
    return shutdown();
  },
  async close() {
    return shutdown();
  },
};
