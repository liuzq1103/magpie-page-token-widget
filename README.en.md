# magpie-page-token-widget

> English · [中文](README.md) · version 0.4.9 (see [CHANGELOG.md](CHANGELOG.md))

An iPhone home screen widget for Magpie, brought in as a plugin: install the plugin, scan a code, and the widget shows the remaining quota and the real token usage of Codex, MiniMax and GLM.

Installing it needs no install script, no Node.js and no scheduled task, and you do not have to set up port forwarding yourself: in the default Tailscale mode the plugin runs the service itself and builds the forward in the tailnet itself, and the phone pairs by scanning a code once.

> The numbers come from your own Magpie, and the script holds no key of its own. What the widget shows is still Magpie's own wording.

The plugin page has two columns. The left one holds the scan-to-pair block (the QR code, the pairing address, the countdown, the copy button) and the four steps "On the iPhone". The right one holds the state, the data update, which subscriptions to show, the device management, the network and the advanced settings. On a computer with a dozen network cards the three long lists — "the iPhones in the tailnet", "the network cards of this computer" and "where the phone can connect" — are folded away, and their lids say how many are in there.

## What it does

- The plugin page shows a QR code. Scan it with the camera of the iPhone, let Safari open the pairing page, download the widget script, open it with Scriptable and add the widget to the home screen.
- The widget shows the remaining quota of every subscription, the five-hour and the weekly window in percent, the reset countdown and today's tokens; the last seven days and the rankings by vendor live on the usage page the widget opens. The parameters pick the subscription (`codex`, `minimax`, `glm`, or `codex@<account>`), and can swap the percent for what is used (`\|used`) or back to what is left (`\|remaining`); with no parameter the widget follows the "widget" block of the plugin page.
- The plugin page is in two columns: the QR code, the pairing address and the four steps "on the iPhone" on the left; on the right, and on a wide window in two columns of their own, the **state**, **data update** (how often it reads), **which subscriptions** (the cards the phone shows; **drag them by the dots on the left into another order**, and the phone and the widget follow it) and the **widget** (whether the widget shows what is left or what is used, and which card the small one shows); beside them **device management** (the phones that are paired, each one revoked on its own; a revoked row can be deleted), **network** (the state of the tailnet, the way the connection is made, the network cards of this computer) and **advanced settings** (the port, the gateway, the other things that are rarely changed and only looked at). On a computer with many network cards the three long lists — the network cards, the phones in the tailnet and the addresses the phone may use — are folded away.
- Tap the widget on the phone and Safari opens the usage page of the phone: the remaining quota of every subscription, today's tokens, the last seven days, the rankings by model, vendor and client, the same numbers the computer shows.
- The service only reads the local API of Magpie. In the default mode (listening on this computer plus a Tailscale forward) the service opens on this computer only, the phone comes in through the forward of the tailnet, and the tokens stay in the directory of Magpie.

## Requirements

- Magpie on the desktop (the plugin host is Bun).
- [Scriptable](https://scriptable.app/) on the iPhone.
- Tailscale: **only the default mode needs it.** The computer and the iPhone are in the same tailnet, and the plugin finds the address and builds the forward by itself. With a server of your own or a trusted address inside your own network, Tailscale is no longer needed.

The three ways to connect (the default Tailscale mode, an address of your own, a direct way over the LAN) are in "Three ways to connect" below.

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

The widget script is downloaded once and then lives on the phone; a new version on the server does not travel to it by itself. **After a new version, run the installer (`SetupUsageWidget.js`) again in Scriptable — it remembers the address and the token, and it overwrites the script on the phone with the newest one.**

The pairing code works once and lives ten minutes at most: after that it is dead, and the plugin page makes a new one by itself (there is nothing to click), so the first pairing after the install needs no extra click. The moment it is used, the old code is void. **Every phone that pairs gets a read-only token of its own.** The service keeps only the hash of that token; the plain text is handed over exactly once, at the moment of pairing, and never again. Revoking one phone stops that phone alone.

Why a token at all, when the code was enough to pair? The code is the **door**: it opens once and is dead after ten minutes. The token is the **key** the phone picks up for itself, and it has to keep working. Scriptable cannot hold a cookie, so the phone has to carry a credential that stays valid every time it asks for the numbers; handing one token to each phone is what makes "stop that one" stop that one. Scanning your own code already proves that you are the one at the keyboard, so you never type a token: the phone swaps for one itself while it pairs, and the service keeps nothing but its fingerprint.

There is no shared token any more. The one token that 0.1 gave to every phone is gone the moment the service is updated, so a phone that still holds it has to pair once more and get a token of its own.

A pairing code cannot simply be guessed: ten wrong tries at one code lock that code for five minutes (the pairing page is a wider door — it takes thirty tries to lock). The lock follows the code, not the machine — behind the Tailscale forward every phone arrives as the loopback of this computer, so a lock per address would let anybody on the tailnet shut the pairing of everybody else. An `X-Forwarded-For` header can be written by anybody, so it is not believed.

The service keeps one budget for the whole of it: a hundred wrong tries in five minutes, whichever code they were aimed at, and the pairing page, the widget script and the pairing door all close until the five minutes are up. Asking for a new pairing code at the computer empties that budget at once, so a person can open the door again without waiting. What really makes a code hard to guess is neither of those two doors: it has ninety-six bits of randomness, it lives ten minutes and it opens the door once.

The script keeps the token in the keychain of Scriptable, and all the widgets of one iPhone share it (small, medium and large alike).

Without the code you can also use "Device management": give a phone a token of its own and put it, with the service address, into `scriptable/SetupUsageWidget.js` (make a new script in Scriptable and paste it in). The service address may be a Tailscale address (`http://100.x.x.x:8790`), an address inside your own network (`http://192.168.1.50:8791`), or an HTTPS domain of your own (`https://my-server`). **A plain HTTP address out in the public internet is refused**; the rules are in "Three ways to connect" below.

## Device management

The list holds every device that was paired: its name, when it was paired, when it was last seen and when it was revoked. Every entry can be renamed and revoked on its own. **Revoking makes that token void at once and keeps the row as a record; a revoked row can then be deleted, and then it is gone from the list.** A phone that is still in use cannot be deleted straight away: revoke it first (revoking is the step that stops it), then delete it. The revoked rows sit at the bottom and are printed faint. To add a phone, press "give this phone a token" and put the token that appears once into the phone.

The "pairing log" in the advanced settings is a book on this computer (when, who, from where — no token in it); deleting a device does not wipe that line out.

## Data update

The service does not read Magpie for every request of the phone. It keeps a snapshot that is good for a minute: a fresh snapshot is given right away, an old one triggers a reading, and all the requests that come at that moment share that one reading.

A reader waits at most a few seconds: when the numbers arrive in time they are served fresh; otherwise the old numbers go out marked as old while the reading keeps going in the background.

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
- **DERP**: Tailscale's own relay server carries the traffic; the slowest way, and the last way out. None of the three is a promise that the connection works — DERP is a fallback, not a guarantee.

When the way cannot be read, the page says so instead of guessing. The button "diagnose" pings the phone once and writes down the answer; the service never pings on its own, so it does not keep spawning Tailscale subprocesses.

The network cards of this computer are listed as well: name, IPv4, IPv6, the length of the network part, and whether the card is Tailscale, Wi-Fi, wired or virtual. **These addresses are for the computer only; the phone API never gets them.** They are there to help: when the phone cannot be reached, look at the address of this computer in the LAN and at the address of the tailnet.

**Tailscale stays the default way in.** The phone does not go around the tailnet just because this computer has a 192.168.x.x: a direct way over the LAN would have to deal with plain HTTP (or with HTTPS of its own), with addresses that move when the router hands out new ones, and with the local network permission of iOS. That is a new hole to look after, and the tailnet address is stable on both sides.

If you want a road of your own, it is in the next part: you choose it, you write it down, and it is yours to look after. It never happens on its own.

## Three ways to connect

These are three different things; do not read them as one. The "Network" part of the console always says which one is in use.

### One, the default: Tailscale

- This is what it looks like right after the install, and nothing has to be configured. The plugin finds the tailnet address of this computer, builds a forward in the tailnet itself (`tailscale serve --tcp`), and the phone comes in on the 100.x address.
- The console stays on 127.0.0.1; only the phone side is in the tailnet. A request that arrives over the tailnet is never taken for a request of this computer, so the phone cannot read the console and cannot get the console token.
- When another forwarding already owns that port, the plugin does not touch it and the console says that the forward was not built.
- When the phone cannot be reached, look at three things: is the iPhone in this tailnet, is Tailscale logged in, and is there a direct path between the two.
- The way the traffic goes is written down as the path of this computer: **direct** is the two machines talking to each other encrypted, on one LAN usually found on their own, the fastest way; **peer relay** borrows a third device of the tailnet; **DERP** is Tailscale's own relay server and the last way out, the slowest but the most robust. None of them is a promise that the connection works.

### Two, an address of your own: your server, a reverse proxy or a Headscale of your own

Write an address into the field of the "Network" part and the phone is told that address when it pairs; the widget and the page on the phone use it as well. After that the plugin builds no Tailscale forward, and nothing of Tailscale is needed for this any more.

What may be written:

| Address | Allowed | Why |
|---|---|---|
| `https://my-server` / `https://my-server.example.com` | yes | An HTTPS address may name any domain. The token and the numbers travel encrypted. |
| `http://192.168.1.50:8791`, `http://10.0.0.7:8791`, `http://172.16.3.9:8791` | yes | The private ranges of RFC1918. |
| `http://100.64.0.5:8791` | yes | The range of Tailscale (and of a Headscale of your own). |
| `http://[fd00::1]:8791`, `http://[::1]:8791` | yes | IPv6 ULA and the loopback of this computer. |
| `http://box.local:8791`, `http://myserver:8791` | yes | Names kept for a network of your own, or a single label that the resolver of this computer knows. |
| `http://example.com`, `http://93.184.216.34:8791` | **no** | Plain HTTP out in the public internet: the token goes past everybody on the way. |

The check on the server and the check in the installer of the phone are the same one, so the two never contradict each other.

After the update to 0.3.3 the address that is written down is looked at again with these rules: a **plain HTTP address out in the public internet is not accepted any more**. The plugin takes it out of the settings, writes down why in the console, and goes back to the forward of the tailnet. Addresses of a private network, addresses of the tailnet and HTTPS addresses are not touched, and the phone that is already paired does not have to pair again.

What a reverse proxy has to do:

- **This version does not support an address with a path.** Use a domain of its own, map its **root** to the service of the plugin, and write `https://my-server`. Writing `https://my-server/widget` is refused outright, not half working.
- The proxy has to point at the **phone-side port** (8791 by default), not at the port of the console (8790 by default): the console stays on this computer for good, and the proxy should only put the phone side out.
- The proxy has to pass the original `Host` on (`proxy_set_header Host $host;`). The plugin recognises "this request is meant for me" by it, and a forged `Host` is refused.
- The plugin does **not** believe `X-Forwarded-Proto`, `X-Forwarded-Host` and the like: anybody can write them. Whether the road is HTTPS or plain HTTP is decided by the address you wrote in the console, and by nothing else.
- A proxy that ends the HTTPS itself and talks plain HTTP to the plugin is fine: the plugin judges by the address you wrote, not by the last leg.

What to keep in mind:

- On plain HTTP the token travels inside it. Unless the address is one of the trusted ones in the table above, use it only on a network you trust yourself.
- When the phone goes to an address of the LAN, the iPhone asks for the "local network" permission — allow it.
- Addresses move: when the router hands out a new one the phone cannot find the service any more, and you write the new address in the console.
- The firewall: the phone comes in over the LAN, so the firewall of Windows may shut that door; the first time, let it through (the "private networks" of Windows are enough).

### Three, a direct way over the LAN: the phone stays out of the tailnet

Without Tailscale, on one LAN only: the phone side opens a door on an address of this computer and the phone comes in over the LAN.

- Only the **phone side** opens a door; the console stays on this computer (127.0.0.1) for good, and the phone API carries no console.
- Press "the phone comes in here" behind a network card in the "Network" part, or write the address yourself (`http://192.168.1.50:8791`) and pick one of the addresses of this computer; the plugin then opens the phone side on that address.
- The iPhone asks for the "local network" permission — allow it; the firewall of Windows has to let the door through once.
- The address of the LAN moves when the router hands out a new one, and then the phone cannot find the service; go back to the console and pick it again.
- That road is plain HTTP, and the token travels inside it.

**How to shut it down for good**: press **"restore the Tailscale default"** in the "Network" part. That action empties the address you wrote, empties the network settings that were written down, **really closes the door of the LAN** (it is not only a change of the settings), and builds the Tailscale forward again. The console then writes down which way is in use now.

## The security boundary

Who may do what is decided by **the listener that took the connection**, not by a header the client can write.

- **The console listens on 127.0.0.1 only.** No other machine, no other network card, no device of the tailnet reaches it; the console page carries the token of the service, and only this computer can open it.
- **The phone side** (the listener of the tailnet, the door of the LAN, the connections that come through the forward) answers the phone and nothing else: the page of the phone, the pairing, the numbers. **There is no console on the phone side**: the console routes answer 403 there, and neither the page nor the script of the console is there.
- `Host`, `Origin`, `X-Forwarded-Proto` and `X-Forwarded-Host` are things a client can write, so the plugin does not take them for a pass. `Host` only stops an address that was written down wrong: the console knows `127.0.0.1` / `localhost` and nothing else, and a forwarded header is never believed.
- So a forged `Host: 127.0.0.1:8790` in the tailnet is of no use: that connection lands on the phone side and gets the page of the phone, not the console.
- The forward of Tailscale points at the **port of the phone side**; the console stays on this computer.
- The tokens of the phones are kept as hashes; the device management shows the name and the last visit, never the token itself. The token of the console itself stays in the state file of the service on this computer (only this user can read it, the file is 0600), and the page that carries it is served on 127.0.0.1 only.

Tests keep these lines (in `test/boundary.test.mjs`): the forged Host, the access across the listeners, the console routes from the wrong side, the token that does not leak, and the pairing that still works.

## The page on the phone

Tapping the widget opens the usage page on the phone: the remaining quota of every subscription, today's tokens, the last seven days and the rankings by model, vendor and client, the same numbers the computer shows.

The page opens with the read-only token of the widget. The token travels in the `#token=` part of the address and is wiped from there as soon as the page is open; from then on the page keeps it on the phone itself, so the next visit opens without asking for anything; the widget keeps its own copy — it was the one that put the token into the address. The page is served on the tailnet side only (on your own network, when you have written an address of your own), the console of the computer stays on this computer.

The token the page keeps is kept for thirty days. After that it is gone and the next visit has to scan the code again — and tapping the widget never asks for a token, because the widget puts it into the address itself every time. If Safari clears the stored data of the page, that is one more scan.

There is a "disconnect" at the top of the page on the phone: it wipes the token this phone kept and asks the service to take its row off the list on the computer (the row is really gone when the service answers; when it does not answer, the row is still there and you can delete it in the device management of the plugin page), and the next visit has to pair again (the other phones are not touched). Revoking that phone in the console of Magpie does the same thing — that token stops working at once, the row stays as a record and can be deleted with the "delete" button.

## Widget parameter

| Size | Shows | Widget Parameter |
|---|---|---|
| Small | one quota, the reset countdown, today's tokens | `codex` (default), `minimax`, `glm`; one account is written `codex@<account>`; `\|used` shows what is used, `\|remaining` shows what is left |
| Medium | up to 6 per page; 1–4 side by side, 5–6 in two rows of three; today's tokens; the reset time and the share of the week on two lines of their own (with 5–6 subscriptions in two rows only the 5-hour quota fits, and there is neither of those two lines) | empty; `page=2` for the second page; `\|used` turns every card into what is used, `\|remaining` back into what is left |
| Large | up to 6 per page; two columns with the quota, the reset and the second window; today's and the last seven days | empty; `page=2` for the second page; `\|used` turns every card into what is used, `\|remaining` back into what is left |

The account in a parameter is the account's name as it is right now. The console writes the parameters the widget understands next to every subscription, so one can be copied from there. When an account is renamed the parameter finds nothing, and the small widget is no longer empty: it shows the first card and writes "not found" next to it.

**The parameter is optional now**: the console has a "widget" block where the look is chosen — whether the number is what is remaining or what is used, and which card the small widget shows. Every widget follows that choice, and there is no parameter to type in Scriptable any more. The parameter still works: when it is filled in it wins, for that one widget only; when it is empty the widget listens to the console.

**What "follows the first one with a number" means**: when the gateway did not report an account for today, that card has only a dash on it (not a zero — "not known"). A small widget that was not told which card to show follows **the first card that has a number for today**. In the "widget" block of the plugin page, an account the gateway did not report today is marked "no number today", and another card can be picked by hand.

**Yesterday's numbers are not today's**: when the reading that came in is of another day, today's cell stays empty (the widget writes "—", the phone page writes "the usage is not known") — yesterday's numbers are never shown as today's.

### What "remaining" is

The quota of a vendor is counted over a rolling window (say one window of 5 hours, one of a week). How much of it you have used is one number seen from two sides:

- **used**: the share of the window that is already spent.
- **remaining**: the share that is left (remaining = 100% − used).

So "38% remaining" means: this window has 38% of the quota left. The countdown next to it says **when this window rolls over** (after that the remaining is back at 100%).

It is not the same as the token count: the remaining quota is **how much the plan gave you and how much is left**; today's tokens and the last seven days are **how many requests you actually sent**. A plan without a limit has no quota line at all, only the token count.

### When the widget writes "令牌无效，请重新配对"

The three reasons are told apart now:

- **令牌无效，请重新配对**: the token was revoked, or the device was deleted on the service. The widget wipes this token from the Keychain by itself, asks the service to take its row off the list on the computer (the row is really gone when the service answers), and goes back to the unpaired state — pair again by scanning the code. A 401 from a proxy in front of the service is not taken for a dead token: the widget says "服务返回 401" and keeps the token.
- **服务没有回答** / **服务返回 N**: the network is gone, the service is busy or it answered with an error; the widget shows the last result it has.
- **连不上服务**: it did not reach the service at all.

The old version had only two messages: "令牌无效，请重新设置" for a token the service did not know, and "离线缓存" for everything else (a service that answered with an error, a service that was gone) — which looked like everything was fine while the service had long stopped answering. An even older version had another trap: when the Keychain held a token the service no longer knew, the script skipped the "exchange the pairing code for a token" step every time, and pairing again or downloading the script again could not fix it — the Keychain had to be cleaned by hand first. Now the script **tries the exchange first** whenever it carries a fresh pairing code, and falls back to the token it has only when that fails; when the exchange works, the service is asked to take the row of the old token off the list (the row is really gone when the service answers). The new token is written down before the old row is cleaned up — the code works once, so a phone that is closed in between must not lose the token it just got.

Every number says which way it is read: "remaining" or "used". The bar is the same ink in the light and in the dark (only the depth differs), so it is not read as a warning at night; only the number turns orange or red when the quota is nearly gone.

## Lifetime

The service runs as long as Magpie runs. With Magpie closed, the phone keeps the last result it received. That is the trade-off of being a plugin, and it is not the same as the old service that stayed alive as a scheduled task.

When Magpie stops or reloads the plugin, the plugin runs through its own cleanup: it closes the doors it opened and takes away the forward it built. When the process is killed there is no time for that, see "Uninstall" below.

## Port

The service listens on 8790 by default, the phone side on 8791. Pick another one when the port is taken:

```bash
magpie plugin options magpie-page-token-widget '{"port":8890}'
```

Restart Magpie afterwards. In the default (Tailscale) mode the plugin publishes the port in the tailnet with a forwarding of Tailscale (`tailscale serve --tcp`), so the phone reaches it on the 100.x address. A forwarding of another service on that port is never touched.

The forwarding points at the phone side of the service (by default one port above the service port, so 8791), while the console stays on 127.0.0.1:8790. A request that comes in through the tailnet lands on that phone port and is never taken for a request of this computer, so the phone cannot read the console or the token. Once you write an address of your own, that forward is not built any more.

The plugin writes down the forwarding it made (the port and where it points) in its own file. After a restart it recognizes it and does not make it twice; a forwarding of an older version is moved to the phone side; the forwarding of somebody else is neither touched nor removed — the same port alone does not make it ours. It is taken away only when the plugin is stopped or uninstalled properly and the forwarding still points where it was written down.

`tailscale serve --bg --tcp=8790` is a standing setting of Tailscale: when the process is killed (a crash, a power cut) it stays there and does not go away by itself. The plugin finds it again on the next start, sees that it still points at itself, and goes on using it; to take it away by hand, run `tailscale serve --tcp=8790 off`, and `tailscale serve status` shows what is left.

The port and the gateway are both given to the plugin when Magpie starts it: the port is the address the plugin listens on, the gateway is the Magpie the plugin reads from. The plugin cannot move itself, so they stay startup parameters of Magpie. To change either of them, change the plugin settings of Magpie:

`magpie plugin options magpie-page-token-widget '{"port":8890,"gatewayURL":"http://127.0.0.1:3500"}'`

Then restart Magpie. The address the phone uses carries the port, so a new port leaves the address stored on the phone stale — run the installer `scriptable/SetupUsageWidget.js` again with the new address (and the token). The token itself stays valid; the phone does not have to pair again.

The plugin reads Magpie's own local API, `http://127.0.0.1:3425` by default. **That gateway has to point at this computer** (`127.0.0.1`, `::1` or `localhost`): the plugin reads the Magpie of this computer only, and another address is refused outright (the console writes down why) instead of sending your requests to that other machine. The **Advanced settings** of the console show where it reads from (that is all; they do not change it). A different gateway belongs in the plugin settings of Magpie: it only counts after Magpie has been restarted — until then the console still shows the old address, which is easy to misread.

## Compatibility

- Magpie `0.1.3681` or later is needed (`package.json` says so).
- The quota is read from the report Magpie has already cached (`/v1/magpie/quotas?kept=1`); the vendors are not asked again.
- Today's tokens come from one request to `/v1/magpie/usage?period=today`, which holds the totals, the hours, the vendors and the accounts. **When an older Magpie does not know that endpoint, the old way is used instead** (`/v1/magpie/usage/requests?period=today` plus one request per account) and the widget keeps its numbers. The old way is only used when the gateway says clearly that the endpoint is not there (404, 405, 501); a moment of trouble (500, a timeout, a broken connection) does not start a request per account, it keeps the numbers of the last good reading and marks them as old. "This endpoint is not there" is remembered for a while, so it is not asked again at every refresh.
- The trend of the last seven days and the rankings by model and vendor come from `/v1/magpie/usage/requests?period=7d&limit=1`: this is the only endpoint that carries the groups `by.model` and `by.agent`, and another endpoint would lose the rankings and the trend, so it stays.
- Magpie does not know the period `week` (it is taken for 30 days); seven days is `7d`.

## Uninstall

```bash
magpie plugin rm magpie-page-token-widget
```

When the plugin is stopped or removed, it closes the doors it opened and takes away the forward it built (only the one it wrote down). One thing it cannot do: when the process is killed (a crash, a power cut), there is no time for that, and the forward stays in Tailscale. It has to be taken away by hand:

```bash
tailscale serve --tcp=8790 off
```

## Privacy

- The service only reads the local API of Magpie (`127.0.0.1:3425` by default, this computer only). It does not write the configuration of Magpie and does not touch the logins.
- The tokens are random, read only and stay in the directory of Magpie; the service keeps only the hash of each phone's token (the token of the console itself stays in the state file on this computer, readable by this user alone). There is no shared token: one token per phone, and revoking one stops that phone alone. Only the plugin page of this computer and the phone that carries a pairing code can get one.
- The addresses of the LAN are only shown in the console of the computer; the phone API does not have them.
- In the default (Tailscale) mode the service listens on this computer only (127.0.0.1); the phone comes in through the forwarding of Tailscale. There is no public entrance and no firewall rule is needed. Once you write an address of your own, the phone side opens a door on the address you chose (**the phone side only** — the console stays on this computer), and the firewall has to let it through once. Whether that road is plain depends on the address you wrote: with an HTTPS domain the leg from the phone to the proxy is encrypted (the leg from the proxy to the plugin is still plain HTTP), with an address inside your own network it is plain all the way.

## Development

```bash
npm test
```

The tests never touch the real Tailscale: everything that speaks with the command of Tailscale talks to a fake one instead (`mockTailscale` in `test/helpers.mjs`), and the real `tailscale serve` settings are never changed. The gateway of Magpie is one the tests start themselves.

`lib/collector.mjs` and `lib/normalize.mjs` come from [ScriptableTokenWidgets](https://github.com/liuzq1103/ScriptableTokenWidgets), `lib/vendor/qrcode-generator.cjs` is [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator). See [NOTICE](NOTICE).
