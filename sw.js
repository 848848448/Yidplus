// YID PLUS Service Worker v8
const CACHE_NAME = 'yidplus-v12';
const CACHE_CSS  = 'yidplus-css-v9';
const CACHE_JS   = 'yidplus-js-v2';

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

function offlinePage() {
  return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline | YID PLUS</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;font:16px system-ui;background:#f2f5f9;color:#172337;padding:24px;box-sizing:border-box}main{width:min(100%,380px);background:#fff;padding:28px;border-radius:22px;box-sizing:border-box}p{line-height:1.6;color:#526277}a{color:#087c91;display:inline-block;padding:12px 0;font-weight:700}@media(prefers-color-scheme:dark){body{background:#101823;color:#edf3fa}main{background:#192432}p{color:#bdc9d7}a{color:#78d5e3}}</style><main><h1>You are offline</h1><p>Reconnect to load YID PLUS. Your messages and private media are not saved in the offline cache.</p><a href="/chat">Try again</a></main></html>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

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
  var targetUrl = '/chat';
  try {
    var requested = new URL((event.notification.data && event.notification.data.url) || '/chat', self.location.origin);
    if (requested.origin === self.location.origin && /^https?:$/.test(requested.protocol)) targetUrl = requested.href;
  } catch (e) {}

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
  var parsedUrl = new URL(url);
  var path = parsedUrl.pathname;
  // Never intercept writes, third-party traffic, or authenticated media.
  // Offline support must never persist private messages or signed media.
  if (e.request.method !== 'GET' || parsedUrl.origin !== self.location.origin) return;

  // HTML page loads (including clean URLs like /yidplus-admin that have no
  // ".html" in them) — ALWAYS go to the network so a new deploy shows up right
  // away. Fall back to any cached copy only when offline. This is the fix for
  // "I deployed but still see the old app / have to hard-refresh".
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(function () {
        return caches.match(e.request).then(function (c) {
          return c || offlinePage();
        });
      })
    );
    return;
  }

  // Never cache HTML documents. Real navigations are already handled above;
  // this also catches document requests that don't report mode 'navigate' but
  // still ask for text/html (e.g. some prefetches), so a cached page can't keep
  // loading an OLD ?v= script bundle after a deploy. Network-first either way.
  if ((e.request.headers.get('accept') || '').includes('text/html')) {
    e.respondWith(
      fetch(e.request).catch(function () {
        return caches.match(e.request).then(function (c) { return c || offlinePage(); });
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
              e.waitUntil(cache.put(e.request, res.clone()).catch(function () {}));
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
            if (res && res.status === 200) return cache.put(e.request, res.clone()).catch(function () {}).then(function () { return res; });
            return res;
          });
          if (cached) { e.waitUntil(networkFetch.catch(function () {})); return cached; }
          return networkFetch;
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
  e.respondWith(fetch(e.request).catch(function () { return new Response('Network unavailable. Please try again.', { status: 503, headers: { 'Cache-Control': 'no-store' } }); }));
});
