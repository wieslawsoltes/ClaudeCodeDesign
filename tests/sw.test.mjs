import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const root = 'https://example.github.io/ClaudeCodeDesign/';
const current = 'code-design:/ClaudeCodeDesign/:v1.0.1';

function worker({ online = false, cached = true, keys = [] } = {}) {
  const listeners = new Map(), putKeys = [], matchKeys = [], removed = [], opened = [];
  let claimed = false;
  const cache = {
    addAll: async () => {},
    put: async key => { putKeys.push(key); },
    match: async key => { matchKeys.push(key); return cached ? new Response('Cached shell') : undefined; },
  };
  runInNewContext(source, {
    URL, Response,
    self: {
      location: { href: `${root}sw.js` },
      addEventListener: (name, handler) => listeners.set(name, handler),
      clients: { claim: async () => { claimed = true; } },
    },
    caches: {
      open: async name => { opened.push(name); return cache; },
      keys: async () => keys,
      delete: async key => { removed.push(key); return true; },
    },
    fetch: async () => {
      if (!online) throw new TypeError('Origin is stopped');
      return new Response('Network shell');
    },
  });
  return {
    putKeys, matchKeys, removed, opened,
    claimed: () => claimed,
    fetch(url, method = 'GET') {
      let response;
      listeners.get('fetch')({ request: new Request(url, { method }), respondWith: value => { response = value; } });
      return response;
    },
    async activate() {
      let pending;
      listeners.get('activate')({ waitUntil: value => { pending = value; } });
      await pending;
    },
  };
}

test('offline hash-route navigations use the canonical cached app shell', async () => {
  const sw = worker();
  for (const route of ['#files', '#session/a', '#preview', '#changes']) {
    const response = await sw.fetch(root + route);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'Cached shell');
  }
  assert.deepEqual(sw.matchKeys, Array(4).fill(root));
});

test('successful shell refreshes store fragment-free cache keys', async () => {
  const sw = worker({ online: true });
  const response = await sw.fetch(`${root}index.html#files`);
  assert.equal(await response.text(), 'Network shell');
  assert.deepEqual(sw.putKeys, [`${root}index.html`]);
  assert.deepEqual(sw.matchKeys, []);
});

test('service worker never intercepts API, imports, other origins, query variants or writes', () => {
  const sw = worker();
  for (const url of [
    'https://api.anthropic.com/v1/messages',
    'https://api.github.com/repos/user/project',
    'https://other.example/ClaudeCodeDesign/',
    `${root}untrusted.js`, `${root}?unknown=1`, `${root}src/app.js?unknown=1`,
  ]) assert.equal(sw.fetch(url), undefined);
  assert.equal(sw.fetch(root, 'POST'), undefined);
  assert.deepEqual(sw.opened, []);
});

test('uncached app resources return an explicit offline failure', async () => {
  const sw = worker({ cached: false });
  const response = await sw.fetch(`${root}src/app.js`);
  assert.equal(response.status, 503);
  assert.match(await response.text(), /Offline resource unavailable/);
});

test('activation removes only obsolete caches in this project namespace', async () => {
  const old = 'code-design:/ClaudeCodeDesign/:v1.0.0';
  const sw = worker({ keys: [current, old, 'code-design:/AnotherProject/:v1.0.0', 'unrelated-cache'] });
  await sw.activate();
  assert.deepEqual(sw.removed, [old]);
  assert.equal(sw.claimed(), true);
});
