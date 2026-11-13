(() => {
  const token = document.querySelector('meta[name="service-token"]')?.content || '';
  let current = null;
  const element = (id) => document.getElementById(id);
  const text = (id, value) => {
    const node = element(id);
    if (node) node.textContent = value;
  };

  // Everything that comes from the outside is put into the page as text, never
  // as markup. The name of a peer in the tailnet is chosen by somebody else,
  // so it is treated as text.
  const node = (tag, className, content) => {
    const made = document.createElement(tag);
    if (className) made.className = className;
    if (content !== undefined && content !== null) made.textContent = String(content);
    return made;
  };

  const mono = (value) => node('span', 'mono', value);

  const api = async (path, options = {}) => {
    const response = await fetch(path, {
      ...options,
      headers: {
        'x-token-widget-token': token,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
    if (!response.ok) {
      let message = `request failed: ${response.status}`;
      try {
        const body = await response.json();
        if (body && body.error) message = body.error;
      } catch {
        // The answer is not json; the number is all there is.
      }
      throw new Error(message);
    }
    return response.json();
  };

  const copy = async (value, label) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      text('pairNote', `${label}已经复制到剪贴板。`);
    } catch {
      text('pairNote', `复制不了，请手动选中：${value}`);
    }
  };

  const KIND_LABEL = {
    tailscale: 'Tailscale',
    wifi: '无线',
    ethernet: '有线',
    virtual: '虚拟',
    loopback: '回环',
    other: '其他',
  };

  const PATH_LABEL = {
    direct: '直连（端到端加密）',
    relay: '经由尾网中继设备',
    derp: '经由 Tailscale 中继服务器',
    unknown: '还不知道',
    offline: '不在线',
  };

  const timeOf = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('zh-CN', { hour12: false });
  };

  // A list of name and value. Both of them are text.
  const fillFacts = (target, rows) => {
    const list = element(target);
    if (!list) return;
    list.replaceChildren();
    for (const [name, value] of rows) {
      list.append(node('dt', null, name));
      const cell = node('dd');
      if (value instanceof Node) cell.append(value);
      else cell.textContent = value === undefined || value === null || value === '' ? '—' : String(value);
      list.append(cell);
    }
  };

  const renderFacts = (state) => {
    const tailnet = state.tailnet || {};
    const forward = state.forward || {};
    fillFacts('facts', [
      ['服务地址', mono(state.serviceURL || '—')],
      [
        'Tailscale',
        tailnet.installed
          ? tailnet.connected
            ? '已连接'
            : `未连接（${tailnet.backendState || '未知'}）`
          : '没有安装',
      ],
      ['尾网地址', mono(tailnet.tailnetIP || '—')],
      ['MagicDNS', mono(tailnet.dnsName || '—')],
      ['本机连接路径', PATH_LABEL[tailnet.path] || PATH_LABEL.unknown],
      [
        '尾网转发',
        forward.ready ? '已就绪，手机从尾网连进来' : `没有建好：${forward.error || '还不知道原因'}`,
      ],
      [
        '同一网络里的 iPhone',
        tailnet.ios?.length ? tailnet.ios.map((phone) => phone.name).join('、') : '没有看到',
      ],
      ['Magpie 网关', mono(state.upstream || '—')],
    ]);
  };

  // The user may have a network of his own: a Headscale of his own, a
  // server of his own, a tunnel of his own. The address the phone is told to
  // use is written down here, and the phone side may listen on an address of
  // this computer.
  const renderOwnNetwork = (state) => {
    const external = state.external || {};
    const field = element('external');
    if (field && document.activeElement !== field) field.value = external.url || '';
    const note = element('externalNote');
    if (note) {
      const parts = [];
      parts.push(external.url
        ? `手机会用这个地址：${external.url}。`
        : '留空就用 Tailscale 的地址。');
      if (external.listenAddress) {
        parts.push(`手机那一侧的端口已经在 ${external.listenAddress} 上打开。`);
      }
      if (external.error) parts.push(external.error);
      parts.push('这条路上的数据是明文的 HTTP，令牌就走在里面；iPhone 会问你要「本地网络」的权限。');
      note.textContent = parts.join(' ');
    }
    const list = element('bindList');
    if (!list) return;
    list.replaceChildren();
    const candidates = external.candidates || [];
    if (!candidates.length) {
      list.append(node('p', 'note', '没有找到这台电脑上可以给手机用的地址。'));
      return;
    }
    for (const item of candidates) {
      const row = node('div', 'row');
      row.append(node('strong', null, item.name));
      row.append(node('span', 'tag', KIND_LABEL[item.kind] || KIND_LABEL.other));
      row.append(node('span', 'mono', item.address));
      const use = node('button', null, '手机从这里连');
      use.type = 'button';
      use.addEventListener('click', () => { void useOwnAddress(item.address); });
      row.append(use);
      list.append(row);
    }
  };

  // The phone is told to go to an address of this computer, and the phone
  // side starts listening there.
  const useOwnAddress = async (address) => {
    try {
      const port = current?.phonePort;
      const host = address.includes(':') ? `[${address}]` : address;
      const url = port ? `http://${host}:${port}` : '';
      const before = current?.external?.url || '';
      if (before && before !== url && !window.confirm(`把手机换成 ${url}？原来填的地址会换掉。`)) return;
      await api('api/v1/console/options', {
        method: 'POST',
        body: JSON.stringify({
          listenAddress: address,
          externalURL: url,
        }),
      });
      await load();
    } catch (error) {
      text('externalNote', error.message || '这个地址没有用。');
    }
  };

  const saveOwnAddress = async () => {
    const field = element('external');
    if (!field) return;
    try {
      await api('api/v1/console/options', {
        method: 'POST',
        body: JSON.stringify({ externalURL: field.value.trim() }),
      });
      await load();
    } catch (error) {
      text('externalNote', error.message || '这个地址写不了。');
    }
  };

  const renderNetwork = (state) => {
    const tailnet = state.tailnet || {};
    fillFacts('netFacts', [
      ['Tailscale 是否安装', tailnet.installed ? '是' : '没有安装'],
      ['Tailscale 是否连接', tailnet.connected ? `已连接（${tailnet.backendState || 'Running'}）` : `未连接（${tailnet.backendState || '未知'}）`],
      ['本机尾网地址', mono(tailnet.tailnetIP || '—')],
      ['MagicDNS 地址', mono(tailnet.dnsName || '—')],
      ['本机连接路径', PATH_LABEL[tailnet.path] || PATH_LABEL.unknown],
      ['手机入口', mono(state.serviceURL ? `${state.serviceURL}/` : '—')],
    ]);

    const peers = element('peers');
    if (peers) {
      peers.replaceChildren();
      const list = tailnet.ios || [];
      if (!list.length) {
        peers.append(node('p', 'note', '尾网里没有看到 iPhone。手机要和电脑在同一个 Tailscale 里。'));
      }
      for (const phone of list) {
        const row = node('div', 'row');
        row.append(node('strong', null, phone.name));
        row.append(node('span', 'mono', (phone.ips || []).join('、') || '没有地址'));
        row.append(node('span', 'tag', PATH_LABEL[phone.path] || PATH_LABEL.unknown));
        peers.append(row);
      }
    }

    const interfaces = element('interfaces');
    if (interfaces) {
      interfaces.replaceChildren();
      const list = tailnet.interfaces || [];
      if (!list.length) {
        interfaces.append(node('p', 'note', '没有读到这台电脑的网卡。'));
      }
      for (const item of list) {
        const row = node('div', 'row');
        const names = node('span', 'tag', KIND_LABEL[item.kind] || KIND_LABEL.other);
        row.append(node('strong', null, item.name), names);
        const addresses = [...(item.ipv4 || []), ...(item.ipv6 || [])].map(
          (address) => `${address.address}/${address.prefix}`
        );
        row.append(node('span', 'mono', addresses.join('、') || '没有地址'));
        interfaces.append(row);
      }
    }

    const lan = tailnet.lan || [];
    const lanNote = element('lanNote');
    if (lanNote) {
      lanNote.textContent = lan.length
        ? `家里网络上的地址：${lan
            .map((item) => `${item.name} ${(item.addresses || []).join('、')}`)
            .join('；')}。这些地址只是给这台电脑做诊断看的，手机不会走它们——手机默认走 Tailscale，流量是端到端加密的。`
        : '没有找到家里网络上的地址（RFC1918 网段）。手机默认走 Tailscale。';
    }
  };

  const renderDevices = (state) => {
    const list = element('devices');
    if (!list) return;
    list.replaceChildren();
    const devices = state.devices || [];
    if (!devices.length) {
      list.append(node('p', 'note', '还没有手机配对过。'));
      return;
    }
    for (const device of devices) {
      const row = node('div', 'row');
      const name = node('input');
      name.type = 'text';
      name.value = device.name || '';
      name.setAttribute('aria-label', '设备名称');
      name.className = 'device-name';
      row.append(name);
      const meta = node('span', 'note');
      meta.textContent = [
        `配对于 ${timeOf(device.createdAt)}`,
        `最后访问 ${device.lastAccessAt ? timeOf(device.lastAccessAt) : '还没有'}`,
        '独立令牌',
        device.revokedAt ? `已撤销（${timeOf(device.revokedAt)}）` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      row.append(meta);
      const actions = node('span', 'actions');
      const rename = node('button', 'quiet', '改名');
      rename.type = 'button';
      rename.addEventListener('click', async () => {
        try {
          const result = await api('api/v1/console/device', {
            method: 'POST',
            body: JSON.stringify({ id: device.id, action: 'rename', name: name.value }),
          });
          if (current) current.devices = result.devices;
          text('deviceNote', '名字改好了。');
          renderDevices(current || {});
        } catch {
          text('deviceNote', '没有改成功，请再试一次。');
        }
      });
      actions.append(rename);
      if (!device.revokedAt) {
        const revoke = node('button', 'danger', '撤销');
        revoke.type = 'button';
        revoke.addEventListener('click', async () => {
          if (!window.confirm(`撤销「${device.name}」之后，这台手机上的组件就读不到用量了。确定吗？`)) return;
          try {
            const result = await api('api/v1/console/device', {
              method: 'POST',
              body: JSON.stringify({ id: device.id, action: 'revoke' }),
            });
            if (current) current.devices = result.devices;
            text('deviceNote', '已经撤销这一台。别的手机不受影响。');
            renderDevices(current || {});
          } catch {
            text('deviceNote', '没有撤销成功，请再试一次。');
          }
        });
        actions.append(revoke);
      }
      row.append(actions);
      list.append(row);
    }
  };

  const renderRefresh = (state) => {
    const box = element('refresh');
    if (!box) return;
    box.replaceChildren();
    const chosen = state.refresh?.strategy || 'smart';
    for (const option of state.refresh?.options || []) {
      const label = node('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'refresh-strategy';
      input.value = option.id;
      input.checked = option.id === chosen;
      input.addEventListener('change', async () => {
        try {
          const result = await api('api/v1/console/options', {
            method: 'POST',
            body: JSON.stringify({ refreshStrategy: option.id }),
          });
          if (current) current.refresh = result.refresh;
          text('refreshNote', `已经换成「${option.label}」，下一次刷新就照新的来，不用重启服务。`);
        } catch {
          text('refreshNote', '没有换成功，请再试一次。');
        }
      });
      label.append(input, document.createTextNode(option.label));
      box.append(label);
    }
    text(
      'refreshNote',
      state.refresh?.strategy === 'smart'
        ? '智能更新：有人看的时候一分钟一次，没人看的时候慢下来。过期了手机来问，服务会先刷新一次，最多等两三秒。'
        : `已经换成「${state.refresh?.label || ''}」。`
    );
  };

  const renderAdvanced = (state) => {
    const forward = state.forward || {};
    fillFacts('advanced', [
      ['服务端口', mono(String(state.port ?? '—'))],
      ['手机端口', mono(String(state.phonePort ?? '—'))],
      ['Magpie 网关', mono(state.upstream || '—')],
      ['配对码剩余时间', remainingText(pairingLeft(state))],
      ['本插件的转发', forward.owned ? mono(`${forward.owned.publishedPort} → ${forward.owned.target}`) : '还没有记录'],
      ['配对记录', `${(state.paired || []).length} 条`],
    ]);
    const gateway = element('gateway');
    if (gateway && document.activeElement !== gateway) gateway.value = state.upstream || '';
    text(
      'portNote',
      '端口是 Magpie 启动这个插件时给的参数，插件改不了自己听的端口，所以它不在这儿改。' +
        '要换端口，在 Magpie 的插件设置里改（magpie plugin options magpie-page-token-widget \'{"port":8890}\'），' +
        '改完重启 Magpie；手机那边的地址带着端口，换了端口手机要重新配对一次。'
    );
  };

  const renderSubscriptions = (state) => {
    const list = element('subscriptions');
    if (!list) return;
    list.replaceChildren();
    const chosen = new Set(state.display?.subscriptions || []);
    const all = chosen.has('*');
    const items = state.subscriptions || [];
    for (const subscription of items) {
      const family = subscription.provider || subscription.id;
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = subscription.id;
      input.checked = all || chosen.has(family) || chosen.has(subscription.id);
      label.append(input, document.createTextNode(subscription.label || subscription.id));
      list.append(label);
    }
    list.onchange = async () => {
      const checked = new Set(
        [...list.querySelectorAll('input')]
          .filter((input) => input.checked)
          .map((input) => input.value)
      );
      // A family names all of its accounts, a name with an account names that
      // one. The list shows every account, and one of them is on when its
      // family or its own name is chosen.
      const families = new Map();
      for (const subscription of items) {
        const family = subscription.provider || subscription.id;
        if (!families.has(family)) families.set(family, []);
        families.get(family).push(subscription.id);
      }
      const next = [];
      for (const [family, ids] of families) {
        const on = ids.filter((id) => checked.has(id));
        if (!on.length) continue;
        if (on.length === ids.length) next.push(family);
        else next.push(...on);
      }
      if (!next.length) {
        text('subNote', '至少要留一家订阅，中号和大号组件才有内容。');
        return;
      }
      try {
        const result = await api('api/v1/console/options', {
          method: 'POST',
          body: JSON.stringify({ subscriptions: next }),
        });
        state.display = result.display;
        text('subNote', '已经记下，手机上的组件下一次刷新就会跟着变。');
      } catch {
        text('subNote', '没有存上，请再试一次。');
      }
    };
  };

  // How long the pairing code is still good. The time is counted here, on
  // the page, so that the numbers do not stand still while the page is open.
  const pairingLeft = (state) => {
    const until = Date.parse(state?.pairingExpiresAt || '');
    if (!Number.isFinite(until)) return 0;
    return Math.max(0, Math.round((until - Date.now()) / 1000));
  };

  // Under a minute the seconds are shown, so a code that is about to die does
  // not look like a dead one.
  const remainingText = (seconds) => {
    const left = Math.max(0, Math.round(seconds || 0));
    if (!left) return '已经作废';
    if (left < 60) return `还剩 ${left} 秒`;
    return `还剩 ${Math.floor(left / 60)} 分 ${left % 60} 秒`;
  };

  const renderPairing = (state) => {
    const qr = element('qr');
    if (qr && state.qr) qr.src = state.qr;
    if (qr && !state.qr) qr.closest('.qr')?.classList.add('empty');
    text('pairingURL', state.pairingURL || '还没有找到 Tailscale 地址');
    const blocked = Math.max(0, Math.round((state.pairingBlocked || 0) / 60));
    text(
      'pairNote',
      state.pairingBlocked
        ? `猜错的次数太多，配对先关上 ${blocked} 分钟。点「重新生成配对码」可以马上再开。`
        : state.pairingURL
          ? `配对码只能用一次，十分钟后也会作废（${remainingText(pairingLeft(state))}）。手机装好组件后它会自动失效，再生成一个就能装第二台。`
          : 'Tailscale 没有连上，或者这台电脑没有尾网地址。手机和电脑要在同一个 Tailscale 里。'
    );
  };

  const render = (state) => {
    current = state;
    renderPairing(state);
    text(
      'lifetime',
      '组件随 Magpie 运行：关掉 Magpie 之后，手机上显示的是上一次的结果，重新打开 Magpie 就会更新。'
    );
    renderFacts(state);
    renderNetwork(state);
    renderOwnNetwork(state);
    renderDevices(state);
    renderRefresh(state);
    renderAdvanced(state);
    renderSubscriptions(state);
  };

  // A pairing code that has run out is of no use to anybody. A new one is
  // made at once, so the first pairing after the install needs no extra click.
  const renewPairing = async () => {
    if (!current) return false;
    if (pairingLeft(current) > 0) {
      // The note counts down on the page itself.
      renderPairing(current);
      renderAdvanced(current);
      return false;
    }
    try {
      const result = await api('api/v1/console/pair', { method: 'POST', body: '{}' });
      current = result;
      renderPairing(result);
      renderAdvanced(result);
      return true;
    } catch {
      text('pairNote', '没能换一个新的配对码，过一会儿再试一次。');
      return false;
    }
  };

  const load = async () => {
    try {
      render(await api('api/v1/console/state'));
      await renewPairing();
    } catch {
      text('pairNote', '这个页面没有连上本机的额度服务，关掉插件页面再打开一次。');
    }
  };

  // The page stays open, so the code is looked at now and then. When it has
  // run out, a new one is made without being asked for.
  setInterval(() => { void renewPairing(); }, 30000);

  element('copyLink')?.addEventListener('click', () => copy(current?.pairingURL, '配对链接'));
  element('saveGateway')?.addEventListener('click', async () => {
    const value = element('gateway')?.value?.trim() || '';
    try {
      const result = await api('api/v1/console/options', {
        method: 'POST',
        body: JSON.stringify({ gatewayURL: value }),
      });
      current.upstream = result.upstream || value;
      text('gatewayNote', '已经记下了，下一次读数就从这里拿。');
      renderAdvanced(current);
    } catch {
      text('gatewayNote', '没有存上：网关只能是这台电脑上的 Magpie（http://127.0.0.1:3425）。');
    }
  });
  element('manualToken')?.addEventListener('click', async () => {
    const name = element('manualName')?.value?.trim() || '';
    try {
      const result = await api('api/v1/console/device', {
        method: 'POST',
        body: JSON.stringify({ action: 'create', name }),
      });
      if (current) current.devices = result.devices;
      renderDevices(current || {});
      // The token is shown here and nowhere else. The service keeps only its
      // hash, so it cannot be shown a second time.
      text('manualNote', `给「${result.device.name}」的令牌（只显示这一次，复制后交给那台手机）：${result.token}`);
      await copy(result.token, '令牌');
    } catch {
      text('manualNote', '没有做成，请再试一次。');
    }
  });
  element('rotate')?.addEventListener('click', async () => {
    try {
      render(await api('api/v1/console/pair', { method: 'POST' }));
    } catch {
      text('pairNote', '没有换成新的配对码，请再试一次。');
    }
  });
  element('saveExternal')?.addEventListener('click', () => { void saveOwnAddress(); });
  element('diagnose')?.addEventListener('click', async () => {
    text('diagnoseNote', '正在问 Tailscale…');
    try {
      const result = await api('api/v1/console/diagnose', { method: 'POST', body: '{}' });
      if (current) current.tailnet = result.tailnet;
      renderNetwork(current || {});
      const ping = result.ping || {};
      text(
        'diagnoseNote',
        ping.ok
          ? `到 ${ping.target} 的路径：${PATH_LABEL[ping.path] || PATH_LABEL.unknown}。`
          : `诊断没有成功：${ping.error || '还不知道原因'}`
      );
    } catch {
      text('diagnoseNote', '诊断没有跑起来，请再试一次。');
    }
  });

  load();
})();
