import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../scriptable/UsageWidget.js', import.meta.url), 'utf8');
const SETTINGS_KEY = 'ameaq-rmrcxu-b2';

// The widget runs on a phone, not here. These stubs are the smallest world
// the script can live in: a widget that only remembers what was written on
// it, a keychain, a file manager and a request that answers the way the test
// wants it to. What is written on the widget is what the user sees.
class FakeElement {
  constructor() {
    this.font = null;
    this.textColor = null;
    this.lineLimit = 1;
    this.minimumScaleFactor = 1;
    this.imageSize = null;
  }
}

class FakeStack {
  constructor(log) {
    this.log = log;
    this.size = null;
  }
  addText(value) {
    this.log.push(String(value));
    return new FakeElement();
  }
  addStack() {
    return new FakeStack(this.log);
  }
  addImage() {
    return new FakeElement();
  }
  addSpacer() {}
  centerAlignContent() {}
  topAlignContent() {}
  layoutVertically() {}
  layoutHorizontally() {}
}

class FakeSize {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }
}

class FakeRect {
  constructor(x, y, width, height) {
    Object.assign(this, { x, y, width, height });
  }
}

class FakeColor {
  constructor(value) {
    this.value = value;
  }
  static dynamic(first) {
    return first;
  }
}

class FakeDrawContext {
  setFillColor() {}
  fillRect() {}
  getImage() {
    return { fake: true };
  }
}

const overview = (display = {}) => ({
  schemaVersion: 1,
  generatedAt: Date.now(),
  display: { widgetMode: 'remaining', widgetCard: '', subscriptions: ['codex'], ...display },
  sources: {
    today: { state: 'ok', observedAt: new Date().toISOString(), outdated: false },
    week: { state: 'ok', observedAt: new Date().toISOString(), outdated: false },
    quotas: { state: 'ok', observedAt: new Date().toISOString(), outdated: false },
  },
  usage: {
    today: { totalTokens: 3500, input: 1000, output: 500, cacheRead: 2000, cacheWrite: 0, requests: 100 },
    week: { totalTokens: 10500, input: 4000, output: 2000, cacheRead: 4500, cacheWrite: 0, requests: 700 },
  },
  subscriptions: [
    {
      id: 'codex@alpha',
      provider: 'codex',
      account: 'alpha',
      label: 'Codex · alpha',
      windows: [
        { label: '5h', usedPercent: 41, remainingPercent: 59, resetsAt: Date.now() + 3600000 },
        { label: 'week', usedPercent: 12, remainingPercent: 88, resetsAt: Date.now() + 86400000 },
      ],
      usage: { today: { totalTokens: 600 } },
      stale: false,
    },
  ],
});

const runWidget = async ({
  request,
  keychain = { [SETTINGS_KEY]: JSON.stringify({ baseURL: 'http://127.0.0.1:8790', token: 'a'.repeat(40) }) },
  config = {},
  args = {},
} = {}) => {
  const log = [];
  const calls = { setWidget: 0, complete: 0 };
  const context = {
    console,
    Script: {
      setWidget: () => { calls.setWidget += 1; },
      complete: () => { calls.complete += 1; },
    },
    Keychain: { get: (key) => keychain[key], set: () => {} },
    FileManager: {
      local: () => ({
        joinPath: (...parts) => parts.join('/'),
        documentsDirectory: () => '/tmp/documents',
        fileExists: () => false,
        readString: () => '',
        writeString: () => {},
      }),
    },
    Request: request,
    ListWidget: class {
      constructor() { this.log = log; }
      addText(value) { log.push(String(value)); return new FakeElement(); }
      addStack() { return new FakeStack(log); }
      addImage() { return new FakeElement(); }
      addSpacer() {}
      setPadding() {}
    },
    DrawContext: FakeDrawContext,
    Size: FakeSize,
    Rect: FakeRect,
    Color: FakeColor,
    Font: { systemFont: () => 'font', mediumSystemFont: () => 'font' },
    config: { widgetFamily: 'medium', widgetParameter: '', runsInWidget: true, ...config },
    args: { widgetParameter: '', ...args },
    Device: { name: () => 'iPhone', model: () => 'iPhone', isUsingDarkAppearance: () => false },
  };
  vm.createContext(context);
  await vm.runInContext(`(async () => {\n${source}\n})();`, context);
  return { log, calls };
};

const failing = (error, response = null) =>
  class {
    constructor() {
      this.response = response;
    }
    async loadJSON() {
      throw error;
    }
  };

test('the widget tells a wrong token from a quiet network', async () => {
  const wrong = await runWidget({
    request: failing(new Error('The server returned status 401'), { statusCode: 401 }),
  });
  assert.equal(wrong.calls.setWidget, 1, 'the widget is set even when the service says no');
  assert.ok(wrong.log.some(line => line.includes('令牌无效，请重新设置')), wrong.log.join(' | '));

  const quiet = await runWidget({
    request: failing(new Error('The request timed out.')),
  });
  assert.equal(quiet.calls.setWidget, 1);
  assert.ok(quiet.log.some(line => line.includes('服务没有回答')), quiet.log.join(' | '));

  const gone = await runWidget({
    request: failing(new Error('The server could not be reached.')),
  });
  assert.equal(gone.calls.setWidget, 1);
  assert.ok(gone.log.some(line => line.includes('连不上服务')), gone.log.join(' | '));
});

test('the widget shows the numbers of the plugin page', async () => {
  const answering = class {
    constructor() {
      this.response = { statusCode: 200 };
    }
    async loadJSON() {
      return overview({ widgetMode: 'used' });
    }
  };
  const used = await runWidget({ request: answering });
  assert.equal(used.calls.setWidget, 1);
  assert.ok(used.log.some(line => line.includes('已用')), used.log.join(' | '));

  const remaining = await runWidget({
    request: class {
      constructor() { this.response = { statusCode: 200 }; }
      async loadJSON() { return overview(); }
    },
  });
  assert.ok(remaining.log.some(line => line.includes('剩余')), remaining.log.join(' | '));
  assert.ok(!remaining.log.some(line => line.includes('已用')), remaining.log.join(' | '));
});

test('the parameter of the phone still wins over the plugin page', async () => {
  const answering = class {
    constructor() { this.response = { statusCode: 200 }; }
    async loadJSON() { return overview({ widgetMode: 'used' }); }
  };
  const overridden = await runWidget({ request: answering, args: { widgetParameter: 'remaining' } });
  assert.ok(overridden.log.some(line => line.includes('剩余')), overridden.log.join(' | '));
  assert.ok(!overridden.log.some(line => line.includes('已用')), overridden.log.join(' | '));
});
