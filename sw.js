/* App shell only. NEVER intercept model requests, imports, or user content. */
const VERSION = 'code-design-v1.0.0-r1';
const ROOT = new URL('./', self.location.href);
const FILES = ['./', './index.html', './preview.html', './manifest.webmanifest', './assets/icon.svg', './src/app.js', './src/core.js', './src/api.js', './src/preview.js', './src/preview-frame.js', './src/icons.js', './src/gpu.js', './src/style.css'];
const URLS = new Set(FILES.map(path => new URL(path, ROOT).href));
self.addEventListener('install', event => { event.waitUntil(caches.open(VERSION).then(cache => cache.addAll([...URLS]))); });
self.addEventListener('activate', event => { event.waitUntil((async () => {
  // Only this app's cache prefix; do not erase another Pages project's caches.
  for (const key of await caches.keys()) if (key.startsWith('code-design-v1.') && key !== VERSION) await caches.delete(key);
  await self.clients.claim();
})()); });
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !URLS.has(event.request.url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try { const response = await fetch(event.request); if (response.ok && response.type !== 'opaque') await cache.put(event.request, response.clone()); return response; }
    catch { return await cache.match(event.request) || new Response('Offline resource unavailable.', { status: 503 }); }
  })());
});
