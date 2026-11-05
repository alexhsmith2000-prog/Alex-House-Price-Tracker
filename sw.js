// Offline support. Always asks the server for the latest files (bypassing the browser's own
// cache), and only falls back to the saved copies when offline. Bump VERSION with APP_VERSION.
const VERSION = 'nr-prices-12';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req.url, copy)); }
      return res;
    }).catch(() => caches.match(req.url, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
