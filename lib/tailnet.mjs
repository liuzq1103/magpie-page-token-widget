import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

// The tailscale command is not always on the PATH of a program that was
// started from a desktop shortcut, so the places it is installed in are tried
// as well.
export function candidates() {
  const list = [];
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const localAppData = process.env.LOCALAPPDATA || '';
  if (programFiles) list.push(path.join(programFiles, 'Tailscale', 'tailscale.exe'));
  if (localAppData) list.push(path.join(localAppData, 'Tailscale', 'tailscale.exe'));
  list.push('tailscale');
  return list;
}

export async function call(args, timeout = 15000) {
  for (const binary of candidates()) {
    try {
      const { stdout } = await run(binary, args, { timeout, windowsHide: true, encoding: 'utf8' });
      return { ok: true, stdout };
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      const message = String(error.stderr || error.message || '').trim();
      return { ok: false, error: message || 'tailscale failed', binary };
    }
  }
  return { ok: false, error: 'Tailscale is not installed on this computer.' };
}

export async function status() {
  const result = await call(['status', '--json']);
  if (!result.ok) return { ok: false, error: result.error };
  try {
    return { ok: true, data: JSON.parse(result.stdout) };
  } catch {
    return { ok: false, error: 'tailscale status did not answer with JSON.' };
  }
}

// The address of this computer inside the tailnet: 100.64.0.0/10.
export function pickIP(data) {
  const self = data?.Self || {};
  const ips = Array.isArray(self.TailscaleIPs) ? self.TailscaleIPs : [];
  return ips.find(ip => /^100\.(6[4-9]|[789]\d|1[01]\d|12[0-7])\./.test(String(ip))) || null;
}

export function iosPeers(data) {
  const peers = Object.values(data?.Peer || {});
  return peers
    .filter(peer => peer?.OS === 'iOS')
    .map(peer => {
      const dns = String(peer.DNSName || '');
      const label = dns.endsWith('.ts.net') ? dns.slice(0, -'.ts.net'.length) : '';
      const host = String(peer.HostName || '');
      // A phone that shares its name with a generic one is known better by
      // the name of its address in the tailnet.
      const generic = /^(localhost|device-of-shared-to-user)$/i.test(host);
      const name = label && (generic || !host) ? label : host || label || 'iPhone';
      return {
        name,
        ips: (peer.TailscaleIPs || []).filter(ip => /^100\./.test(String(ip))),
      };
    });
}

export function dnsName(data) {
  const name = data?.Self?.DNSName;
  return typeof name === 'string' && name.endsWith('.ts.net') ? name : null;
}

export async function detect() {
  const result = await status();
  if (!result.ok) {
    return { installed: false, connected: false, backendState: null, tailnetIP: null, dnsName: null, ios: [], error: result.error };
  }
  const data = result.data;
  return {
    installed: true,
    connected: !data?.BackendState || data.BackendState === 'Running',
    backendState: data?.BackendState || null,
    tailnetIP: pickIP(data),
    dnsName: dnsName(data),
    ios: iosPeers(data),
    error: null,
  };
}
