// YID PLUS Service Worker v6 — Force fresh files
const CACHE_NAME = 'yidplus-v6';
const CACHE_CSS  = 'yidplus-css-v6';

// JS and HTML — always fetch fresh (never cache)
const NEVER_CACHE = ['.js', '.html', '/api/'];

// CSS — cache with stale-while-revalidate
const CSS_PATTERNS = ['.css'];

// Static assets — cache aggressively
const IMMUTABLE = ['/images/', '/icons/', '.woff', '.woff2', '.ttf'];

self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_CSS && k !== CACHE_NAME; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var url = e.request.url;
  var path = new URL(url).pathname;

  // Never cache JS, HTML, API calls — always network
  if (NEVER_CACHE.some(function (p) { return path.includes(p) || url.includes(p); })) {
    e.respondWith(
      fetch(e.request).catch(function () {
        return new Response('Offline', { status: 503 });
      })
    );
    return;
  }

  // CSS — cache first, update in background
  if (CSS_PATTERNS.some(function (p) { return path.endsWith(p); })) {
    e.respondWith(
      caches.open(CACHE_CSS).then(function (cache) {
        return cache.match(e.request).then(function (cached) {
          var networkFetch = fetch(e.request).then(function (res) {
            if (res && res.status === 200) cache.put(e.request, res.clone());
            return res;
          });
          return cached || networkFetch;
        });
      })
    );
    return;
  }

  // Immutable assets — cache forever
  if (IMMUTABLE.some(function (p) { return path.includes(p); })) {
    e.respondWith(
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(e.request).then(function (cached) {
          return cached || fetch(e.request).then(function (res) {
            if (res && res.status === 200) cache.put(e.request, res.clone());
            return res;
          });
        });
      })
    );
    return;
  }

  // Everything else — network first
  e.respondWith(fetch(e.request).catch(function () { return caches.match(e.request); }));
});
