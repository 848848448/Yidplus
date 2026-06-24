// YID PLUS Service Worker v3 — network-first, no caching of JS/HTML
// This prevents stale JS from breaking the app after updates

const CACHE_NAME = 'yidplus-static-v3';

self.addEventListener('install', function(e) {
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  // Clear ALL old caches on activation
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  var url = e.request.url;
  // Always go to network for HTML, JS, API calls
  if (url.includes('.html') || url.includes('.js') || url.includes('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }
  // Cache CSS and images only
  e.respondWith(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.match(e.request).then(function(cached) {
        return cached || fetch(e.request).then(function(resp) {
          if (resp && resp.status === 200) cache.put(e.request, resp.clone());
          return resp;
        });
      });
    })
  );
});
