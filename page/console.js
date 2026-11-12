(() => {
  const state = window.__WIDGET_STATE__ || {};
  const params = new URLSearchParams(location.search);
  const theme = params.get("theme");
  if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;

  const element = (id) => document.getElementById(id);
  const text = (id, value) => {
    const node = element(id);
    if (node) node.textContent = value;
  };

  const qr = element("qr");
  if (qr && state.qr) qr.src = state.qr;
  if (qr && !state.qr) qr.closest(".qr").classList.add("empty");
  text("pairingURL", state.pairingURL || "还没有找到 Tailscale 地址");
  text(
    "pairNote",
    state.pairingURL
      ? "配对码只能用一次。手机装好组件后它会自动失效，再生成一个就能装第二台。"
      : "Tailscale 没有连上，或者这台电脑没有尾网地址。手机和电脑要在同一个 Tailscale 里。"
  );
  text(
    "lifetime",
    "组件随 Magpie 运行：关掉 Magpie 之后，手机上显示的是上一次的结果，重新打开 Magpie 就会更新。"
  );

  const facts = element("facts");
  const rows = [];
  const add = (name, value) => rows.push(`<dt>${name}</dt><dd>${value}</dd>`);
  const tailnet = state.tailnet || {};
  add("服务地址", `<span class="mono">${state.serviceURL || "—"}</span>`);
  add(
    "Tailscale",
    tailnet.installed
      ? tailnet.connected
        ? "已连接"
        : `未连接（${tailnet.backendState || "未知"}）`
      : "没有安装"
  );
  add("尾网地址", `<span class="mono">${tailnet.tailnetIP || "—"}</span>`);
  const forward = state.forward || {};
  add(
    "尾网转发",
    forward.ready
      ? "已就绪，手机从尾网连进来"
      : `没有建好：${forward.error || "还不知道原因"}`
  );
  add("同一网络里的 iPhone", tailnet.ios?.length ? tailnet.ios.map((phone) => phone.name).join("、") : "没有看到");
  add("Magpie 网关", `<span class="mono">${state.upstream || "—"}</span>`);
  add("只读令牌", `<span class="mono" id="tokenValue">${state.token ? "••••••••••••••••" : "—"}</span>`);
  if (facts) facts.innerHTML = rows.join("");

  const copy = async (value, label) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      text("pairNote", `${label}已经复制到剪贴板。`);
    } catch {
      text("pairNote", `复制不了，请手动选中：${value}`);
    }
  };

  element("copyLink")?.addEventListener("click", () => copy(state.pairingURL, "配对链接"));
  element("copyToken")?.addEventListener("click", () => copy(state.token, "只读令牌"));
  element("rotate")?.addEventListener("click", async () => {
    const response = await fetch("api/v1/console/pair", { method: "POST" });
    if (response.ok) location.reload();
  });

  // The subscriptions of the overview decide what the medium and the large
  // widget show.
  const list = element("subscriptions");
  const load = async () => {
    let overview = null;
    try {
      const response = await fetch("api/v1/overview", {
        headers: { Authorization: "Bearer " + state.token },
      });
      if (response.ok) overview = await response.json();
    } catch { /* The list stays empty when the service cannot be reached. */ }
    if (!overview || !Array.isArray(overview.subscriptions)) return;
    const chosen = new Set(state.display?.subscriptions || []);
    const all = chosen.has("*");
    list.innerHTML = overview.subscriptions
      .map(
        (subscription) => `<label><input type="checkbox" value="${subscription.id}"${
          all || chosen.has(subscription.id) ? " checked" : ""
        } /> ${subscription.label || subscription.id}</label>`
      )
      .join("");
    list.addEventListener("change", async () => {
      const picked = [...list.querySelectorAll("input")].map((input) => input.value);
      await fetch("api/v1/console/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptions: picked.length ? picked : ["*"] }),
      });
    });
  };
  load();
})();
