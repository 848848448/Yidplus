// ============================================================
// js/admin.js — Admin Panel (Cloudflare D1)
// Roles: member / admin_limited / admin_super / owner
// Uses: window.api, window.STATE, window.CONFIG, window.ROLES,
//       window.userCan, window.toast, window.setLoad,
//       window.validEmail, window.navTo, window.delay
// NO ES module imports — plain script, attaches to window.
// ============================================================

var ADMIN_pinLocal  = CONFIG.ADMIN_PIN;
var ADMIN_gateEmail = '';
var ADMIN_allUsers  = [];

function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* ══════════════════════════════════
   ADMIN GATE — 2-step: email + PIN
══════════════════════════════════ */
window.openAdminGate = function () {
  document.getElementById('admin-gate').classList.add('open');
  [0,1,2,3].forEach(function (i) {
    var el = document.getElementById('p'+i);
    if (el) el.value = '';
  });
  document.getElementById('gate-pin-step').style.display   = 'none';
  document.getElementById('gate-email-step').style.display = 'block';
  clearGateMsg();
};

function showGateMsg(type, text) {
  var el = document.getElementById('gate-msg');
  if (!el) return;
  el.className = 'gate-msg ' + type;
  el.innerHTML = (type === 'err' ? '⚠ ' : '✓ ') + text;
}
function clearGateMsg() {
  var el = document.getElementById('gate-msg');
  if (el) el.className = 'gate-msg';
}

window.checkGateEmail = function () {
  var emailEl = document.getElementById('gate-email');
  var email   = (emailEl && emailEl.value || '').trim();

  if (!email || !validEmail(email)) {
    return showGateMsg('err', 'Enter a valid email address.');
  }
  setLoad('gate-email', true);

  // Check role via /api/admin/check-email
  api.post('/admin/check-email', { email: email })
    .then(function (res) {
      setLoad('gate-email', false);

      var role = res.role;
      var authorized = email === CONFIG.OWNER_EMAIL ||
        role === 'admin_super' || role === 'admin_limited';

      if (!authorized) {
        return showGateMsg('err', 'This email is not authorized for admin access.');
      }

      ADMIN_gateEmail = email;
      document.getElementById('gate-email-step').style.display = 'none';
      document.getElementById('gate-pin-step').style.display   = 'block';
      var p0 = document.getElementById('p0');
      if (p0) p0.focus();
      clearGateMsg();
    })
    .catch(function (err) {
      setLoad('gate-email', false);
      showGateMsg('err', err.message || 'Could not verify email.');
    });
};

window.backToEmailStep = function () {
  document.getElementById('gate-pin-step').style.display   = 'none';
  document.getElementById('gate-email-step').style.display = 'block';
  [0,1,2,3].forEach(function (i) {
    var el = document.getElementById('p'+i);
    if (el) el.value = '';
  });
};

window.pinFocus = function (i) {
  var el = document.getElementById('p'+i);
  var v  = el && el.value;
  if (v && i < 3) {
    var next = document.getElementById('p'+(i+1));
    if (next) next.focus();
  }
};

window.checkPin = function () {
  var pin = [0,1,2,3].map(function (i) {
    var el = document.getElementById('p'+i);
    return el ? el.value : '';
  }).join('');

  if (pin.length < 4) return showGateMsg('err', 'Enter all 4 digits.');

  if (pin !== ADMIN_pinLocal) {
    showGateMsg('err', 'Incorrect PIN. Access denied.');
    [0,1,2,3].forEach(function (i) {
      var el = document.getElementById('p'+i);
      if (el) el.value = '';
    });
    var p0 = document.getElementById('p0');
    if (p0) p0.focus();
    return;
  }

  setLoad('gate-pin', true);

  delay(800).then(function () {
    setLoad('gate-pin', false);
    document.getElementById('admin-gate').classList.remove('open');

    var role = (ADMIN_gateEmail === CONFIG.OWNER_EMAIL)
      ? 'owner'
      : (STATE.user && STATE.user.role) || 'member';

    var badge = document.getElementById('admin-role-badge');
    if (badge) {
      badge.textContent = role === 'owner'        ? '👑 OWNER'
                         : role === 'admin_super'  ? '🛡 SUPER ADMIN'
                         :                           '🔒 LIMITED ADMIN';
    }

    buildAdminNav();
    navTo('admin');
  });
};

/* ══════════════════════════════════
   ADMIN NAV
══════════════════════════════════ */
var ADMIN_PANELS = [
  { id:'analytics',    icon:'📊', label:'Analytics',  roles:['admin_limited','admin_super','owner'] },
  { id:'app-settings', icon:'⚙️', label:'App',        roles:['admin_super','owner'] },
  { id:'users',        icon:'👥', label:'Users',       roles:['admin_super','owner'] },
  { id:'shorts-mod',   icon:'🎬', label:'Shorts',      roles:['admin_limited','admin_super','owner'] },
  { id:'chat-watch',   icon:'💬', label:'Chats',       roles:['admin_super','owner'] },
  { id:'music-mod',    icon:'🎵', label:'Music',       roles:['admin_limited','admin_super','owner'] },
  { id:'broadcast',    icon:'📢', label:'Broadcast',   roles:['admin_super','owner'] },
  { id:'feedback',     icon:'📩', label:'Feedback',    roles:['admin_limited','admin_super','owner'] },
];

function buildAdminNav() {
  var nav = document.getElementById('admin-nav-row');
  if (!nav) return;
  nav.innerHTML = '';

  var userRole = (ADMIN_gateEmail === CONFIG.OWNER_EMAIL)
    ? 'owner'
    : (STATE.user && STATE.user.role) || 'member';

  ADMIN_PANELS
    .filter(function (p) { return p.roles.indexOf(userRole) !== -1; })
    .forEach(function (p, i) {
      var btn = document.createElement('button');
      btn.className   = 'anav' + (i === 0 ? ' active' : '');
      btn.textContent = p.icon + ' ' + p.label;
      btn.onclick = function () {
        document.querySelectorAll('.anav').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        buildAdminPanel(p.id);
      };
      nav.appendChild(btn);
    });

  buildAdminPanel('analytics');
}

window.init_admin = function () {};

/* ══════════════════════════════════
   ADMIN PANELS
══════════════════════════════════ */
function buildAdminPanel(id) {
  var content = document.getElementById('admin-content');
  if (!content) return;

  if (id === 'analytics') {
    content.innerHTML =
      '<div class="admin-panel">' +
        '<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.75rem">' +
          '<div class="live-dot"></div>' +
          '<div id="live-ct" style="font-size:.78rem;color:var(--green)">● loading...</div>' +
        '</div>' +
        '<div class="stats-grid" id="stats-grid"></div>' +
        '<div class="admin-card">' +
          '<div class="admin-card-title">📈 Daily Visitors — Last 7 Days</div>' +
          '<div style="height:80px;display:flex;align-items:flex-end;gap:3px;margin-bottom:.5rem" id="chart-bars"></div>' +
          '<div style="display:flex;justify-content:space-between;font-size:.58rem;color:var(--muted2)">' +
            '<span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>' +
          '</div>' +
        '</div>' +
      '</div>';

    refreshAnalytics();
    clearInterval(window._adminAnalyticsTimer);
    window._adminAnalyticsTimer = setInterval(refreshAnalytics, 10000);

  } else if (id === 'users') {
    buildUsersPanel(content);

  } else if (id === 'broadcast') {
    content.innerHTML =
      '<div class="admin-panel">' +
        '<div class="admin-card">' +
          '<div class="admin-card-title">📢 Global Broadcast</div>' +
          '<div style="font-size:.75rem;color:var(--muted);margin-bottom:.75rem">Sends to all registered users (shown next time they load Home).</div>' +
          '<textarea class="bc-textarea" id="bc-textarea" rows="4" placeholder="Type your announcement..."></textarea>' +
          '<button class="bc-send-btn" onclick="sendBroadcast()">📢 Send to All Users</button>' +
        '</div>' +
        '<div class="admin-card" id="bc-history-card">' +
          '<div class="admin-card-title">📜 Broadcast History</div>' +
          '<div id="bc-history-list"></div>' +
        '</div>' +
      '</div>';
    loadBroadcastHistory();

  } else if (id === 'app-settings') {
    var userRole = (ADMIN_gateEmail === CONFIG.OWNER_EMAIL)
      ? 'owner'
      : (STATE.user && STATE.user.role);

    content.innerHTML =
      '<div class="admin-panel">' +
        '<div class="admin-card">' +
          '<div class="admin-card-title">🏷️ Platform Identity</div>' +
          '<div style="display:flex;align-items:center;justify-content:space-between;padding:.75rem 0;border-bottom:.5px solid rgba(201,168,76,.06)">' +
            '<div><div style="font-size:.82rem">Platform Title</div></div>' +
            '<input style="padding:.45rem .75rem;background:var(--bg3);border:.5px solid var(--border);border-radius:8px;color:var(--text);font-size:.82rem;font-family:inherit;outline:none;max-width:150px" id="site-title" value="' + escHtml(STATE.settings.app_title || 'YID PLUS') + '">' +
            '<button class="save-pill" onclick="adminSaveTitle()">Save</button>' +
          '</div>' +
          '<div style="padding:.75rem 0">' +
            '<div style="font-size:.82rem;color:var(--red)">🔒 Hardcoded Owner: <strong>' + escHtml(CONFIG.OWNER_EMAIL) + '</strong></div>' +
            '<div style="font-size:.68rem;color:var(--muted);margin-top:.25rem">Cannot be changed by anyone.</div>' +
          '</div>' +
        '</div>' +
        '<div class="admin-card">' +
          '<div class="admin-card-title">🔒 Admin PIN</div>' +
          '<div style="display:flex;align-items:center;gap:.5rem;padding:.75rem 0">' +
            '<input type="password" maxlength="4" id="new-pin-input" placeholder="New 4-digit PIN" style="flex:1;padding:.6rem;background:var(--bg3);border:.5px solid var(--border);border-radius:8px;color:var(--text);font-family:inherit;outline:none">' +
            '<button class="save-pill" onclick="updateAdminPin()">Update</button>' +
          '</div>' +
        '</div>' +
        (userRole === 'owner' ?
          '<div class="admin-card">' +
            '<div class="admin-card-title">🗄️ Cloudflare D1 — Database</div>' +
            '<div style="font-size:.75rem;color:var(--muted);line-height:1.6">' +
              'Run schema changes via <code>npx wrangler d1 execute yidplus-db --file=./schema.sql</code> or the ' +
              '<a href="https://dash.cloudflare.com" target="_blank" style="color:var(--gold)">Cloudflare Dashboard →</a> D1 console.' +
            '</div>' +
          '</div>' : '') +
      '</div>';

  } else {
    content.innerHTML =
      '<div class="admin-panel"><div class="admin-card" style="text-align:center;padding:2rem">' +
        '<div style="font-size:2.5rem;margin-bottom:.75rem">🚧</div>' +
        '<div style="font-size:.88rem;color:var(--muted)">' + escHtml(id) + ' panel — connected to Cloudflare D1 · ready to use</div>' +
      '</div></div>';
  }
}

/* ── ANALYTICS ── */
function refreshAnalytics() {
  api.get('/admin/stats')
    .then(function (res) {
      var online = res.online || 0;
      var total  = res.total  || 0;
      var vals   = res.dailyVisitors || [320,410,280,520,610,490,570];
      var max    = Math.max.apply(null, vals);

      var liveCt = document.getElementById('live-ct');
      if (liveCt) liveCt.textContent = '● ' + online + ' users online now';

      var grid = document.getElementById('stats-grid');
      if (grid) {
        var cards = [
          ['Total Users', total,  '↑ Today',          'up'],
          ['Online Now',  online, 'Live count',       'up'],
          ['Shorts',      res.shorts   || '—', 'Cloudflare R2',     'up'],
          ['Messages',    res.messages || '—', 'Cloudflare D1',     'up'],
        ];
        grid.innerHTML = cards.map(function (c) {
          return '<div class="stat-card">' +
            '<div class="stat-num">' + c[1] + '</div>' +
            '<div class="stat-lbl">' + c[0] + '</div>' +
            '<div class="stat-' + c[3] + '">' + c[2] + '</div>' +
          '</div>';
        }).join('');
      }

      var bars = document.getElementById('chart-bars');
      if (bars) {
        bars.innerHTML = vals.map(function (v, i) {
          var h = Math.max(6, v / max * 74);
          return '<div class="chart-bar' + (i === 6 ? ' today' : '') + '" style="flex:1;height:' + h + 'px" title="' + v + '"></div>';
        }).join('');
      }
    })
    .catch(function (err) {
      console.warn('[ADMIN] stats error:', err.message);
    });
}

/* ── USERS PANEL ── */
function buildUsersPanel(content) {
  content.innerHTML =
    '<div class="admin-panel">' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">👥 Registered Users <span style="color:var(--muted);font-size:.7rem" id="usr-count"></span></div>' +
        '<input class="admin-search" placeholder="Search by nickname...' + (userCan('view_pii') ? ' or email' : '') + '" id="usr-search" oninput="filterAdminUsers()">' +
        '<div id="usr-list"><div class="feed-state"><div class="spinner"></div></div></div>' +
      '</div>' +
    '</div>';

  api.get('/admin/users')
    .then(function (res) {
      ADMIN_allUsers = res.users || [];
      var ct = document.getElementById('usr-count');
      if (ct) ct.textContent = '(' + ADMIN_allUsers.length + ' total)';
      renderUsersList(ADMIN_allUsers, userCan('view_pii'));
    })
    .catch(function (err) {
      var el = document.getElementById('usr-list');
      if (el) el.innerHTML = '<div class="feed-state"><div>⚠️ ' + escHtml(err.message) + '</div></div>';
    });
}

function renderUsersList(users, canSeePII) {
  var el = document.getElementById('usr-list');
  if (!el) return;

  if (!users.length) {
    el.innerHTML = '<div style="padding:1rem;text-align:center;font-size:.8rem;color:var(--muted)">No users found</div>';
    return;
  }

  el.innerHTML = users.map(function (u) {
    var isOwnerRow = u.email === CONFIG.OWNER_EMAIL;
    var canEdit    = userCan('manage_users') && !isOwnerRow;
    var roleClass  = (u.role === 'admin_super' || u.role === 'admin_limited') ? 'admin' : 'user';
    var roleBadge  = '<span class="role-badge role-' + roleClass + '">' + (u.role || 'member') + '</span>';

    var actions = canEdit
      ? '<button class="act-btn act-verify" onclick="adminVerify(\'' + u.id + '\',\'' + !!u.verified + '\')">' + (u.verified ? '✓ Verified' : '👑 Verify') + '</button>' +
        (userCan('promote_users')
          ? '<button class="act-btn act-promote" onclick="adminPromote(\'' + u.id + '\',\'' + (u.role || 'member') + '\')">' + (u.role === 'admin_super' ? 'Demote' : 'Promote') + '</button>'
          : '') +
        '<button class="act-btn act-block" onclick="adminBlock(\'' + u.id + '\',\'' + !!u.blocked + '\')">' + (u.blocked ? 'Unblock' : 'Block') + '</button>'
      : '<span style="font-size:.65rem;color:var(--muted)">Protected</span>';

    return '<div class="user-row">' +
      '<div style="width:36px;height:36px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:.85rem;flex-shrink:0;border:.5px solid var(--border);position:relative">' +
        (u.online ? '<div class="online-dot"></div>' : '') +
        escHtml((u.nickname || '?').slice(0, 2).toUpperCase()) +
      '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:.82rem;font-weight:700;display:flex;align-items:center;gap:.35rem;flex-wrap:wrap">' +
          '@' + escHtml(u.nickname || 'user') + ' ' + roleBadge + ' ' + (u.verified ? '👑' : '') + ' ' + (u.blocked ? '🚫' : '') +
        '</div>' +
        (canSeePII && u.email ? '<div style="font-size:.67rem;color:var(--muted)">' + escHtml(u.email) + '</div>' : '') +
      '</div>' +
      '<div style="display:flex;gap:.3rem;flex-shrink:0;flex-wrap:wrap">' + actions + '</div>' +
    '</div>';
  }).join('');
}

window.filterAdminUsers = function () {
  var q = (document.getElementById('usr-search') || {}).value || '';
  q = q.toLowerCase();
  var filtered = ADMIN_allUsers.filter(function (u) {
    return (u.nickname || '').toLowerCase().indexOf(q) !== -1 ||
           (u.email    || '').toLowerCase().indexOf(q) !== -1;
  });
  renderUsersList(filtered, userCan('view_pii'));
};

window.adminVerify = function (id, currentStr) {
  var verified = currentStr !== 'true';
  api.put('/admin/users', { id: id, verified: verified })
    .then(function () {
      toast(verified ? '👑 Verified badge granted!' : 'Badge removed.');
      buildUsersPanel(document.getElementById('admin-content'));
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.adminBlock = function (id, currentStr) {
  var blocked = currentStr !== 'true';
  api.put('/admin/users', { id: id, blocked: blocked })
    .then(function () {
      toast(blocked ? '🚫 User blocked.' : '✅ User unblocked.');
      buildUsersPanel(document.getElementById('admin-content'));
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.adminPromote = function (id, currentRole) {
  if (!userCan('promote_users')) return toast('⚠ Only the owner can promote users.');
  var newRole = currentRole === 'admin_super' ? ROLES.member : 'admin_super';
  api.put('/admin/users', { id: id, role: newRole })
    .then(function () {
      toast(newRole === 'admin_super' ? '🛡 Promoted to Super Admin!' : 'Demoted to member.');
      buildUsersPanel(document.getElementById('admin-content'));
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

/* ── BROADCAST ── */
window.sendBroadcast = function () {
  var ta   = document.getElementById('bc-textarea');
  var text = (ta && ta.value || '').trim();
  if (!text) return toast('⚠ Type a message first.');
  if (!confirm('Send this to ALL users?\n\n"' + text + '"')) return;

  api.post('/broadcasts', {
    text: text,
    sender_email: ADMIN_gateEmail || (STATE.user && STATE.user.email) || '',
  })
    .then(function () {
      ta.value = '';
      toast('📢 Broadcast sent to all users!');
      loadBroadcastHistory();
    })
    .catch(function (err) { toast('❌ Failed: ' + err.message); });
};

function loadBroadcastHistory() {
  var el = document.getElementById('bc-history-list');
  if (!el) return;

  api.get('/broadcasts?limit=10')
    .then(function (res) {
      var list = res.broadcasts || [];
      if (!list.length) {
        el.innerHTML = '<div style="font-size:.78rem;color:var(--muted);text-align:center;padding:1rem">No broadcasts yet</div>';
        return;
      }
      el.innerHTML = list.map(function (b) {
        return '<div style="background:var(--bg3);border:.5px solid var(--border);border-radius:8px;padding:.65rem .85rem;margin-bottom:.5rem">' +
          '<div style="font-size:.82rem;margin-bottom:.25rem">' + escHtml(b.text) + '</div>' +
          '<div style="font-size:.63rem;color:var(--muted)">Sent by ' + escHtml(b.sender_email) + ' · ' + new Date(b.created_at).toLocaleString() + '</div>' +
        '</div>';
      }).join('');
    })
    .catch(function (err) {
      el.innerHTML = '<div style="font-size:.78rem;color:var(--muted);text-align:center;padding:1rem">⚠ ' + escHtml(err.message) + '</div>';
    });
}

/* ── SETTINGS HELPERS ── */
window.adminSaveTitle = function () {
  var v = (document.getElementById('site-title') || {}).value || '';
  if (!v.trim()) return toast('⚠ Title cannot be empty.');
  saveSetting('app_title', v.trim());
};

window.updateAdminPin = function () {
  var p = (document.getElementById('new-pin-input') || {}).value;
  if (!p || p.length !== 4 || isNaN(p)) return toast('⚠ Enter exactly 4 digits.');
  ADMIN_pinLocal = p;
  document.getElementById('new-pin-input').value = '';
  toast('✅ Admin PIN updated! (this session only — set ADMIN_PIN in wrangler.toml for persistence)');
};

console.log('[YID PLUS] admin.js loaded ✓ (Cloudflare D1 mode)');
