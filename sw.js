// YID PLUS Service Worker v7
const CACHE_NAME = 'yidplus-v9';
const CACHE_CSS  = 'yidplus-css-v8';
const CACHE_JS   = 'yidplus-js-v1';

// HTML and API — always fresh. HTML is what points at the current build, so it
// must never be stale; API responses are live data.
//
// .js used to be on this list, from back when a deploy could leave you looking
// at the old app. It isn't the fix any more and it costs a great deal: every
// script now carries ?v=<build>, so a new deploy is a NEW URL and a cached copy
// can't go stale — but the worker was still pulling ~550KB over the network on
// every single page load, which also quietly cancelled out the immutable
// Cache-Control headers. Versioned scripts are cached below instead.
const NEVER_CACHE = ['.html', '/api/'];

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
        keys.filter(function (k) { return k !== CACHE_CSS && k !== CACHE_NAME && k !== CACHE_JS; })
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

  // HTML page loads (including clean URLs like /yidplus-admin that have no
  // ".html" in them) — ALWAYS go to the network so a new deploy shows up right
  // away. Fall back to any cached copy only when offline. This is the fix for
  // "I deployed but still see the old app / have to hard-refresh".
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(function () {
        return caches.match(e.request).then(function (c) {
          return c || new Response('Offline', { status: 503 });
        });
      })
    );
    return;
  }

  // Never cache JS, HTML, API calls — always network
  if (NEVER_CACHE.some(function (p) { return path.includes(p) || url.includes(p); })) {
    e.respondWith(
      fetch(e.request).catch(function () {
        return new Response('Offline', { status: 503 });
      })
    );
    return;
  }

  // Versioned scripts — cache first. The ?v= is the build, so the URL changes
  // whenever the file does; there's nothing to go stale. An unversioned script
  // has no such guarantee, so it falls through to the network below.
  if (path.endsWith('.js') && new URL(url).searchParams.has('v')) {
    e.respondWith(
      caches.open(CACHE_JS).then(function (cache) {
        return cache.match(e.request).then(function (cached) {
          if (cached) return cached;
          return fetch(e.request).then(function (res) {
            if (res && res.status === 200) {
              cache.put(e.request, res.clone());
              // Each deploy is a new URL, so without this the cache would grow
              // by the whole bundle every time and never let go. Drop older
              // builds of this same file.
              cache.keys().then(function (keys) {
                keys.forEach(function (k) {
                  var ku = new URL(k.url);
                  if (ku.pathname === path && k.url !== url) cache.delete(k);
                });
              });
            }
            return res;
          });
        });
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
