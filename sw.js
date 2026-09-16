/* App shell only. NEVER intercept model requests, imports, or user content. */
const ROOT = new URL('./', self.location.href);
const CACHE_PREFIX = `code-design:${ROOT.pathname}:`;
const VERSION = `${CACHE_PREFIX}v1.0.1`;
const FILES = ['./', './index.html', './preview.html', './manifest.webmanifest', './assets/icon.svg', './src/app.js', './src/core.js', './src/api.js', './src/preview.js', './src/preview-frame.js', './src/icons.js', './src/gpu.js', './src/style.css'];
const URLS = new Set(FILES.map(path => new URL(path, ROOT).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll([...URLS])));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // CacheStorage is origin-wide: preserve other Pages projects and app forks.
    for (const key of await caches.keys()) {
      if (key.startsWith(CACHE_PREFIX) && key !== VERSION) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  // Navigation Request URLs may retain the client-side route fragment. It is
  // not part of the HTTP resource: normalize both the allowlist and cache key.
  // Keep query strings significant so unknown requests are never intercepted.
  const url = new URL(event.request.url);
  url.hash = '';
  const key = url.href;
  if (!URLS.has(key)) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const response = await fetch(event.request);
      if (response.ok && response.type !== 'opaque') await cache.put(key, response.clone());
      return response;
    } catch {
      return await cache.match(key) || new Response('Offline resource unavailable.', { status: 503 });
    }
  })());
});
