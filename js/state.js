// js/state.js
// ============================================================
// GLOBAL STATE MANAGER + CLOUDFLARE D1/R2 API CLIENT
// No Supabase. All data flows through /api/* Pages Functions,
// which use the D1 binding "DB" and R2 binding "MY_BUCKET".
// NO type="module" — everything attached to window.
// ============================================================

// ── CONFIG ──────────────────────────────────────────────
window.CONFIG = {
  OWNER_EMAIL: 'avrumy5872877@gmail.com',
  ADMIN_PIN:   '1234',
  API_BASE:    '/api',
  POLL_MS:     4000,        // chat/online polling interval
  PRESENCE_MS: 20000,       // how often we ping "I'm online"
};

window.ROLES = {
  member:       'member',
  adminLimited: 'admin_limited',
  adminSuper:   'admin_super',
};

// ── GLOBAL STATE ─────────────────────────────────────────
window.STATE = {
  user:        null,   // {id, email, nickname, role, isOwner, verified, photo}
  screen:      'auth',
  prevScreen:  'home',
  settings:    {},
  chats:       {},      // room_id -> {messages:[...], meta:{...}}
  onlineUsers: {},       // user_id -> last_seen
  pollers:     {},       // room_id -> interval id
};
window.APP = window.STATE; // alias for legacy code

// ============================================================
// API CLIENT — thin fetch wrapper
// ============================================================
// Smart in-memory cache for GET requests
var _apiCache = {};
var _apiCacheTTL = {};
var _apiInflight = {}; // dedup simultaneous requests

// Cache TTLs per endpoint type
function _cacheTTL(path) {
  if (path.includes('/chat/rooms')) return 15000;  // 15s — changes fast
  if (path.includes('/statuses'))   return 20000;  // 20s
  if (path.includes('/posts'))      return 20000;  // 20s
  if (path.includes('/shorts'))     return 30000;  // 30s
  if (path.includes('/channels'))   return 60000;  // 1 min
  if (path.includes('/broadcasts')) return 120000; // 2 min
  if (path.includes('/profile'))    return 60000;  // 1 min
  return 30000; // default 30s
}

window.api = {
  get: function (path, noCache) {
    var cacheKey = path;
    var now = Date.now();
    // Return cached if still fresh
    if (!noCache && _apiCache[cacheKey] && _apiCacheTTL[cacheKey] > now) {
      return Promise.resolve(_apiCache[cacheKey]);
    }
    // Dedup: if same request is already inflight, wait for it
    if (_apiInflight[cacheKey]) {
      return _apiInflight[cacheKey];
    }
    var promise = fetch(CONFIG.API_BASE + path, { credentials: 'include' })
      .then(handleRes)
      .then(function (data) {
        _apiCache[cacheKey] = data;
        _apiCacheTTL[cacheKey] = now + _cacheTTL(path);
        delete _apiInflight[cacheKey];
        return data;
      })
      .catch(function (err) {
        delete _apiInflight[cacheKey];
        throw err;
      });
    _apiInflight[cacheKey] = promise;
    return promise;
  },
  // Invalidate cache for a path
  bust: function (path) {
    delete _apiCache[path];
    delete _apiCacheTTL[path];
    delete _apiInflight[path];
  },
  post: function (path, body, isForm) {
    var opts = { method: 'POST', credentials: 'include' };
    if (isForm) {
      opts.body = body;
    } else {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    // Bust cache on mutation
    api.bust(path.split('?')[0]);
    return fetch(CONFIG.API_BASE + path, opts).then(handleRes);
  },
  put: function (path, body, isForm) {
    var opts = { method: 'PUT', credentials: 'include' };
    if (isForm) {
      opts.body = body;
    } else {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    api.bust(path.split('?')[0]);
    return fetch(CONFIG.API_BASE + path, opts).then(handleRes);
  },
  del: function (path) {
    api.bust(path.split('?')[0]);
    return fetch(CONFIG.API_BASE + path, { method: 'DELETE', credentials: 'include' })
      .then(handleRes);
  },
};

function handleRes(res) {
  return res.text().then(function (raw) {
    var data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (parseErr) {
      // Server returned something that isn't JSON at all — most likely a
      // Cloudflare-level error page (404 route not found, 500 worker crash,
      // or a redirect) rather than a response from our own API code.
      var err = new Error(
        'Server error (HTTP ' + res.status + '): the API did not return a valid response. ' +
        'This usually means the endpoint file is missing or misnamed on the server.'
      );
      err.status = res.status;
      err.raw = raw;
      throw err;
    }

    if (!res.ok || data.ok === false) {
      var err2 = new Error(data.error || ('HTTP ' + res.status));
      err2.status = res.status;
      err2.data = data;
      throw err2;
    }
    return data;
  });
}

// ============================================================
// UTILITIES
// ============================================================
window.showSplash = function () {
  var el = document.getElementById('splash-overlay');
  if (el) el.classList.add('show');
};
window.hideSplash = function () {
  var el = document.getElementById('splash-overlay');
  if (el) el.classList.remove('show');
};

window.toast = function (msg, ms) {
  var el = document.getElementById('app-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(function () { el.classList.remove('show'); }, ms || 2400);
};

window.escHtml = function (s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

// Telegram-style: every user gets a consistent color derived from their id/name,
// instead of every avatar being flat gray or identical blue.
var _AV_PALETTE = [
  ['#FF6B6B', '#EE5253'], ['#FF9F43', '#EE8B2F'], ['#FECA57', '#E8B23D'],
  ['#1DD1A1', '#10AC84'], ['#54A0FF', '#2E86DE'], ['#5F72FF', '#4834D4'],
  ['#A55EEA', '#8854D0'], ['#FD79A8', '#E84393'], ['#26C6DA', '#00ACC1'],
];
window.avatarColor = function (seed) {
  var s = String(seed || '?');
  var h = 0;
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  var pair = _AV_PALETTE[h % _AV_PALETTE.length];
  return 'linear-gradient(135deg,' + pair[0] + ',' + pair[1] + ')';
};

window.fmtN = function (n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
};

window.nowTime = function () {
  return new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false });
};

window.timeAgo = function (iso) {
  var d = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (d < 60)    return d + 's';
  if (d < 3600)  return Math.floor(d / 60) + 'm';
  if (d < 86400) return Math.floor(d / 3600) + 'h';
  return Math.floor(d / 86400) + 'd';
};

window.validEmail = function (e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
};

window.setLoad = function (prefix, on) {
  var b = document.getElementById(prefix + '-btn');
  var t = document.getElementById(prefix + '-txt');
  var d = document.getElementById(prefix + '-dots');
  if (b) b.disabled = on;
  if (t) t.style.display = on ? 'none' : 'inline';
  if (d) d.style.display = on ? 'flex' : 'none';
};

// ============================================================
// ROUTER
// ============================================================
window.navTo = function (id) {
  var prev = STATE.screen;
  var nextEl = document.getElementById('screen-' + id);

  // Multi-page safety: if this screen doesn't exist on the current page
  // (e.g. stale 'yp_page' from another page), fall back to 'home'.
  if (!nextEl) {
    id = 'home';
    nextEl = document.getElementById('screen-home');
    if (!nextEl) return; // this page has no 'home' screen either — nothing to do
  }

  STATE.prevScreen = prev;
  STATE.screen = id;
  if (id !== 'auth') localStorage.setItem('yp_page', id);

  document.querySelectorAll('.screen').forEach(function (s) {
    s.classList.remove('active', 'prev');
  });
  var prevEl = document.getElementById('screen-' + prev);
  if (prevEl) {
    prevEl.classList.add('prev');
    setTimeout(function () { prevEl.classList.remove('prev'); }, 350);
  }
  nextEl.classList.add('active');

  // Hide the channel topbar overlay when leaving the channel screen
  if (id !== 'channel') {
    var tb = document.getElementById('channel-topbar-fixed');
    if (tb) tb.style.display = 'none';
  }

  // Settings screen — build full page
  if (id === 'settings' && typeof buildSettingsPage === 'function') {
    buildSettingsPage();
  }

  document.querySelectorAll('.nav-item').forEach(function (b) {
    b.classList.toggle('active', b.dataset.nav === id);
  });

  var fn = window['init_' + id];
  if (typeof fn === 'function') fn();
};

// Cross-page navigation (multi-page architecture: dashboard/chat/music/shorts/admin)
window.goPage = function (page) {
  // Create a full-screen fade overlay so the page transition looks smooth
  var fade = document.createElement('div');
  fade.style.cssText = 'position:fixed;inset:0;background:var(--bg,#fff);z-index:99999;opacity:0;transition:opacity .18s ease;pointer-events:all';
  document.body.appendChild(fade);
  requestAnimationFrame(function () {
    fade.style.opacity = '1';
    setTimeout(function () {
      window.location.href = page;
    }, 180);
  });
};

// ============================================================
// ROLE / PERMISSION HELPERS
// ============================================================
// window.ADMIN_GATE_SESSION is set by admin.js after a successful
// email+PIN gate unlock: { email, role }. When present, these helpers
// trust THAT verified identity over STATE.user — this matters because
// ── OWNER EMAILS (hardcoded, cannot be changed) ──
var OWNER_EMAILS_LIST = ['avrumy5872877@gmail.com', 'Jmittelman2@gmail.com'];

window.isOwner = function () {
  var email = window.ADMIN_GATE_SESSION
    ? window.ADMIN_GATE_SESSION.email
    : (STATE.user && STATE.user.email);
  return !!(email && OWNER_EMAILS_LIST.includes(email));
};
window.isSuperAdmin = function () {
  if (window.ADMIN_GATE_SESSION) {
    return isOwner() || window.ADMIN_GATE_SESSION.role === 'admin_super';
  }
  return !!(STATE.user && (STATE.user.role === 'admin_super' || isOwner()));
};
window.isAnyAdmin = function () {
  var gateSess = window.ADMIN_GATE_SESSION;
  if (gateSess) {
    return isOwner() ||
      gateSess.role === 'admin_super' ||
      gateSess.role === 'admin_limited';
  }
  return !!(STATE.user && (
    STATE.user.role === 'admin_super' ||
    STATE.user.role === 'admin_limited' ||
    isOwner()
  ));
};
window.userCan = function (action) {
  if (!STATE.user && !window.ADMIN_GATE_SESSION) return false;
  switch (action) {
    case 'delete_content': return isAnyAdmin();
    case 'view_pii':       return isOwner();           // ONLY Owner/Co-Owner see email/phone/password
    case 'manage_users':   return isSuperAdmin();       // verify / role changes
    case 'block_users':    return isAnyAdmin();         // Moderators + Super Admins can block
    case 'broadcast':      return isSuperAdmin();
    case 'promote_users':  return isOwner();            // ONLY Owner/Co-Owner can make admins
    case 'edit_settings':  return isSuperAdmin();
    case 'view_audit_logs': return isSuperAdmin();
    case 'view_private_dms': return isOwner();          // ONLY Owner/Co-Owner see private DMs
    case 'nuclear':        return isOwner();
    case 'export_data':    return isOwner();
    default:                return false;
  }
};
window.applyRoleUI = function () {
  if (!STATE.user) return;
  document.querySelectorAll('[data-role="admin"]').forEach(function (el) {
    el.style.display = isAnyAdmin() ? '' : 'none';
  });
  document.querySelectorAll('[data-role="super"]').forEach(function (el) {
    el.style.display = isSuperAdmin() ? '' : 'none';
  });
  document.querySelectorAll('[data-role="owner"]').forEach(function (el) {
    el.style.display = isOwner() ? '' : 'none';
  });
  document.querySelectorAll('.user-nickname-display').forEach(function (el) {
    el.textContent = '@' + (STATE.user.nickname || (STATE.user.email || '').split('@')[0]);
  });
};

// ============================================================
// AUTH (cookie-session based — see /api/auth.js)
// ============================================================
window.AUTH = {
  // Restore session on page load
  restore: function () {
    return api.get('/auth/me').then(function (res) {
      STATE.user = res.user;
      Presence.start();
      return res.user;
    }).catch(function () {
      STATE.user = null;
      return null;
    });
  },

  // Generate a simple browser fingerprint
  _fingerprint: function () {
    try {
      var nav = window.navigator;
      var parts = [
        nav.userAgent,
        nav.language,
        screen.width + 'x' + screen.height,
        screen.colorDepth,
        new Date().getTimezoneOffset(),
        nav.hardwareConcurrency || '',
        nav.platform || '',
      ];
      var str = parts.join('|');
      // Simple hash
      var hash = 0;
      for (var i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
      }
      return 'fp_' + Math.abs(hash).toString(16);
    } catch (e) { return ''; }
  },

  login: function (email, password) {
    return api.post('/auth/login', { email: email, password: password, fingerprint: AUTH._fingerprint() })
      .then(function (res) {
        STATE.user = res.user;
        Presence.start();
        return res.user;
      });
  },

  register: function (data) {
    data.fingerprint = AUTH._fingerprint();
    return api.post('/auth/register', data).then(function (res) {
      STATE.user = res.user;
      Presence.start();
      return res.user;
    });
  },

  logout: function () {
    Presence.stop();
    return api.post('/auth/logout', {}).then(function () {
      STATE.user = null;
    });
  },
};

// ============================================================
// PRESENCE — WhatsApp-style "online now" + "last seen"
// ============================================================
window.Presence = {
  _timer: null,

  start: function () {
    Presence.ping();
    clearInterval(Presence._timer);
    Presence._timer = setInterval(Presence.ping, CONFIG.PRESENCE_MS);
    document.addEventListener('visibilitychange', Presence._onVis);
  },

  stop: function () {
    clearInterval(Presence._timer);
    document.removeEventListener('visibilitychange', Presence._onVis);
  },

  _onVis: function () {
    if (document.visibilityState === 'visible') Presence.ping();
  },

  ping: function () {
    if (!STATE.user) return;
    api.post('/presence', { online: document.visibilityState === 'visible' })
      .catch(function () {});
  },

  // fetch online status for a list of user ids
  fetchFor: function (userIds) {
    if (!userIds || !userIds.length) return Promise.resolve({});
    return api.post('/presence/lookup', { ids: userIds }).then(function (res) {
      STATE.onlineUsers = Object.assign(STATE.onlineUsers, res.online || {});
      return STATE.onlineUsers;
    }).catch(function () { return {}; });
  },
};

// ============================================================
// CHAT STATE — message delivery + realtime-ish polling
// ============================================================
window.ChatState = {
  // Load message history for a room
  loadRoom: function (roomId) {
    return api.get('/chat?room_id=' + encodeURIComponent(roomId)).then(function (res) {
      STATE.chats[roomId] = STATE.chats[roomId] || { messages: [], meta: {} };
      STATE.chats[roomId].messages = res.messages || [];
      return STATE.chats[roomId].messages;
    });
  },

  // Send a text/sticker/voice message
  send: function (roomId, payload) {
    payload.room_id = roomId;
    payload.sender_id = STATE.user.id;
    payload.sender_nick = STATE.user.nickname;
    return api.post('/chat', payload).then(function (res) {
      STATE.chats[roomId] = STATE.chats[roomId] || { messages: [], meta: {} };
      STATE.chats[roomId].messages.push(res.message);
      return res.message;
    });
  },

  // Send a message with a media file (photo/video/voice)
  sendMedia: function (roomId, file, type, extra) {
    var form = new FormData();
    form.append('room_id', roomId);
    form.append('sender_id', STATE.user.id);
    form.append('sender_nick', STATE.user.nickname);
    form.append('type', type || 'media');
    form.append('text', (extra && extra.text) || '');
    if (extra && extra.reply_to_id) form.append('reply_to_id', extra.reply_to_id);
    if (extra && extra.dur) form.append('dur', extra.dur);
    form.append('file', file);

    return api.post('/chat', form, true).then(function (res) {
      STATE.chats[roomId] = STATE.chats[roomId] || { messages: [], meta: {} };
      STATE.chats[roomId].messages.push(res.message);
      return res.message;
    });
  },

  deleteMessage: function (roomId, msgId) {
    return api.del('/chat?id=' + encodeURIComponent(msgId)).then(function () {
      var room = STATE.chats[roomId];
      if (room) room.messages = room.messages.filter(function (m) { return m.id !== msgId; });
    });
  },

  markRead: function (roomId) {
    return api.post('/chat/read', { room_id: roomId, user_id: STATE.user.id }).catch(function () {});
  },

  // Start polling a room for new messages (cheap "realtime")
  startPolling: function (roomId, onUpdate) {
    ChatState.stopPolling(roomId);
    STATE.pollers[roomId] = setInterval(function () {
      var lastId = (STATE.chats[roomId] && STATE.chats[roomId].messages.length)
        ? STATE.chats[roomId].messages[STATE.chats[roomId].messages.length - 1].id
        : null;

      ChatState.loadRoom(roomId).then(function (messages) {
        if (typeof onUpdate === 'function') onUpdate(messages, lastId);
      }).catch(function () {});
    }, CONFIG.POLL_MS);
  },

  stopPolling: function (roomId) {
    if (STATE.pollers[roomId]) {
      clearInterval(STATE.pollers[roomId]);
      delete STATE.pollers[roomId];
    }
  },

  stopAllPolling: function () {
    Object.keys(STATE.pollers).forEach(ChatState.stopPolling);
  },
};

// ============================================================
// MEDIA HELPERS (R2 via /api/media)
// ============================================================
window.Media = {
  // Returns the public-ish URL for a stored R2 key
  urlFor: function (key) {
    if (!key) return '';
    return CONFIG.API_BASE + '/media/' + encodeURIComponent(key);
  },

  // Generic upload helper -> returns { key, url }
  upload: function (file, folder) {
    var form = new FormData();
    form.append('file', file);
    form.append('folder', folder || 'misc');
    return api.post('/upload', form, true);
  },
};

// ============================================================
// APP SETTINGS (key/value table in D1)
// ============================================================
window.loadAppSettings = function () {
  return api.get('/settings').then(function (res) {
    STATE.settings = res.settings || {};
    applyAppSettings();
    return STATE.settings;
  }).catch(function () { return {}; });
};

window.applyAppSettings = function () {
  var s = STATE.settings;
  if (s.app_title) {
    document.querySelectorAll('.app-title-display').forEach(function (el) { el.textContent = s.app_title; });
    document.title = s.app_title;
  }
  if (s.logo_url) {
    var logoImg = document.getElementById('topbar-logo-img');
    var logoFallback = document.getElementById('topbar-logo-fallback');
    if (logoImg) {
      logoImg.src = s.logo_url;
      logoImg.style.display = 'inline-block';
    }
    if (logoFallback) logoFallback.style.display = 'none';
  }
  if (s.primary_color) document.documentElement.style.setProperty('--gold', s.primary_color);
  if (s.gold_light)    document.documentElement.style.setProperty('--gold-l', s.gold_light);
  ['home','shorts','music','chats','settings'].forEach(function (k) {
    if (s['nav_' + k]) {
      document.querySelectorAll('[data-nav-label="' + k + '"]').forEach(function (el) {
        el.textContent = s['nav_' + k];
      });
    }
  });
};

window.saveSetting = function (key, value) {
  return api.put('/settings', { key: key, value: value }).then(function () {
    STATE.settings[key] = value;
    applyAppSettings();
    toast('✅ Setting saved!');
  }).catch(function (err) {
    toast('❌ ' + err.message);
  });
};

// ============================================================
// NIGHT THEME
// ============================================================
window.applyNightTheme = function () {
  var h = new Date().getHours();
  var auto = STATE.settings.auto_night !== 'false';
  if (auto) document.body.classList.toggle('night', h >= 19 || h < 7);
};
applyNightTheme();
setInterval(applyNightTheme, 60000);

// ============================================================
// MISC
// ============================================================
window.openChannel = function (ownerId) {
  if (!ownerId) return toast('⚠ Channel unavailable.');
  STATE.prevScreen = STATE.screen;
  CHANNEL_pendingOwnerId = ownerId;
  navTo('channel');
};

document.addEventListener('click', function (e) {
  var ctx = document.getElementById('ctx-menu');
  var chMenu = document.getElementById('ch-options-menu');
  var attach = document.getElementById('attach-sheet');
  if (ctx && !ctx.contains(e.target)) ctx.classList.remove('open');
  if (chMenu && !chMenu.contains(e.target) && !e.target.closest('[onclick*="openChannelOptions"]')) chMenu.classList.remove('open');
  var clickedInsideAttach = e.target.closest('.attach-wrap') || e.target.closest('#attach-sheet') || e.target.closest('.chat-attach-circle');
  if (attach && !clickedInsideAttach) {
    attach.classList.remove('open');
  }
});

// Stop pollers when leaving the page
window.addEventListener('beforeunload', function () {
  ChatState.stopAllPolling();
  Presence.stop();
});

console.log('[YID PLUS] state.js loaded — Cloudflare D1/R2 mode ✓ — build v2026-06-21-handleRes-fix');

/* ══════════════════════════════════
   PWA + PUSH NOTIFICATIONS
══════════════════════════════════ */
window.PWA = {
  // Register service worker
  init: function () {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js')
      .then(function (reg) {
        window.PWA._swReg = reg;
        // Listen for messages from SW
        navigator.serviceWorker.addEventListener('message', function (e) {
          if (e.data && e.data.type === 'notification_click' && e.data.url) {
            goPage(e.data.url);
          }
        });
      })
      .catch(function (err) { console.warn('[PWA] SW registration failed:', err); });
  },

  // Ask user for push permission + subscribe
  requestPush: function () {
    if (!('Notification' in window)) {
      toast('Your browser does not support notifications');
      return Promise.reject('no support');
    }
    if (Notification.permission === 'denied') {
      toast('Notifications are blocked. Enable them in browser settings.');
      return Promise.reject('denied');
    }
    return Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') {
        toast('Notifications not enabled');
        return;
      }
      return PWA._subscribePush();
    });
  },

  _subscribePush: function () {
    var reg = window.PWA._swReg;
    if (!reg) return Promise.reject('No SW registration');

    // VAPID public key (replace with your own from https://vapidkeys.com)
    var VAPID_PUBLIC = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';

    return reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: PWA._urlBase64ToUint8Array(VAPID_PUBLIC),
    }).then(function (sub) {
      return api.post('/push/subscribe', sub.toJSON());
    }).then(function () {
      toast('🔔 Notifications enabled!');
    }).catch(function (err) {
      console.warn('[PWA] Push subscribe failed:', err);
      toast('Could not enable notifications');
    });
  },

  // Unsubscribe
  disablePush: function () {
    var reg = window.PWA._swReg;
    if (!reg) return;
    reg.pushManager.getSubscription().then(function (sub) {
      if (sub) sub.unsubscribe();
    });
    api.del('/push/subscribe').catch(function () {});
    toast('🔕 Notifications disabled');
  },

  // Check current permission
  isPushEnabled: function () {
    return 'Notification' in window && Notification.permission === 'granted';
  },

  // Convert VAPID key
  _urlBase64ToUint8Array: function (base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var rawData = window.atob(base64);
    var outputArray = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; ++i) { outputArray[i] = rawData.charCodeAt(i); }
    return outputArray;
  },

  // Show "Add to Home Screen" prompt
  _deferredPrompt: null,
  initInstallPrompt: function () {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      window.PWA._deferredPrompt = e;
      // Show install button if available
      var btn = document.getElementById('pwa-install-btn');
      if (btn) btn.style.display = 'flex';
    });
    window.addEventListener('appinstalled', function () {
      var btn = document.getElementById('pwa-install-btn');
      if (btn) btn.style.display = 'none';
      toast('✅ YID PLUS installed!');
    });
  },

  install: function () {
    var prompt = window.PWA._deferredPrompt;
    if (!prompt) {
      toast('Open in browser menu → "Add to Home Screen"');
      return;
    }
    prompt.prompt();
    prompt.userChoice.then(function (result) {
      if (result.outcome === 'accepted') toast('Installing YID PLUS...');
      window.PWA._deferredPrompt = null;
    });
  },
};

// Auto-init PWA
(function () {
  PWA.init();
  PWA.initInstallPrompt();
})();

/* ══════════════════════════════════
   LAZY IMAGE FADE-IN
══════════════════════════════════ */
(function () {
  // Observe all lazy images and add .loaded when they load
  function observeLazyImages() {
    document.querySelectorAll('img[loading="lazy"]').forEach(function (img) {
      if (img._lazyObserved) return;
      img._lazyObserved = true;
      img.addEventListener('load', function () {
        img.classList.add('loaded');
      });
      if (img.complete && img.naturalWidth > 0) {
        img.classList.add('loaded');
      }
    });
  }

  // Run on DOM mutations
  var observer = new MutationObserver(function () {
    observeLazyImages();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  observeLazyImages();
})();

/* ══════════════════════════════════
   AUTO DARK MODE — לויט סיסטעם
══════════════════════════════════ */
(function () {
  // Only auto-apply if user hasn't manually set it
  try {
    var manual = localStorage.getItem('yp_dark_mode');
    if (manual === null && window.matchMedia) {
      var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (prefersDark) document.documentElement.classList.add('dark-mode');

      // Listen for changes
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
        var hasManual = localStorage.getItem('yp_dark_mode');
        if (hasManual === null) {
          document.documentElement.classList.toggle('dark-mode', e.matches);
        }
      });
    } else if (manual === '1') {
      document.documentElement.classList.add('dark-mode');
    }
  } catch (e) {}
})();

/* ══════════════════════════════════
   HAPTIC FEEDBACK
══════════════════════════════════ */
window.haptic = function (type) {
  if (!navigator.vibrate) return;
  if (type === 'light')  navigator.vibrate(10);
  if (type === 'medium') navigator.vibrate(25);
  if (type === 'heavy')  navigator.vibrate([30, 10, 30]);
  if (type === 'error')  navigator.vibrate([50, 20, 50, 20, 50]);
};

/* ══════════════════════════════════
   CONTENT FILTER — BAD WORDS
   Blurs bad words in all text content
   Warns user when typing them
══════════════════════════════════ */
var FILTER_words = [];
var FILTER_regex = null;
var FILTER_loaded = false;
var FILTER_warned = {}; // track which words we already warned about

var FILTER_phrases = [];
var FILTER_phrase_regex = null;

// Load bad words + phrases from server (cached)
window.loadContentFilter = function () {
  if (FILTER_loaded) return;
  api.get('/admin/bad-words?public=1', true)
    .then(function (res) {
      // Single words
      FILTER_words = (res.words || []).map(function (w) { return w.toLowerCase(); });
      if (FILTER_words.length) {
        var escaped = FILTER_words.map(function (w) {
          return '\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b';
        });
        FILTER_regex = new RegExp('(' + escaped.join('|') + ')', 'gi');
      }
      // Multi-word phrases
      FILTER_phrases = (res.phrases || []).map(function (p) { return p.toLowerCase(); });
      if (FILTER_phrases.length) {
        var escapedPhrases = FILTER_phrases.map(function (p) {
          return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        });
        FILTER_phrase_regex = new RegExp('(' + escapedPhrases.join('|') + ')', 'gi');
      }
      FILTER_loaded = true;
    })
    .catch(function () {});
};

// Apply blur to bad words in a string of HTML
window.filterContent = function (html) {
  if (!html) return html;
  // Apply phrase filter first (multi-word — more specific)
  if (FILTER_phrase_regex && FILTER_phrases.length) {
    html = html.replace(FILTER_phrase_regex, function (match) {
      return '<span class="blurred-word" title="Filtered content" onclick="this.style.filter=\'none\'">' + match + '</span>';
    });
  }
  // Apply single word filter
  if (FILTER_regex && FILTER_words.length) {
    html = html.replace(FILTER_regex, function (match) {
      return '<span class="blurred-word" title="Filtered content" onclick="this.style.filter=\'none\'">' + match + '</span>';
    });
  }
  return html;
};

// Check text being typed — warn if bad word detected
var FILTER_warnTimer = null;
window.checkInputForBadWords = function (text) {
  if (!text) return;
  clearTimeout(FILTER_warnTimer);
  FILTER_warnTimer = setTimeout(function () {
    var match = null;
    // Check phrases first
    if (FILTER_phrase_regex) match = text.match(FILTER_phrase_regex);
    // Then single words
    if (!match && FILTER_regex) match = text.match(FILTER_regex);
    if (match) {
      var word = match[0].toLowerCase();
      if (!FILTER_warned[word]) {
        FILTER_warned[word] = true;
        _showFilterWarning(match[0]);
        setTimeout(function () { delete FILTER_warned[word]; }, 10000);
      }
    }
  }, 500);
};

function _showFilterWarning(word) {
  // Remove existing warning
  var existing = document.getElementById('filter-warning-toast');
  if (existing) existing.remove();

  var el = document.createElement('div');
  el.id = 'filter-warning-toast';
  el.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);z-index:9999;background:#DC2626;color:#fff;padding:.6rem 1.1rem;border-radius:12px;font-size:.82rem;font-weight:600;box-shadow:0 4px 16px rgba(220,38,38,.4);display:flex;align-items:center;gap:.5rem;max-width:calc(100vw - 2rem);text-align:center';
  el.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
    '⚠️ This word is not allowed on YID PLUS';
  document.body.appendChild(el);
  setTimeout(function () { if (el.parentElement) el.remove(); }, 4000);
}

// Apply filter to element's innerHTML
window.filterElement = function (el) {
  if (!el || !FILTER_regex) return;
  // Find all text nodes and apply blur
  var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  var nodesToProcess = [];
  var node;
  while ((node = walker.nextNode())) {
    if (FILTER_regex.test(node.textContent)) {
      nodesToProcess.push(node);
    }
  }
  nodesToProcess.forEach(function (textNode) {
    var wrapper = document.createElement('span');
    wrapper.innerHTML = filterContent(escHtml(textNode.textContent));
    textNode.parentNode.replaceChild(wrapper, textNode);
  });
};

// Auto-load on startup
(function () {
  setTimeout(function () { loadContentFilter(); }, 2000);
})();

/* ══════════════════════════════════
   GUEST MODE
   When enabled: users can browse but
   cannot post, like, comment, chat,
   or take any action without signing in.
══════════════════════════════════ */
var GUEST_MODE = false;
window.GUEST_MODE = false;

// Load guest mode status on startup
window._loadGuestMode = function () {
  fetch(CONFIG.API_BASE + '/admin/guest-mode')
    .then(function (r) { return r.json(); })
    .then(function (res) {
      GUEST_MODE = !!(res && res.enabled);
      if (GUEST_MODE) _applyGuestMode();
    })
    .catch(function () {});
};

// Apply guest mode UI
window._applyGuestMode = function _applyGuestMode() {
  if (!STATE.user) {
    // Show login button in nav
    _addNavLoginBtn();
    // Intercept all interactive elements
    _interceptGuestActions();
  }
}

function _addNavLoginBtn() {
  // Add "Sign In" button in topbar if not already there
  var existing = document.getElementById('guest-login-btn');
  if (existing) return;

  var topbar = document.querySelector('.topbar');
  if (!topbar) return;

  var btn = document.createElement('button');
  btn.id = 'guest-login-btn';
  btn.onclick = _showGuestLoginPopup;
  btn.style.cssText = 'padding:.35rem .9rem;background:linear-gradient(135deg,#1565C0,#1976D2);color:#fff;border:none;border-radius:20px;font-size:.78rem;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:.3rem;white-space:nowrap';
  btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>Sign In';
  topbar.appendChild(btn);
}

// Show login popup
window._showGuestLoginPopup = function (msg) {
  var existing = document.getElementById('guest-login-popup');
  if (existing) { existing.remove(); return; }

  var overlay = document.createElement('div');
  overlay.id = 'guest-login-popup';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:1.5rem';
  overlay.innerHTML =
    '<div style="background:var(--surface);border-radius:20px;padding:2rem 1.5rem;width:100%;max-width:340px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.3)">' +
      '<div style="font-size:2.5rem;margin-bottom:.75rem">✡️</div>' +
      '<div style="font-size:1.1rem;font-weight:800;margin-bottom:.4rem">YID PLUS</div>' +
      '<div style="font-size:.85rem;color:var(--muted);margin-bottom:1.25rem;line-height:1.5">' +
        (msg || 'Sign in to interact with the YID PLUS community') +
      '</div>' +
      '<button onclick="goPage(\'index.html\')" style="width:100%;padding:.75rem;background:linear-gradient(135deg,#1565C0,#1976D2);color:#fff;border:none;border-radius:14px;font-size:.95rem;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:.5rem;display:flex;align-items:center;justify-content:center;gap:.5rem">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>' +
        'Sign In' +
      '</button>' +
      '<button onclick="this.closest(\'div[style*=fixed]\').remove()" style="width:100%;padding:.6rem;background:var(--bg3);border:none;border-radius:14px;font-size:.88rem;cursor:pointer;font-family:inherit;color:var(--muted)">Continue Browsing</button>' +
    '</div>';

  overlay.addEventListener('click', function(e){ if(e.target===overlay) overlay.remove(); });
  document.body.appendChild(overlay);
};

// Check if action is allowed — call before any user action
window.requireLogin = function (msg) {
  if (!GUEST_MODE) return true;  // guest mode off — always allowed
  if (STATE.user) return true;   // logged in — always allowed
  _showGuestLoginPopup(msg || 'Sign in to do this');
  return false;
};

// Intercept guest actions via event delegation
function _interceptGuestActions() {
  // Intercept form submissions and action buttons
  document.addEventListener('click', function (e) {
    if (!GUEST_MODE || STATE.user) return;
    if (STATE.screen === 'auth') return; // never block clicks on the sign-in screen itself

    var target = e.target.closest('button, [onclick]');
    if (!target) return;

    var onclick = target.getAttribute('onclick') || '';
    var text = (target.textContent || '').toLowerCase().trim();

    // Never intercept sign-in/auth related actions
    if (onclick.includes('signInWithGoogle') || onclick.includes('doLogin') ||
        onclick.includes('doRegister') || onclick.includes('authTab')) {
      return;
    }

    // Things that should trigger login popup
    var actionPatterns = [
      'sendChatMsg', 'postToFeed', 'likePost', 'likeShort',
      'openNewChatModal', 'openNewGroupModal', 'openNewChannelModal',
      'submitComment', 'submitFeedback', 'followUser',
      'handleChatMedia', 'startRecord', 'toggleReaction',
      'heartTrack', 'sendStatus',
    ];

    var isAction = actionPatterns.some(function(p){ return onclick.includes(p); });
    // Also catch common action words in button text
    var actionWords = ['post', 'send', 'like', 'follow', 'comment', 'join', 'upload'];
    var isActionText = actionWords.some(function(w){ return text === w; });

    if (isAction || isActionText) {
      e.preventDefault();
      e.stopPropagation();
      _showGuestLoginPopup('Sign in to ' + (text || 'do this'));
    }
  }, true); // capture phase

  // Intercept text inputs
  document.addEventListener('focus', function (e) {
    if (!GUEST_MODE || STATE.user) return;
    if (STATE.screen === 'auth') return; // allow typing in login/register fields
    var tag = e.target.tagName;
    if (tag === 'TEXTAREA' || (tag === 'INPUT' && e.target.type !== 'search')) {
      e.target.blur();
      _showGuestLoginPopup('Sign in to write something');
    }
  }, true);
}

// Auto-load guest mode
(function () {
  setTimeout(function () { _loadGuestMode(); }, 500);
})();
