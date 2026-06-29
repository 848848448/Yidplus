// YID PLUS Service Worker v5 — Optimized Caching
const CACHE_NAME = 'yidplus-v5';
const CACHE_CSS  = 'yidplus-css-v5';

// Static assets to pre-cache
const PRECACHE = ['/css/style.css'];

// ── INSTALL ──
self.addEventListener('install', function(e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_CSS).then(function(cache) {
      return cache.addAll(PRECACHE).catch(function() {});
    })
  );
});

// ── ACTIVATE ──
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_CSS && k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// ── FETCH ──
self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // NEVER cache: HTML, JS, API calls
  if (url.includes('.html') ||
      url.includes('.js') ||
      url.includes('/api/') ||
      e.request.method !== 'GET') {
    e.respondWith(fetch(e.request).catch(function() { return caches.match(e.request); }));
    return;
  }

  // CSS — cache first, revalidate in background
  if (url.includes('.css')) {
    e.respondWith(
      caches.open(CACHE_CSS).then(function(cache) {
        return cache.match(e.request).then(function(cached) {
          var fetchPromise = fetch(e.request).then(function(res) {
            if (res && res.status === 200) cache.put(e.request, res.clone());
            return res;
          });
          return cached || fetchPromise;
        });
      })
    );
    return;
  }

  // Images & media from R2 — cache aggressively (immutable)
  if (url.includes('r2.cloudflarestorage.com') ||
      url.includes('/images/') ||
      url.match(/\.(png|jpg|jpeg|gif|webp|svg|ico)$/)) {
    e.respondWith(
      caches.open(CACHE_NAME).then(function(cache) {
        return cache.match(e.request).then(function(cached) {
          if (cached) return cached;
          return fetch(e.request).then(function(res) {
            if (res && res.status === 200) cache.put(e.request, res.clone());
            return res;
          });
        });
      })
    );
    return;
  }

  // Everything else — network first
  e.respondWith(
    fetch(e.request).catch(function() { return caches.match(e.request); })
  );
});

// ── PUSH ──
self.addEventListener('push', function(e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch(err) {}
  e.waitUntil(
    self.registration.showNotification(data.title || 'YID PLUS', {
      body:    data.body    || 'You have a new notification',
      icon:    data.icon    || '/images/logo.png',
      badge:   '/images/logo.png',
      tag:     data.tag     || 'yidplus',
      data:    { url: data.url || '/yidplus-dashboard.html' },
      vibrate: [200, 100, 200],
    })
  );
});

// ── NOTIFICATION CLICK ──
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/yidplus-dashboard.html';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(wins) {
      for (var i = 0; i < wins.length; i++) {
        if ('focus' in wins[i]) { wins[i].focus(); wins[i].postMessage({ type: 'notification_click', url: url }); return; }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
