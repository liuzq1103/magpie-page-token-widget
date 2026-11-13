# magpie-page-token-widget

> English · [中文](README.md)

An iPhone home screen widget for Magpie, brought in as a plugin: install the plugin, scan a code, and the widget shows the remaining quota and the real token usage of Codex, MiniMax and GLM.

Installing it needs no install script, no Node.js, no scheduled task and no Tailscale port forwarding. The plugin runs the service itself, finds the tailnet address itself, and the phone pairs by scanning a code once.

## Requirements

- Magpie on the desktop (the plugin host is Bun).
- Tailscale, with the computer and the iPhone in the same tailnet.
- [Scriptable](https://scriptable.app/) on the iPhone.

## Install

```bash
magpie plugin add magpie-page-token-widget
```

From a checkout: `magpie plugin add ./magpie-page-token-widget`.

## Pair

1. Open the plugin page in Magpie.
2. The page shows the state of Tailscale. When the computer and the iPhone share a tailnet it shows the tailnet address and a code to scan.
3. Scan the code with the camera of the iPhone, open the page in Safari and download the widget script.
4. Open the downloaded `UsageWidget.js` in the Files app and choose "Share → Open with Scriptable".
5. Long press the home screen, add the Scriptable widget and pick `UsageWidget`.

The pairing code works once and lives ten minutes at most: after that it is dead, and a new one replaces it at once. **Every phone that pairs gets a read-only token of its own.** The service keeps only the hash of that token; the plain text is handed over exactly once, at the moment of pairing, and never again. Revoking one phone stops that phone alone.

There is no shared token any more. The one token that 0.1 gave to every phone is gone the moment the service is updated, so a phone that still holds it has to pair once more and get a token of its own.

Guessing a code is not cheap: ten wrong tries at one code lock that code for five minutes. The lock follows the code, not the machine — behind the Tailscale forward every phone arrives as the loopback of this computer, so a lock per address would let anybody on the tailnet shut the pairing of everybody else. An `X-Forwarded-For` header can be written by anybody, so it is not believed.

The service keeps one budget for the whole of it: a hundred wrong tries in five minutes, whichever code they were aimed at, and the pairing page, the widget script and the pairing door all close until the five minutes are up. Asking for a new pairing code at the computer empties that budget at once, so a person can open the door again without waiting. What really makes a code hard to guess is neither of those two doors: it has ninety-six bits of randomness, it lives ten minutes and it opens the door once.

The script keeps the token in the keychain of Scriptable, and the three widgets of one iPhone share it.

Without the code you can also use "Device management": give a phone a token of its own and put it, with the service address, into `scriptable/SetupUsageWidget.js`.

## Device management

The list holds every device that was paired: its name, when it was paired, when it was last seen and when it was revoked. Every entry can be renamed and revoked on its own. To add a phone, press "give this phone a token" and put the token that appears once into the phone.

## Data update

The service does not read Magpie for every request of the phone. It keeps a snapshot that is good for a minute: a fresh snapshot is given right away, an old one triggers a reading, and all the requests that come at that moment share that one reading.

A reader waits at most a few seconds: it gets the new numbers when they arrive, and the old ones marked as old when they do not, while the reading continues in the background.

How often the service reads on its own:

| Strategy | What it does |
|---|---|
| Smart (the default) | every minute while somebody is looking, every five minutes after ten quiet minutes, and almost never after half an hour of quiet |
| Every minute | a fixed rhythm |
| Every two minutes | a fixed rhythm |
| Every five minutes | a fixed rhythm |

Changing it in the plugin page takes effect at once; Magpie does not have to be restarted.

## Network

The page shows whether Tailscale is installed and connected, the address of this computer in the tailnet, the MagicDNS name, the iPhones of the tailnet and the way the connection is made. Three ways are told apart:

- **Direct**: Tailscale talks to the phone itself, encrypted end to end; on one LAN it usually finds the other side on its own, and that is the fastest way.
- **Peer relay**: there is no direct path, so another device of the tailnet carries the traffic.
- **DERP**: Tailscale's own relay server carries the traffic; the slowest way, but it always works.

When the way cannot be read, the page says so instead of guessing. The button "diagnose" pings the phone once and writes down the answer; the service never pings on its own.

The network cards of this computer are listed as well: name, IPv4, IPv6, the length of the network part, and whether the card is Tailscale, Wi-Fi, wired or virtual. **These addresses are for the computer only; the phone API never gets them.** They are there to help: when the phone cannot be reached, look at the address of this computer in the LAN and at the address of the tailnet.

**Tailscale stays the default way in.** The phone does not go around the tailnet just because this computer has a 192.168.x.x: a direct way over the LAN would have to deal with plain HTTP (or with HTTPS of its own), with addresses that move when the router hands out new ones, and with the local network permission of iOS. That is a new hole to look after, and the tailnet address is stable on both sides. The direct way over the LAN is not implemented in this release; only the addresses are discovered.

## The page on the phone

Tapping the widget opens the usage page on the phone: the remaining quota of every subscription, today's tokens, the last seven days and the rankings by model, vendor and client, the same numbers the computer shows.

The page opens with the read-only token of the widget. The token travels in the `#token=` part of the address and is wiped from there as soon as the page is open; Scriptable keeps it from then on. The page is served on the tailnet side only, the console of the computer stays on this computer.

## Widget parameter

| Size | Shows | Widget Parameter |
|---|---|---|
| Small | one quota, the reset countdown, today's tokens | `codex` (default), `minimax`, `glm`; one account is written `codex@<account>`; `\|used` shows what is used |
| Medium | up to 6 per page; today's tokens | empty; `page=2` for the second page |
| Large | up to 6 per page; two columns with the quota, the reset and the second window; today's and the last seven days | empty; `page=2` for the second page |

## Lifetime

The service runs as long as Magpie runs. With Magpie closed, the phone keeps the last result it received.

## Port

The service listens on 8790 by default, the phone side on 8791. Pick another one when the port is taken:

```bash
magpie plugin options magpie-page-token-widget '{"port":8890}'
```

Restart Magpie afterwards. The plugin publishes the port in the tailnet with a forwarding of Tailscale (`tailscale serve --tcp`), so the phone reaches it on the 100.x address. A forwarding of another service on that port is never touched.

The forwarding points at the phone side of the service (by default one port above the service port, so 8791), while the console stays on 127.0.0.1:8790. A request that comes in through the tailnet lands on that phone port and is never taken for a request of this computer, so the phone cannot read the console or the token.

The plugin writes down the forwarding it made (the port and where it points) in its own file. After a restart it recognizes it and does not make it twice; a forwarding of an older version is moved to the phone side; the forwarding of somebody else is neither touched nor removed. It is taken away only when the plugin is uninstalled properly and the forwarding still points where it was written down.

`tailscale serve --bg --tcp=8790` is a standing setting of Tailscale: it stays there when the plugin is removed or crashes. `tailscale serve status` shows what is published right now.

## Compatibility

- Magpie `0.1.3681` or later is needed (`package.json` says so).
- The quota is read from the report Magpie has already cached (`/v1/magpie/quotas?kept=1`); the vendors are not asked again.
- Today's tokens come from one request to `/v1/magpie/usage?period=today`, which holds the totals, the hours, the vendors and the accounts. **When an older Magpie does not know that endpoint, the old way is used instead** (`/v1/magpie/usage/requests?period=today` plus one request per account) and the widget keeps its numbers.
- The trend of the last seven days and the rankings by model and vendor come from `/v1/magpie/usage/requests?period=7d&limit=1`: this is the only endpoint that carries the groups `by.model` and `by.agent`, and another endpoint would lose the rankings and the trend, so it stays.
- Magpie does not know the period `week` (it is taken for 30 days); seven days is `7d`.

## Uninstall

```bash
magpie plugin rm magpie-page-token-widget
```

The forwarding of the plugin is taken away with it.

## Privacy

- The service only reads the local API of Magpie (`127.0.0.1:3425`). It does not write the configuration of Magpie and does not touch the logins.
- The tokens are random, read only and stay in the directory of Magpie; the service keeps only their hashes. There is no shared token: one token per phone, and revoking one stops that phone alone. Only the plugin page of this computer and the phone that carries a pairing code can get one.
- The addresses of the LAN are only shown in the console of the computer; the phone API does not have them.
- The service listens on this computer only (127.0.0.1); the phone comes in through the forwarding of Tailscale. There is no public entrance and no firewall rule is needed.

## Development

```bash
npm test
```

The tests never touch the real Tailscale: everything that speaks with the command of Tailscale talks to a fake one instead (`mockTailscale` in `test/helpers.mjs`), and the real `tailscale serve` settings are never changed. The gateway of Magpie is one the tests start themselves.

`lib/collector.mjs` and `lib/normalize.mjs` come from [ScriptableTokenWidgets](https://github.com/liuzq1103/ScriptableTokenWidgets), `lib/vendor/qrcode-generator.cjs` is [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator). See [NOTICE](NOTICE).
