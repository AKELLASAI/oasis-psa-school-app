// Oasis Pre School — offline support when the app is hosted on a website.
const CACHE = 'oasis-server-3';
const FILES = [
 "icons/apple-touch-icon.png",
 "icons/icon-192.png",
 "icons/icon-512.png",
 "img/homework.svg",
 "img/placeholder.svg",
 "index.html",
 "js/oasis-access.js",
 "js/oasis-client.js",
 "js/oasis-install.js",
 "js/oasis-shell.js",
 "logo.png",
 "manifest.json",
 "vendor/app.css",
 "vendor/chart.umd.min.js",
 "vendor/fontawesome.css",
 "vendor/qrcode.js"
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./'].concat(FILES))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // School records (/api/...) are never cached on the device; they always come from the server.
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.indexOf('/api/') === 0) return;
  // Latest version when online, saved copy when offline.
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
