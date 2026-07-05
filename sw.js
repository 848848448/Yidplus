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

// Show the actual OS/browser notification when a push arrives — without
// this handler, sendWebPush() on the server can succeed perfectly and the
// browser will still show nothing at all (no banner, no sound, no
// vibration), since displaying it is entirely the service worker's job.
self.addEventListener('push', function (event) {
  var data = { title: 'YID PLUS', body: 'You have a new notification', url: '/chat' };
  try { if (event.data) data = Object.assign(data, event.data.json()); } catch (e) {}

  var options = {
    body: data.body,
    icon: data.icon || '/images/logo.png',
    badge: data.badge || '/images/logo.png',
    tag: data.tag || 'yidplus',
    data: { url: data.url || '/chat' },
    vibrate: [200, 100, 200],
    silent: false,
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Tapping the notification focuses an existing tab if one is open, or opens
// a new one to the relevant URL.
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var targetUrl = (event.notification.data && event.notification.data.url) || '/chat';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
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
