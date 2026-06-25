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
window.api = {
  get: function (path) {
    return fetch(CONFIG.API_BASE + path, { credentials: 'include' })
      .then(handleRes);
  },
  post: function (path, body, isForm) {
    var opts = { method: 'POST', credentials: 'include' };
    if (isForm) {
      opts.body = body; // FormData — browser sets content-type
    } else {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    return fetch(CONFIG.API_BASE + path, opts).then(handleRes);
  },
  put: function (path, body, isForm) {
    var opts = { method: 'PUT', credentials: 'include' };
    if (isForm) {
      opts.body = body; // FormData — browser sets content-type
    } else {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    return fetch(CONFIG.API_BASE + path, opts).then(handleRes);
  },
  del: function (path) {
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
// the gate intentionally allows unlocking with any authorized admin
// email, which may differ from whichever account the browser is
// currently logged into as a regular user.
window.isOwner = function () {
  if (window.ADMIN_GATE_SESSION) return window.ADMIN_GATE_SESSION.email === CONFIG.OWNER_EMAIL;
  return !!(STATE.user && STATE.user.email === CONFIG.OWNER_EMAIL);
};
window.isSuperAdmin = function () {
  if (window.ADMIN_GATE_SESSION) {
    return isOwner() || window.ADMIN_GATE_SESSION.role === 'admin_super';
  }
  return !!(STATE.user && (STATE.user.role === 'admin_super' || isOwner()));
};
window.isAnyAdmin = function () {
  if (window.ADMIN_GATE_SESSION) {
    return isOwner() ||
      window.ADMIN_GATE_SESSION.role === 'admin_super' ||
      window.ADMIN_GATE_SESSION.role === 'admin_limited';
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
    case 'view_pii':       return isSuperAdmin();
    case 'manage_users':   return isSuperAdmin();   // verify / promote / role changes
    case 'block_users':    return isAnyAdmin();      // Moderators + Super Admins can block
    case 'broadcast':      return isSuperAdmin();
    case 'promote_users':  return isOwner() || isSuperAdmin();
    case 'edit_settings':  return isSuperAdmin();
    case 'view_audit_logs': return isSuperAdmin();
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
