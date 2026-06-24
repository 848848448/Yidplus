// YID PLUS Service Worker — caches static assets for fast loading
const CACHE = 'yidplus-v1';
const STATIC = [
  '/css/style.css',
  '/js/state.js',
  '/js/home.js',
  '/js/chat.js',
  '/js/ads.js',
  '/js/auth.js',
  '/js/admin.js',
  '/images/logo.png',
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(STATIC); })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  var url = e.request.url;
  // Always go network for API calls
  if (url.includes('/api/')) { e.respondWith(fetch(e.request)); return; }
  // For everything else: cache-first
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      return cached || fetch(e.request).then(function (resp) {
        if (resp && resp.status === 200 && e.request.method === 'GET') {
          var clone = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, clone); });
        }
        return resp;
      });
    })
  );
});
