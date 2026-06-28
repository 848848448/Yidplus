// YID PLUS Service Worker v4 — PWA + Push Notifications
const CACHE_NAME = 'yidplus-static-v4';
const STATIC_ASSETS = ['/css/style.css'];

// ── INSTALL ──
self.addEventListener('install', function(e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS).catch(function() {});
    })
  );
});

// ── ACTIVATE ──
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE_NAME; }).map(function(k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

// ── FETCH ──
self.addEventListener('fetch', function(e) {
  var url = e.request.url;
  // Always network-first for HTML, JS, API
  if (url.includes('.html') || url.includes('.js') || url.includes('/api/')) {
    e.respondWith(fetch(e.request).catch(function() { return caches.match(e.request); }));
    return;
  }
  // Cache-first for CSS + images
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      return cached || fetch(e.request).then(function(res) {
        if (res && res.status === 200) {
          var clone = res.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(e.request, clone); });
        }
        return res;
      });
    })
  );
});

// ── PUSH NOTIFICATION ──
self.addEventListener('push', function(e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch(err) {}

  var title   = data.title   || 'YID PLUS';
  var body    = data.body    || 'You have a new notification';
  var icon    = data.icon    || '/images/logo.png';
  var badge   = data.badge   || '/images/logo.png';
  var url     = data.url     || '/yidplus-dashboard.html';
  var tag     = data.tag     || 'yidplus-notif';

  e.waitUntil(
    self.registration.showNotification(title, {
      body:    body,
      icon:    icon,
      badge:   badge,
      tag:     tag,
      data:    { url: url },
      vibrate: [200, 100, 200],
      actions: data.actions || [],
    })
  );
});

// ── NOTIFICATION CLICK ──
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var targetUrl = (e.notification.data && e.notification.data.url) || '/yidplus-dashboard.html';

  if (e.action === 'reply') {
    // Open chat directly
    targetUrl = '/yidplus-chat.html';
  }

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(wins) {
      // If app is already open, focus it
      for (var i = 0; i < wins.length; i++) {
        var win = wins[i];
        if (win.url.includes('yidplus') && 'focus' in win) {
          win.focus();
          win.postMessage({ type: 'notification_click', url: targetUrl });
          return;
        }
      }
      // Otherwise open new window
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ── PUSH SUBSCRIPTION CHANGE ──
self.addEventListener('pushsubscriptionchange', function(e) {
  e.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true })
      .then(function(sub) {
        return fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sub.toJSON()),
          credentials: 'include',
        });
      })
  );
});
