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
var ADMIN_gateRole  = '';
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
      ADMIN_gateRole  = role; // verified role for THIS email, from the server — not STATE.user
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

    const CO_OWNER = 'Jmittelman2@gmail.com';
    var role = (ADMIN_gateEmail === CONFIG.OWNER_EMAIL || ADMIN_gateEmail === CO_OWNER)
                 ? 'owner'
                 : (ADMIN_gateRole || 'member');

    // Publish the verified gate identity so userCan()/isOwner()/isSuperAdmin()/isAnyAdmin()
    // in state.js use THIS identity for the rest of the admin panel session, not whichever
    // account the browser happens to be logged into.
    window.ADMIN_GATE_SESSION = { email: ADMIN_gateEmail, role: role };

    var badge = document.getElementById('admin-role-badge');
    if (badge) {
      badge.textContent = role === 'owner'        ? '👑 OWNER'
                         : role === 'admin_super'  ? '🛡 SUPER ADMIN'
                         :                           '🔒 MODERATOR';
    }

    buildAdminNav();
    navTo('admin');
  });
};

/* ══════════════════════════════════
   ADMIN NAV
══════════════════════════════════ */
var ADMIN_PANELS = [
  { id:'analytics',     icon:'📊', label:'Analytics',     roles:['admin_limited','admin_super','owner'] },
  { id:'app-settings',  icon:'⚙️', label:'App',           roles:['admin_super','owner'] },
  { id:'users',         icon:'👥', label:'Users',          roles:['admin_limited','admin_super','owner'] },
  { id:'reports',       icon:'🚨', label:'Reports',        roles:['admin_limited','admin_super','owner'] },
  { id:'banned-devices',icon:'🚫', label:'Banned Devices', roles:['admin_super','owner'] },
  { id:'ip-logs',       icon:'🌐', label:'IP Logs',        roles:['admin_super','owner'] },
  { id:'channels-mgr',  icon:'📡', label:'Channels',       roles:['admin_super','owner'] },
  { id:'shorts-mod',    icon:'🎬', label:'Shorts',         roles:['admin_limited','admin_super','owner'] },
  { id:'chat-watch',    icon:'💬', label:'Chats',          roles:['admin_super','owner'] },
  { id:'music-mod',     icon:'🎵', label:'Music',          roles:['admin_limited','admin_super','owner'] },
  { id:'broadcast',     icon:'📢', label:'Broadcast',      roles:['admin_super','owner'] },
  { id:'feedback',      icon:'📩', label:'Feedback',       roles:['admin_limited','admin_super','owner'] },
  { id:'ads',           icon:'📣', label:'Ads',            roles:['admin_super','owner'] },
  { id:'ad-exempt',     icon:'🚫📣', label:'Ad-Free Users', roles:['owner'] },
  { id:'nuclear',       icon:'☢️', label:'Nuclear',        roles:['owner'] },
  { id:'maintenance',   icon:'🔧', label:'Maintenance',    roles:['admin_super','owner'] },
  { id:'audit-logs',    icon:'📜', label:'Audit Logs',     roles:['admin_super','owner'] },
  { id:'admin-settings',icon:'🛠️', label:'Admin Settings', roles:['owner'] },
];

function buildAdminNav() {
  var nav = document.getElementById('admin-nav-row');
  if (!nav) return;
  nav.innerHTML = '';

  var userRole = (ADMIN_gateEmail === CONFIG.OWNER_EMAIL) ? 'owner' : (ADMIN_gateRole || 'member');

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
          '<div style="display:flex;align-items:center;justify-content:space-between;padding:.75rem 0;border-bottom:.5px solid rgba(201,168,76,.06)">' +
            '<div><div style="font-size:.82rem">Logo</div><div style="font-size:.68rem;color:var(--muted)">Shown in the top bar</div></div>' +
            '<div style="display:flex;align-items:center;gap:.5rem">' +
              (STATE.settings.logo_url ? '<img src="' + STATE.settings.logo_url + '" style="height:28px;width:auto;object-fit:contain;border-radius:4px">' : '') +
              '<button class="save-pill" onclick="document.getElementById(\'logo-upload-input\').click()">' + (STATE.settings.logo_url ? 'Change' : 'Upload') + '</button>' +
            '</div>' +
            '<input type="file" id="logo-upload-input" accept="image/*" style="display:none" onchange="adminUploadLogo(event)">' +
          '</div>' +
          '<div style="display:flex;align-items:center;justify-content:space-between;padding:.75rem 0;border-bottom:.5px solid rgba(201,168,76,.06)">' +
            '<div><div style="font-size:.82rem">New Registrations</div><div style="font-size:.68rem;color:var(--muted)">Allow new users to sign up</div></div>' +
            '<label style="display:flex;align-items:center;gap:.5rem;cursor:pointer">' +
              '<input type="checkbox" id="reg-open-toggle" ' + (STATE.settings.registration_open !== 'false' ? 'checked' : '') + ' onchange="adminToggleRegistration(this.checked)" style="width:18px;height:18px;cursor:pointer">' +
              '<span style="font-size:.82rem;font-weight:700" id="reg-open-label">' + (STATE.settings.registration_open !== 'false' ? 'Open' : 'Closed') + '</span>' +
            '</label>' +
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

  } else if (id === 'shorts-mod') {
    buildShortsModPanel(content);

  } else if (id === 'chat-watch') {
    buildChatWatchPanel(content);

  } else if (id === 'music-mod') {
    buildMusicModPanel(content);

  } else if (id === 'feedback') {
    buildFeedbackPanel(content);

  } else if (id === 'admin-settings') {
    content.innerHTML =
      '<div class="admin-panel">' +
        '<div class="admin-card">' +
          '<div class="admin-card-title">🛠️ Admin Settings</div>' +
          '<div style="font-size:.78rem;color:var(--muted);line-height:1.6">' +
            'Admin roles are managed from the <strong>Users</strong> tab (promote/demote). ' +
            'The admin gate PIN can be changed under <strong>App</strong> → Security.' +
          '</div>' +
        '</div>' +
      '</div>';

  } else if (id === 'audit-logs') {
    buildAuditLogsPanel(content);

  } else if (id === 'ads') {
    buildAdsPanel(content);

  } else if (id === 'ad-exempt') {
    buildAdExemptPanel(content);

  } else if (id === 'nuclear') {
    buildNuclearPanel(content);

  } else if (id === 'reports') {
    buildReportsPanel(content);

  } else if (id === 'banned-devices') {
    buildBannedDevicesPanel(content);

  } else if (id === 'ip-logs') {
    buildIpLogsPanel(content);

  } else if (id === 'channels-mgr') {
    buildChannelsMgrPanel(content);

  } else if (id === 'maintenance') {
    buildMaintenancePanel(content);

  } else {
    content.innerHTML =
      '<div class="admin-panel"><div class="admin-card" style="text-align:center;padding:2rem">' +
        '<div style="font-size:2.5rem;margin-bottom:.75rem">🚧</div>' +
        '<div style="font-size:.88rem;color:var(--muted)">' + escHtml(id) + ' panel — connected to Cloudflare D1 · ready to use</div>' +
      '</div></div>';
  }
}

/* ── SHORTS MODERATION ── */
function buildShortsModPanel(content) {
  content.innerHTML =
    '<div class="admin-panel">' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">🎬 Video Uploads Moderation</div>' +
        '<div id="shorts-mod-list"><div class="feed-state"><div class="spinner"></div></div></div>' +
      '</div>' +
    '</div>';

  api.get('/shorts')
    .then(function (res) {
      var shorts = res.shorts || [];
      var el = document.getElementById('shorts-mod-list');
      if (!el) return;
      if (!shorts.length) {
        el.innerHTML = '<div style="padding:1rem;text-align:center;font-size:.8rem;color:var(--muted)">No shorts uploaded yet</div>';
        return;
      }
      el.innerHTML = shorts.map(function (s) {
        return '<div class="video-row">' +
          '<video class="vid-thumb" src="' + s.media_url + '" style="object-fit:cover" muted></video>' +
          '<div class="vid-info">' +
            '<div class="vid-title">' + escHtml(s.caption || '(no caption)') + '</div>' +
            '<div class="vid-meta">@' + escHtml(s.nick) + ' · ❤️ ' + fmtN(s.likes) + ' · ' + timeAgo(s.created_at) + '</div>' +
          '</div>' +
          '<button class="del-btn" onclick="adminDeleteShort(\'' + s.id + '\')">🗑 Delete</button>' +
        '</div>';
      }).join('');
    })
    .catch(function (err) {
      var el = document.getElementById('shorts-mod-list');
      if (el) el.innerHTML = '<div style="padding:1rem;color:var(--red);font-size:.8rem">' + escHtml(err.message) + '</div>';
    });
}

window.adminDeleteShort = function (id) {
  if (!confirm('Delete this short?')) return;
  api.del('/shorts?id=' + encodeURIComponent(id))
    .then(function () { toast('🗑 Deleted.'); buildShortsModPanel(document.getElementById('admin-content')); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

/* ── CHAT WATCH ── */
function buildChatWatchPanel(content) {
  content.innerHTML =
    '<div class="admin-panel">' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">💬 God-Mode Chat Access</div>' +
        '<div style="font-size:.75rem;color:var(--muted);margin-bottom:.75rem;padding:.5rem;background:rgba(226,75,74,.06);border:1px solid rgba(226,75,74,.2);border-radius:8px">⚠️ Admin view only. Use responsibly.</div>' +
        '<div id="chat-watch-list"><div class="feed-state"><div class="spinner"></div></div></div>' +
      '</div>' +
    '</div>';

  api.get('/admin/rooms')
    .then(function (res) {
      var rooms = res.rooms || [];
      var el = document.getElementById('chat-watch-list');
      if (!el) return;
      if (!rooms.length) {
        el.innerHTML = '<div style="padding:1rem;text-align:center;font-size:.8rem;color:var(--muted)">No chat rooms yet</div>';
        return;
      }
      el.innerHTML = rooms.map(function (r) {
        return '<div class="chat-room-row" onclick="adminViewRoom(\'' + r.id + '\',\'' + escHtml(r.name).replace(/'/g, "\\'") + '\')">' +
          '<div class="cr-icon">' + r.emoji + '</div>' +
          '<div class="cr-info"><div class="cr-name">' + escHtml(r.name) + ' <span style="font-size:.63rem;color:var(--muted)">(' + r.members + ' members)</span></div>' +
          '<div class="cr-preview">' + escHtml(r.preview) + '</div></div>' +
          '<button class="cr-view-btn">👁 View</button>' +
        '</div>';
      }).join('');
    })
    .catch(function (err) {
      var el = document.getElementById('chat-watch-list');
      if (el) el.innerHTML = '<div style="padding:1rem;color:var(--red);font-size:.8rem">' + escHtml(err.message) + '</div>';
    });
}

window.adminViewRoom = function (roomId, name) {
  api.get('/chat?room_id=' + encodeURIComponent(roomId))
    .then(function (res) {
      var msgs = res.messages || [];
      var text = msgs.slice(-15).map(function (m) {
        return '@' + (m.sender_nick || '?') + ': ' + (m.type === 'text' ? m.text : '[' + m.type + ']');
      }).join('\n') || '(no messages)';
      alert('📋 God-Mode View: ' + name + '\n\n' + text);
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

/* ── MUSIC ADMIN ── */
var MUSIC_ADMIN_DATA = [
  { emoji: '🎵', name: 'Am Yisrael Chai', artist: 'ShlomoBeats', cat: 'Single', trending: true },
  { emoji: '🎹', name: 'Niggunim Vol. 3', artist: 'Moshe Levi', cat: 'Album', trending: true },
  { emoji: '🌅', name: 'Modeh Ani', artist: 'RebbeChoir', cat: 'Single', trending: false },
  { emoji: '🎻', name: 'Klezmer Dreams', artist: 'FiddlerNY', cat: 'Album', trending: false },
  { emoji: '🎤', name: 'Soulful Beats', artist: 'ShlomoBeats', cat: 'Album', trending: false },
];

function buildMusicModPanel(content) {
  content.innerHTML =
    '<div class="admin-panel">' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">🎵 Music Library Control</div>' +
        '<div id="music-mod-list"></div>' +
      '</div>' +
    '</div>';
  renderMusicMod();
}

function renderMusicMod() {
  var el = document.getElementById('music-mod-list');
  if (!el) return;
  el.innerHTML = MUSIC_ADMIN_DATA.map(function (t, i) {
    return '<div class="music-admin-row">' +
      '<div class="ma-thumb">' + t.emoji + '</div>' +
      '<div class="ma-info"><div class="ma-name">' + escHtml(t.name) + '</div><div class="ma-artist">' + escHtml(t.artist) + ' · <span style="color:var(--blue);font-size:.62rem">' + t.cat + '</span></div></div>' +
      '<div class="ma-actions">' +
        '<button class="ma-btn ma-trend' + (t.trending ? ' on' : '') + '" onclick="toggleMusicTrending(' + i + ')">' + (t.trending ? '⭐ Trending' : '☆ Set Trending') + '</button>' +
        '<button class="ma-btn ma-del" onclick="deleteMusicAdmin(' + i + ')">🗑</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

window.toggleMusicTrending = function (i) {
  MUSIC_ADMIN_DATA[i].trending = !MUSIC_ADMIN_DATA[i].trending;
  renderMusicMod();
  toast(MUSIC_ADMIN_DATA[i].trending ? '⭐ Set as Trending!' : 'Removed from Trending.');
};
window.deleteMusicAdmin = function (i) {
  if (!confirm('Remove "' + MUSIC_ADMIN_DATA[i].name + '" from the platform?')) return;
  MUSIC_ADMIN_DATA.splice(i, 1);
  renderMusicMod();
  toast('🗑 Track removed.');
};

/* ── FEEDBACK INBOX ── */
function buildFeedbackPanel(content) {
  content.innerHTML =
    '<div class="admin-panel">' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">📩 User Feedback & Bug Reports <span id="fb-count-badge" style="background:rgba(226,75,74,.12);color:var(--red);border:1px solid rgba(226,75,74,.25);border-radius:10px;padding:.1rem .5rem;font-size:.65rem;margin-left:.3rem"></span></div>' +
        '<div id="feedback-list"><div class="feed-state"><div class="spinner"></div></div></div>' +
      '</div>' +
    '</div>';

  api.get('/feedback')
    .then(function (res) {
      var list = res.feedback || [];
      var unresolved = list.filter(function (f) { return !f.resolved; }).length;
      var badge = document.getElementById('fb-count-badge');
      if (badge) badge.textContent = unresolved + ' new';

      var el = document.getElementById('feedback-list');
      if (!el) return;
      if (!list.length) {
        el.innerHTML = '<div style="padding:1rem;text-align:center;font-size:.8rem;color:var(--muted)">No feedback yet</div>';
        return;
      }
      el.innerHTML = list.map(function (f) {
        return '<div class="fb-item" style="opacity:' + (f.resolved ? '.5' : '1') + '">' +
          '<div class="fb-header">' +
            '<div style="display:flex;align-items:center;gap:.5rem">' +
              '<span class="fb-nick">@' + escHtml(f.nickname || 'user') + '</span>' +
              '<span class="fb-type ' + (f.type === 'bug' ? 'fb-bug' : 'fb-suggest') + '">' + (f.type === 'bug' ? '🐛 Bug' : '💡 Suggestion') + '</span>' +
            '</div>' +
            '<span class="fb-time">' + timeAgo(f.created_at) + '</span>' +
          '</div>' +
          '<div class="fb-text">' + escHtml(f.text) + '</div>' +
          (f.device ? '<div class="fb-device">📱 ' + escHtml(f.device) + '</div>' : '') +
          '<div class="fb-actions">' +
            (!f.resolved ? '<button class="fb-resolve" onclick="resolveFeedback(\'' + f.id + '\')">✓ Resolve</button>' : '<span style="font-size:.68rem;color:var(--green)">✓ Resolved</span>') +
            '<button class="fb-delete" onclick="deleteFeedback(\'' + f.id + '\')">🗑 Delete</button>' +
          '</div>' +
        '</div>';
      }).join('');
    })
    .catch(function (err) {
      var el = document.getElementById('feedback-list');
      if (el) el.innerHTML = '<div style="padding:1rem;color:var(--red);font-size:.8rem">' + escHtml(err.message) + '</div>';
    });
}

window.resolveFeedback = function (id) {
  api.put('/feedback', { id: id, resolved: true })
    .then(function () { toast('✅ Marked as resolved.'); buildFeedbackPanel(document.getElementById('admin-content')); })
    .catch(function (err) { toast('❌ ' + err.message); });
};
window.deleteFeedback = function (id) {
  if (!confirm('Delete this feedback?')) return;
  api.del('/feedback?id=' + encodeURIComponent(id))
    .then(function () { toast('🗑 Deleted.'); buildFeedbackPanel(document.getElementById('admin-content')); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

/* ── ANALYTICS ── */
function refreshAnalytics() {
  api.get('/admin/stats')
    .then(function (res) {
      var stats  = res.stats || {};
      var online = stats.online   || 0;
      var total  = stats.users    || 0;
      var shorts = stats.shorts   || 0;
      var msgs   = stats.messages || 0;
      var vals   = res.dailyVisitors || [0,0,0,0,0,0,0];
      var max    = Math.max.apply(null, vals) || 1;

      var liveCt = document.getElementById('live-ct');
      if (liveCt) liveCt.textContent = '● ' + online + ' users online now';

      var grid = document.getElementById('stats-grid');
      if (grid) {
        var cards = [
          ['Total Users', total,  '↑ Today',       'up'],
          ['Online Now',  online, 'Live count',     'up'],
          ['Shorts',      shorts, 'Cloudflare R2',  'up'],
          ['Messages',    msgs,   'Cloudflare D1',  'up'],
        ];
        grid.innerHTML = cards.map(function (c) {
          return '<div class="stat-card">' +
            '<div class="stat-num">' + fmtN(c[1]) + '</div>' +
            '<div class="stat-lbl">' + c[0] + '</div>' +
            '<div class="stat-' + c[3] + '">' + c[2] + '</div>' +
          '</div>';
        }).join('');
      }

      var bars = document.getElementById('chart-bars');
      if (bars) {
        var days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
        bars.innerHTML = vals.map(function (v, i) {
          var h = Math.max(4, v / max * 74);
          return '<div class="chart-bar' + (i === 6 ? ' today' : '') + '" style="flex:1;height:' + h + 'px" title="' + days[i] + ': ' + v + '"></div>';
        }).join('');
      }
    })
    .catch(function (err) {
      console.warn('[ADMIN] stats error:', err.message);
    });
}

/* ── USERS PANEL ── */
function buildUsersPanel(content) {
  var isOwner = userCan('view_pii');
  content.innerHTML =
    '<div class="admin-panel">' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">👥 Registered Users <span style="color:var(--muted);font-size:.7rem" id="usr-count"></span></div>' +
        '<input class="admin-search" placeholder="Search by nickname' + (isOwner ? ', email...' : '...') + '" id="usr-search" oninput="filterAdminUsers()">' +
        '<div id="usr-list"><div class="feed-state"><div class="spinner"></div></div></div>' +
      '</div>' +
    '</div>';

  api.get('/admin/users')
    .then(function (res) {
      ADMIN_allUsers = res.users || [];
      var ct = document.getElementById('usr-count');
      if (ct) ct.textContent = '(' + ADMIN_allUsers.length + ' total)';
      renderUsersList(ADMIN_allUsers);
    })
    .catch(function (err) {
      var el = document.getElementById('usr-list');
      if (el) el.innerHTML = '<div class="feed-state"><div>⚠️ ' + escHtml(err.message) + '</div></div>';
    });
}

function renderUsersList(users) {
  var el = document.getElementById('usr-list');
  if (!el) return;
  var isOwner = userCan('view_pii');

  if (!users.length) {
    el.innerHTML = '<div style="padding:1rem;text-align:center;font-size:.8rem;color:var(--muted)">No users found</div>';
    return;
  }

  el.innerHTML = users.map(function (u) {
    var isOwnerRow = u.email === CONFIG.OWNER_EMAIL;
    var canBlock   = userCan('block_users') && !isOwnerRow;
    var canManage  = userCan('manage_users') && !isOwnerRow;
    var roleClass  = (u.role === 'admin_super' || u.role === 'admin_limited') ? 'admin' : 'user';
    var roleBadge  = '<span class="role-badge role-' + roleClass + '">' + (u.role || 'member') + '</span>';

    var actions = '';
    if (isOwner && !isOwnerRow) {
      // Owner sees full edit button
      actions += '<button class="act-btn" style="background:var(--gold);color:#000" onclick="adminEditUser(\'' + u.id + '\')">✏️ Edit</button>';
      actions += '<button class="act-btn act-verify" onclick="adminVerify(\'' + u.id + '\',\'' + !!u.verified + '\')">' + (u.verified ? '✓ Verified' : '👑 Verify') + '</button>';
      actions += '<button class="act-btn act-promote" onclick="adminPromote(\'' + u.id + '\',\'' + (u.role || 'member') + '\')">' + (u.role === 'admin_super' ? 'Demote' : 'Promote') + '</button>';
      actions += '<button class="act-btn act-block" onclick="adminBlock(\'' + u.id + '\',\'' + !!u.blocked + '\')">' + (u.blocked ? 'Unblock' : '🚫 Block') + '</button>';
      actions += '<button class="act-btn" style="background:' + (u.no_ads ? 'var(--green)' : 'var(--muted)') + '" onclick="adminToggleNoAds(\'' + u.id + '\',' + !!u.no_ads + ')" title="Ad-free toggle">' + (u.no_ads ? '🚫 Ad-Free ON' : '📣 Ad-Free OFF') + '</button>';
    } else {
      if (canManage) {
        actions += '<button class="act-btn act-verify" onclick="adminVerify(\'' + u.id + '\',\'' + !!u.verified + '\')">' + (u.verified ? '✓ Verified' : '👑 Verify') + '</button>';
        if (userCan('promote_users')) {
          actions += '<button class="act-btn act-promote" onclick="adminPromote(\'' + u.id + '\',\'' + (u.role || 'member') + '\')">' + (u.role === 'admin_super' ? 'Demote' : 'Promote') + '</button>';
        }
      }
      if (canBlock) {
        actions += '<button class="act-btn act-block" onclick="adminBlock(\'' + u.id + '\',\'' + !!u.blocked + '\')">' + (u.blocked ? 'Unblock' : '🚫 Block') + '</button>';
      }
    }
    if (!actions) actions = '<span style="font-size:.65rem;color:var(--muted)">Protected</span>';

    // PII rows (owner only)
    var piiRows = '';
    if (isOwner) {
      if (u.email) piiRows += '<div style="font-size:.67rem;color:var(--muted)">📧 <a href="mailto:' + escHtml(u.email) + '" style="color:var(--gold);text-decoration:none">' + escHtml(u.email) + '</a></div>';
      if (u.phone) piiRows += '<div style="font-size:.67rem;color:var(--muted)">📞 <a href="tel:' + escHtml(u.phone) + '" style="color:var(--gold);text-decoration:none">' + escHtml(u.phone) + '</a></div>';
      if (u.password_hash) {
        var pw = u.password_hash.slice(0,8) + '••••••••';
        piiRows += '<div style="font-size:.67rem;color:var(--muted);font-family:monospace">🔑 ' + pw + '</div>';
      }
    }

    return '<div class="user-row" style="flex-direction:column;align-items:flex-start;gap:.4rem;padding:.75rem 0">' +
      '<div style="display:flex;align-items:center;gap:.5rem;width:100%">' +
        '<div style="width:36px;height:36px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:.85rem;flex-shrink:0;border:.5px solid var(--border);position:relative">' +
          (u.online ? '<div class="online-dot"></div>' : '') +
          escHtml((u.nickname || '?').slice(0, 2).toUpperCase()) +
        '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:.82rem;font-weight:700;display:flex;align-items:center;gap:.35rem;flex-wrap:wrap">' +
            '@' + escHtml(u.nickname || 'user') + ' ' + roleBadge + ' ' + (u.verified ? '✅' : '') + ' ' + (u.blocked ? '🚫' : '') + (u.no_ads ? ' <span style="font-size:.65rem;color:var(--green)">AD-FREE</span>' : '') +
          '</div>' +
          piiRows +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-left:44px">' + actions + '</div>' +
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
  renderUsersList(filtered);
};

window.adminVerify = function (id, currentStr) {
  var verified = currentStr !== 'true';
  api.put('/admin/users', { id: id, verified: verified })
    .then(function () {
      toast(verified ? '✅ Verified badge granted!' : 'Badge removed.');
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

window.adminToggleNoAds = function (id, current) {
  var noAds = !current;
  api.put('/admin/users', { id: id, no_ads: noAds })
    .then(function () {
      toast(noAds ? '🚫 Ad-free granted!' : '📣 Ads restored.');
      buildUsersPanel(document.getElementById('admin-content'));
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.adminEditUser = function (id) {
  var u = ADMIN_allUsers.find(function (x) { return x.id === id; });
  if (!u) return;

  var existing = document.getElementById('edit-user-modal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'edit-user-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
  modal.innerHTML =
    '<div style="background:var(--bg2);border:.5px solid var(--border);border-radius:16px;width:100%;max-width:400px;padding:1.25rem;max-height:90vh;overflow-y:auto">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">' +
        '<div style="font-size:.95rem;font-weight:700">✏️ Edit @' + escHtml(u.nickname) + '</div>' +
        '<div onclick="document.getElementById(\'edit-user-modal\').remove()" style="cursor:pointer;font-size:1.2rem;color:var(--muted)">✕</div>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:.6rem">' +
        _editField('edit-u-nick',  'Nickname',       u.nickname  || '',  'text') +
        _editField('edit-u-email', 'Email',          u.email     || '',  'email') +
        _editField('edit-u-phone', 'Phone',          u.phone     || '',  'tel') +
        _editField('edit-u-pass',  'New Password (leave blank = no change)', '', 'password') +
      '</div>' +
      '<div style="display:flex;gap:.5rem;margin-top:1rem">' +
        '<button class="save-pill" style="flex:1" onclick="adminSaveUserEdit(\'' + id + '\')">💾 Save</button>' +
        '<button class="save-pill" style="flex:1;background:var(--muted)" onclick="document.getElementById(\'edit-user-modal\').remove()">Cancel</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
};

function _editField(id, label, val, type) {
  return '<div>' +
    '<div style="font-size:.72rem;color:var(--muted);margin-bottom:.2rem">' + escHtml(label) + '</div>' +
    '<input id="' + id + '" type="' + type + '" value="' + escHtml(val) + '" style="width:100%;box-sizing:border-box;padding:.5rem .75rem;background:var(--bg3);border:.5px solid var(--border);border-radius:8px;color:var(--text);font-size:.82rem;font-family:inherit;outline:none">' +
  '</div>';
}

window.adminSaveUserEdit = function (id) {
  var nick  = (document.getElementById('edit-u-nick')  || {}).value || '';
  var email = (document.getElementById('edit-u-email') || {}).value || '';
  var phone = (document.getElementById('edit-u-phone') || {}).value || '';
  var pass  = (document.getElementById('edit-u-pass')  || {}).value || '';

  var payload = { id: id };
  if (nick)  payload.nickname = nick.trim();
  if (email) payload.email    = email.trim();
  payload.phone = phone.trim();
  if (pass)  payload.password = pass;

  api.put('/admin/users', payload)
    .then(function () {
      toast('💾 Saved!');
      document.getElementById('edit-user-modal').remove();
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
window.adminToggleRegistration = function (isOpen) {
  saveSetting('registration_open', isOpen ? 'true' : 'false').then(function () {
    var label = document.getElementById('reg-open-label');
    if (label) label.textContent = isOpen ? 'Open' : 'Closed';
    toast(isOpen ? '✅ Registration is now OPEN' : '🔒 Registration is now CLOSED');
  });
};

window.adminSaveTitle = function () {
  var v = (document.getElementById('site-title') || {}).value || '';
  if (!v.trim()) return toast('⚠ Title cannot be empty.');
  saveSetting('app_title', v.trim());
};

window.adminUploadLogo = function (e) {
  var file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) return toast('⚠ Please choose an image file.');

  toast('📤 Uploading logo...');
  var form = new FormData();
  form.append('key', 'logo_url');
  form.append('file', file);

  api.put('/settings', form, true)
    .then(function (res) {
      STATE.settings.logo_url = res.value;
      applyAppSettings();
      toast('✅ Logo updated!');
      buildAdminNav(); // re-render the app-settings panel to show the new preview
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.updateAdminPin = function () {
  var p = (document.getElementById('new-pin-input') || {}).value;
  if (!p || p.length !== 4 || isNaN(p)) return toast('⚠ Enter exactly 4 digits.');
  ADMIN_pinLocal = p;
  document.getElementById('new-pin-input').value = '';
  toast('✅ Admin PIN updated! (this session only — set ADMIN_PIN in wrangler.toml for persistence)');
};

console.log('[YID PLUS] admin.js loaded ✓ (Cloudflare D1 mode)');

/* ── AUDIT LOGS (Super Admin only) ── */
function buildAuditLogsPanel(content) {
  content.innerHTML =
    '<div class="admin-panel">' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">📜 Audit Logs — Moderator & Admin Actions</div>' +
        '<div style="font-size:.72rem;color:var(--muted);margin-bottom:.75rem">Tracks deletions, blocks, verifications, and role changes performed by Moderators and Super Admins.</div>' +
        '<div id="audit-logs-list"><div class="feed-state"><div class="spinner"></div></div></div>' +
      '</div>' +
    '</div>';

  api.get('/admin/audit-logs?limit=80')
    .then(function (res) {
      var logs = res.logs || [];
      var el = document.getElementById('audit-logs-list');
      if (!el) return;
      if (!logs.length) {
        el.innerHTML = '<div style="padding:1rem;text-align:center;font-size:.8rem;color:var(--muted)">No actions logged yet</div>';
        return;
      }
      var actionIcons = {
        delete_post: '🗑️', delete_short: '🗑️', delete_message: '🗑️',
        block_user: '🚫', unblock_user: '✅', verify_user: '👑', unverify_user: '➖',
        change_role: '🔄', resolve_report: '✓', resolve_feedback: '✓',
      };
      el.innerHTML = logs.map(function (l) {
        var icon = actionIcons[l.action] || '📋';
        var roleTag = l.actor_role === 'owner' ? '👑' : l.actor_role === 'admin_super' ? '🛡' : '🔒';
        return '<div style="display:flex;align-items:flex-start;gap:.6rem;padding:.6rem 0;border-bottom:1px solid var(--border)">' +
          '<span style="font-size:1.1rem;flex-shrink:0">' + icon + '</span>' +
          '<div style="flex:1">' +
            '<div style="font-size:.82rem">' + roleTag + ' <strong>@' + escHtml(l.actor_nick || 'unknown') + '</strong> ' + escHtml(l.action.replace(/_/g, ' ')) + '</div>' +
            (l.details ? '<div style="font-size:.72rem;color:var(--muted);margin-top:.1rem">' + escHtml(l.details) + '</div>' : '') +
            '<div style="font-size:.65rem;color:var(--muted2);margin-top:.15rem">' + timeAgo(l.created_at) + '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    })
    .catch(function (err) {
      var el = document.getElementById('audit-logs-list');
      if (el) el.innerHTML = '<div style="padding:1rem;color:var(--red);font-size:.8rem">' + escHtml(err.message) + '</div>';
    });
}

/* ── ADS (Super Admin only) ── */
function buildAdsPanel(content) {
  content.innerHTML =
    '<div class="admin-panel">' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">📣 Create New Ad</div>' +
        '<input class="field" id="ad-title" placeholder="Ad title (optional)">' +
        '<input class="field" id="ad-link" placeholder="Link URL (optional)">' +
        '<input class="field" id="ad-email" placeholder="Email address (optional)">' +
        '<div style="display:flex;gap:.5rem;margin-bottom:.6rem">' +
          '<div style="flex:1">' +
            '<label style="font-size:.72rem;color:var(--muted);display:block;margin-bottom:.25rem">Show every (minutes)</label>' +
            '<input class="field" id="ad-interval" type="number" min="1" value="60" style="margin:0">' +
          '</div>' +
          '<div style="flex:1">' +
            '<label style="font-size:.72rem;color:var(--muted);display:block;margin-bottom:.25rem">Countdown (seconds)</label>' +
            '<input class="field" id="ad-countdown" type="number" min="1" max="30" value="5" style="margin:0">' +
          '</div>' +
        '</div>' +
        '<div style="margin-bottom:.6rem">' +
          '<label style="font-size:.72rem;color:var(--muted);display:block;margin-bottom:.25rem">Show on pages</label>' +
          '<select class="field" id="ad-pages" style="margin:0">' +
            '<option value="all">All pages</option>' +
            '<option value="home">Home only</option>' +
            '<option value="chat">Chat only</option>' +
            '<option value="shorts">Shorts only</option>' +
            '<option value="music">Music only</option>' +
            '<option value="home,shorts">Home + Shorts</option>' +
            '<option value="chat,home">Chat + Home</option>' +
          '</select>' +
        '</div>' +
        '<label style="font-size:.72rem;color:var(--muted);display:block;margin-bottom:.25rem">Image or Video</label>' +
        '<input type="file" id="ad-media-input" accept="image/*,video/*" style="margin-bottom:.85rem">' +
        '<button class="btn-primary" onclick="createAd()">Create Ad</button>' +
      '</div>' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">📋 All Ads</div>' +
        '<div id="ads-list"><div class="feed-state"><div class="spinner"></div></div></div>' +
      '</div>' +
    '</div>';
  loadAdsList();
}

function loadAdsList() {
  api.get('/admin/ads')
    .then(function (res) {
      var ads = res.ads || [];
      var el = document.getElementById('ads-list');
      if (!el) return;
      if (!ads.length) {
        el.innerHTML = '<div style="padding:1rem;text-align:center;font-size:.8rem;color:var(--muted)">No ads yet</div>';
        return;
      }
      el.innerHTML = ads.map(function (a) {
        var pagesLabel = a.pages === 'all' ? 'All pages' : a.pages;
        var exemptList = [];
        try { exemptList = JSON.parse(a.exempt_users || '[]'); } catch(e) {}
        return '<div style="border:1px solid var(--border);border-radius:12px;padding:.85rem;margin-bottom:.75rem">' +
          '<div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.5rem">' +
            (a.media_url
              ? (a.is_video
                  ? '<video src="' + a.media_url + '" style="width:56px;height:56px;border-radius:8px;object-fit:cover" muted></video>'
                  : '<img src="' + a.media_url + '" style="width:56px;height:56px;border-radius:8px;object-fit:cover">')
              : '<div style="width:56px;height:56px;border-radius:8px;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:1.4rem">📣</div>') +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-weight:700;font-size:.88rem">' + escHtml(a.title || '(no title)') + '</div>' +
              '<div style="font-size:.75rem;color:var(--muted)">Every ' + (a.interval_minutes||60) + 'min · ' + (a.countdown_seconds||5) + 's countdown · ' + pagesLabel + '</div>' +
              (a.link_url ? '<div style="font-size:.72rem;color:var(--blue)">' + escHtml(a.link_url) + '</div>' : '') +
            '</div>' +
            '<div style="display:flex;flex-direction:column;gap:.3rem;align-items:flex-end">' +
              '<button class="ma-btn ma-trend' + (a.active ? ' on' : '') + '" onclick="toggleAdActive(\'' + a.id + '\',' + !a.active + ')">' + (a.active ? '🟢 On' : '⚪ Off') + '</button>' +
              '<button class="del-btn" onclick="deleteAd(\'' + a.id + '\')">🗑</button>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.3rem">' +
            '<button class="save-pill" style="font-size:.7rem;padding:.2rem .6rem" onclick="adminEditAdInterval(\'' + a.id + '\')">⏱ Interval</button>' +
            '<button class="save-pill" style="font-size:.7rem;padding:.2rem .6rem" onclick="adminEditAdPages(\'' + a.id + '\')">📄 Pages</button>' +
            '<button class="save-pill" style="font-size:.7rem;padding:.2rem .6rem" onclick="adminEditExemptUsers(\'' + a.id + '\',\'' + escHtml(JSON.stringify(exemptList)) + '\')">🚫 Exempt</button>' +
          '</div>' +
        '</div>';
      }).join('');
    })
    .catch(function (err) {
      var el = document.getElementById('ads-list');
      if (el) el.innerHTML = '<div style="padding:1rem;color:var(--red);font-size:.8rem">' + escHtml(err.message) + '</div>';
    });
}

window.createAd = function () {
  var title    = (document.getElementById('ad-title').value || '').trim();
  var link     = document.getElementById('ad-link').value || '';
  var email    = document.getElementById('ad-email').value || '';
  var interval = document.getElementById('ad-interval').value || '60';
  var countdown= document.getElementById('ad-countdown').value || '5';
  var pages    = document.getElementById('ad-pages').value || 'all';
  var file     = document.getElementById('ad-media-input').files[0];

  if (!title && !file) return toast('⚠ Add a title or image/video.');

  var form = new FormData();
  form.append('title', title);
  form.append('link_url', link);
  form.append('email_url', email);
  form.append('interval_minutes', interval);
  form.append('countdown_seconds', countdown);
  form.append('pages', pages);
  form.append('exempt_users', '[]');
  if (file) form.append('media', file);

  api.post('/admin/ads', form, true)
    .then(function () {
      toast('✅ Ad created!');
      ['ad-title','ad-link','ad-email'].forEach(function(id) { var el = document.getElementById(id); if(el) el.value=''; });
      document.getElementById('ad-interval').value = '60';
      document.getElementById('ad-countdown').value = '5';
      document.getElementById('ad-media-input').value = '';
      loadAdsList();
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.adminEditAdInterval = function (id) {
  var mins = prompt('Show every how many minutes?', '60');
  if (!mins) return;
  var secs = prompt('Countdown seconds before Skip?', '5');
  if (!secs) return;
  api.put('/admin/ads', { id: id, interval_minutes: parseInt(mins), countdown_seconds: parseInt(secs) })
    .then(function () { toast('✅ Updated!'); loadAdsList(); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.adminEditAdPages = function (id) {
  var p = prompt('Pages (all / home / chat / shorts / music or comma-separated):', 'all');
  if (!p) return;
  api.put('/admin/ads', { id: id, pages: p.trim() })
    .then(function () { toast('✅ Updated!'); loadAdsList(); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.adminEditExemptUsers = function (adId, currentJson) {
  var current = [];
  try { current = JSON.parse(currentJson || '[]'); } catch(e) {}

  // Build a modal with user search
  var existing = document.getElementById('exempt-modal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'exempt-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:500;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;justify-content:center';
  modal.innerHTML =
    '<div style="background:var(--surface);border-radius:16px 16px 0 0;padding:1.25rem;width:100%;max-width:500px;max-height:80vh;overflow-y:auto">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">' +
        '<div style="font-size:.95rem;font-weight:700">🚫 Exempt Users</div>' +
        '<div onclick="document.getElementById(\'exempt-modal\').remove()" style="cursor:pointer;font-size:1.2rem;color:var(--muted)">✕</div>' +
      '</div>' +
      '<input id="exempt-search" class="field" placeholder="Search user by nickname..." oninput="exemptSearch(\'' + adId + '\')" style="margin-bottom:.5rem">' +
      '<div id="exempt-search-results" style="margin-bottom:.75rem"></div>' +
      '<div style="font-size:.78rem;color:var(--muted);margin-bottom:.35rem">Currently exempt:</div>' +
      '<div id="exempt-current-list">' +
        (current.length
          ? current.map(function(uid) {
              return '<div style="display:flex;align-items:center;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid var(--border)">' +
                '<span style="font-size:.82rem;color:var(--muted)">' + uid + '</span>' +
                '<button onclick="exemptRemove(\'' + adId + '\',\'' + uid + '\')" style="background:var(--red);color:#fff;border:none;border-radius:8px;padding:.2rem .6rem;font-size:.72rem;cursor:pointer">Remove</button>' +
              '</div>';
            }).join('')
          : '<div style="font-size:.8rem;color:var(--muted);padding:.5rem 0">No exemptions yet</div>') +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
};

var _exemptAdId = null;
window.exemptSearch = function (adId) {
  _exemptAdId = adId;
  var q = (document.getElementById('exempt-search').value || '').trim();
  var el = document.getElementById('exempt-search-results');
  if (!q || q.length < 2) { el.innerHTML = ''; return; }

  api.get('/admin/users?search=' + encodeURIComponent(q))
    .then(function (res) {
      var users = res.users || [];
      el.innerHTML = users.slice(0, 5).map(function (u) {
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid var(--border)">' +
          '<span style="font-size:.85rem;font-weight:600">@' + escHtml(u.nickname) + '</span>' +
          '<button onclick="exemptAdd(\'' + adId + '\',\'' + u.id + '\',\'' + escHtml(u.nickname) + '\')" style="background:var(--blue);color:#fff;border:none;border-radius:8px;padding:.25rem .7rem;font-size:.75rem;cursor:pointer">+ Exempt</button>' +
        '</div>';
      }).join('') || '<div style="font-size:.8rem;color:var(--muted)">No users found</div>';
    })
    .catch(function () {});
};

window.exemptAdd = function (adId, userId, nick) {
  api.get('/admin/ads').then(function (res) {
    var ad = (res.ads || []).find(function (a) { return a.id === adId; });
    if (!ad) return;
    var list = [];
    try { list = JSON.parse(ad.exempt_users || '[]'); } catch(e) {}
    if (!list.includes(userId)) list.push(userId);
    api.put('/admin/ads', { id: adId, exempt_users: list })
      .then(function () {
        toast('✅ @' + nick + ' will no longer see this ad');
        document.getElementById('exempt-modal').remove();
        loadAdsList();
      });
  });
};

window.exemptRemove = function (adId, userId) {
  api.get('/admin/ads').then(function (res) {
    var ad = (res.ads || []).find(function (a) { return a.id === adId; });
    if (!ad) return;
    var list = [];
    try { list = JSON.parse(ad.exempt_users || '[]'); } catch(e) {}
    list = list.filter(function (id) { return id !== userId; });
    api.put('/admin/ads', { id: adId, exempt_users: list })
      .then(function () {
        toast('✅ User will now see this ad again');
        document.getElementById('exempt-modal').remove();
        loadAdsList();
      });
  });
};

window.toggleAdActive = function (id, active) {
  api.put('/admin/ads', { id: id, active: active })
    .then(function () { loadAdsList(); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

function loadAdsList() {
  api.get('/admin/ads')
    .then(function (res) {
      var ads = res.ads || [];
      var el = document.getElementById('ads-list');
      if (!el) return;
      if (!ads.length) {
        el.innerHTML = '<div style="padding:1rem;text-align:center;font-size:.8rem;color:var(--muted)">No ads yet</div>';
        return;
      }
      el.innerHTML = ads.map(function (a) {
        return '<div class="video-row">' +
          '<div class="vid-thumb">' + (a.media_url ? '<img src="' + a.media_url + '" style="width:100%;height:100%;object-fit:cover">' : '📣') + '</div>' +
          '<div class="vid-info"><div class="vid-title">' + escHtml(a.title) + '</div><div class="vid-meta">' + (a.active ? '🟢 Active' : '⚪ Inactive') + (a.link_url ? ' · has link' : '') + '</div></div>' +
          '<button class="ma-btn ma-trend' + (a.active ? ' on' : '') + '" onclick="toggleAdActive(\'' + a.id + '\',' + !a.active + ')">' + (a.active ? 'Disable' : 'Enable') + '</button>' +
          '<button class="del-btn" onclick="deleteAd(\'' + a.id + '\')" style="margin-left:.3rem">🗑</button>' +
        '</div>';
      }).join('');
    })
    .catch(function (err) {
      var el = document.getElementById('ads-list');
      if (el) el.innerHTML = '<div style="padding:1rem;color:var(--red);font-size:.8rem">' + escHtml(err.message) + '</div>';
    });
}

// (old createAd removed)

window.deleteAd = function (id) {
  if (!confirm('Delete this ad?')) return;
  api.del('/admin/ads?id=' + encodeURIComponent(id))
    .then(function () { toast('🗑 Deleted.'); loadAdsList(); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

/* ══════════════════════════════════
   REPORTS PANEL
══════════════════════════════════ */
function buildReportsPanel(content) {
  content.innerHTML =
    '<div class="admin-panel">' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">🚨 User Reports</div>' +
        '<div id="reports-list"><div class="feed-state"><div class="spinner"></div></div></div>' +
      '</div>' +
    '</div>';

  api.get('/reports')
    .then(function (res) {
      var list = res.reports || [];
      var el = document.getElementById('reports-list');
      if (!el) return;
      if (!list.length) {
        el.innerHTML = '<div style="padding:1rem;text-align:center;font-size:.8rem;color:var(--muted)">No reports yet 🎉</div>';
        return;
      }
      el.innerHTML = list.map(function (r) {
        return '<div style="padding:.75rem 0;border-bottom:.5px solid var(--border)">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start">' +
            '<div>' +
              '<div style="font-size:.82rem;font-weight:700">@' + escHtml(r.reported_nick || r.reported_id) + '</div>' +
              '<div style="font-size:.72rem;color:var(--muted);margin:.2rem 0">Reported by @' + escHtml(r.reporter_nick || r.reporter_id) + ' · ' + timeAgo(r.created_at) + '</div>' +
              '<div style="font-size:.78rem;color:var(--text)">' + escHtml(r.reason || '(no reason given)') + '</div>' +
            '</div>' +
            '<div style="display:flex;flex-direction:column;gap:.35rem">' +
              '<button class="save-pill" style="background:var(--red)" onclick="adminBanFromReport(\'' + r.reported_id + '\',\'' + escHtml(r.reported_nick||'') + '\')">🚫 Ban</button>' +
              '<button class="save-pill" onclick="adminDismissReport(\'' + r.id + '\')">✓ Dismiss</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    })
    .catch(function (err) {
      var el = document.getElementById('reports-list');
      if (el) el.innerHTML = '<div style="padding:1rem;color:var(--red);font-size:.8rem">' + escHtml(err.message) + '</div>';
    });
}

window.adminBanFromReport = function (userId, nick) {
  if (!confirm('Ban @' + nick + '? This will also block their device.')) return;
  api.put('/admin/users', { id: userId, blocked: true })
    .then(function () { toast('🚫 @' + nick + ' banned!'); buildReportsPanel(document.getElementById('admin-content')); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.adminDismissReport = function (id) {
  api.del('/reports?id=' + encodeURIComponent(id))
    .then(function () { toast('✓ Dismissed'); buildReportsPanel(document.getElementById('admin-content')); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

/* ══════════════════════════════════
   BANNED DEVICES PANEL
══════════════════════════════════ */
function buildBannedDevicesPanel(content) {
  content.innerHTML =
    '<div class="admin-panel">' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">🚫 Banned Devices / IPs</div>' +
        '<div style="font-size:.72rem;color:var(--muted);margin-bottom:.75rem">Banned users cannot log in or register — even from a new account.</div>' +
        '<div style="display:flex;gap:.5rem;margin-bottom:.75rem">' +
          '<input id="ban-ip-input" placeholder="IP address (e.g. 1.2.3.4)" style="flex:1;padding:.5rem .75rem;background:var(--bg3);border:.5px solid var(--border);border-radius:8px;color:var(--text);font-size:.78rem;outline:none">' +
          '<button class="save-pill" onclick="adminAddDeviceBan()">+ Ban IP</button>' +
        '</div>' +
        '<div id="bans-list"><div class="feed-state"><div class="spinner"></div></div></div>' +
      '</div>' +
    '</div>';

  loadBansList();
}

function loadBansList() {
  api.get('/admin/device-bans')
    .then(function (res) {
      var bans = res.bans || [];
      var el = document.getElementById('bans-list');
      if (!el) return;
      if (!bans.length) {
        el.innerHTML = '<div style="padding:1rem;text-align:center;font-size:.8rem;color:var(--muted)">No device bans yet</div>';
        return;
      }
      el.innerHTML = bans.map(function (b) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:.6rem 0;border-bottom:.5px solid var(--border)">' +
          '<div>' +
            '<div style="font-size:.82rem;font-family:monospace">' + escHtml(b.ip || b.fingerprint || '—') + '</div>' +
            '<div style="font-size:.68rem;color:var(--muted)">Banned by @' + escHtml(b.banned_by) + ' · ' + timeAgo(b.created_at) + (b.reason ? ' · ' + escHtml(b.reason) : '') + '</div>' +
          '</div>' +
          '<button class="save-pill" style="background:var(--red)" onclick="adminUnban(\'' + b.id + '\')">Unban</button>' +
        '</div>';
      }).join('');
    })
    .catch(function () {});
}

window.adminAddDeviceBan = function () {
  var ip = (document.getElementById('ban-ip-input') || {}).value || '';
  ip = ip.trim();
  if (!ip) { toast('Enter an IP address'); return; }
  api.post('/admin/device-bans', { ip: ip, reason: 'Admin manual ban' })
    .then(function () { toast('🚫 IP banned!'); document.getElementById('ban-ip-input').value = ''; loadBansList(); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.adminUnban = function (id) {
  if (!confirm('Remove this ban?')) return;
  api.del('/admin/device-bans?id=' + encodeURIComponent(id))
    .then(function () { toast('✓ Ban removed'); loadBansList(); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

/* ══════════════════════════════════
   IP LOGS PANEL
══════════════════════════════════ */
function buildIpLogsPanel(content) {
  content.innerHTML =
    '<div class="admin-panel">' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">🌐 Login / Register Logs</div>' +
        '<div id="ip-logs-list"><div class="feed-state"><div class="spinner"></div></div></div>' +
      '</div>' +
    '</div>';

  api.get('/admin/device-bans?logs=1')
    .then(function (res) {
      var logs = res.logs || [];
      var el = document.getElementById('ip-logs-list');
      if (!el) return;
      if (!logs.length) {
        el.innerHTML = '<div style="padding:1rem;text-align:center;font-size:.8rem;color:var(--muted)">No logs yet</div>';
        return;
      }
      el.innerHTML = logs.map(function (l) {
        var badgeColor = l.action === 'register' ? 'var(--green)' : 'var(--gold)';
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:.6rem 0;border-bottom:.5px solid var(--border)">' +
          '<div>' +
            '<div style="font-size:.82rem"><strong>@' + escHtml(l.nickname || l.user_id) + '</strong> <span style="font-size:.68rem;color:' + badgeColor + ';background:rgba(0,0,0,.15);padding:.1rem .35rem;border-radius:4px">' + l.action + '</span></div>' +
            '<div style="font-size:.68rem;color:var(--muted);font-family:monospace">' + escHtml(l.ip || '—') + ' · ' + timeAgo(l.created_at) + '</div>' +
          '</div>' +
          '<button class="save-pill" style="font-size:.65rem" onclick="adminQuickBanIp(\'' + escHtml(l.ip||'') + '\')">🚫 Ban IP</button>' +
        '</div>';
      }).join('');
    })
    .catch(function (err) {
      var el = document.getElementById('ip-logs-list');
      if (el) el.innerHTML = '<div style="padding:1rem;color:var(--red);font-size:.8rem">' + escHtml(err.message) + '</div>';
    });
}

window.adminQuickBanIp = function (ip) {
  if (!ip || ip === '0.0.0.0') { toast('No valid IP'); return; }
  if (!confirm('Ban IP: ' + ip + '?')) return;
  api.post('/admin/device-bans', { ip: ip, reason: 'Banned from IP Logs' })
    .then(function () { toast('🚫 IP banned!'); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

/* ══════════════════════════════════
   CHANNELS MANAGER PANEL
══════════════════════════════════ */
function buildChannelsMgrPanel(content) {
  content.innerHTML =
    '<div class="admin-panel">' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">📡 All Channels</div>' +
        '<div id="channels-mgr-list"><div class="feed-state"><div class="spinner"></div></div></div>' +
      '</div>' +
    '</div>';

  api.get('/channels')
    .then(function (res) {
      var channels = res.channels || [];
      var el = document.getElementById('channels-mgr-list');
      if (!el) return;
      if (!channels.length) {
        el.innerHTML = '<div style="padding:1rem;text-align:center;font-size:.8rem;color:var(--muted)">No channels yet</div>';
        return;
      }
      el.innerHTML = channels.map(function (c) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:.65rem 0;border-bottom:.5px solid var(--border)">' +
          '<div>' +
            '<div style="font-size:.82rem;font-weight:700">@' + escHtml(c.nickname) + (c.verified ? ' ✅' : '') + '</div>' +
            '<div style="font-size:.68rem;color:var(--muted)">' + fmtN(c.followers || 0) + ' followers · ' + fmtN(c.total_views || 0) + ' views</div>' +
          '</div>' +
          '<div style="display:flex;gap:.35rem">' +
            (!c.verified ? '<button class="save-pill" onclick="adminVerifyChannel(\'' + c.owner_id + '\',true)">✅ Verify</button>' : '<button class="save-pill" style="background:var(--muted)" onclick="adminVerifyChannel(\'' + c.owner_id + '\',false)">Unverify</button>') +
            '<button class="save-pill" style="background:var(--red)" onclick="adminDeleteChannel(\'' + c.id + '\',\'' + escHtml(c.nickname) + '\')">🗑</button>' +
          '</div>' +
        '</div>';
      }).join('');
    })
    .catch(function (err) {
      var el = document.getElementById('channels-mgr-list');
      if (el) el.innerHTML = '<div style="padding:1rem;color:var(--red);font-size:.8rem">' + escHtml(err.message) + '</div>';
    });
}

window.adminVerifyChannel = function (ownerId, verify) {
  api.put('/admin/users', { id: ownerId, verified: verify })
    .then(function () { toast(verify ? '✅ Verified!' : 'Unverified'); buildChannelsMgrPanel(document.getElementById('admin-content')); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.adminDeleteChannel = function (id, nick) {
  if (!confirm('Delete channel @' + nick + '? This cannot be undone.')) return;
  api.del('/channels?id=' + encodeURIComponent(id))
    .then(function () { toast('🗑 Deleted'); buildChannelsMgrPanel(document.getElementById('admin-content')); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

/* ══════════════════════════════════
   MAINTENANCE MODE PANEL
══════════════════════════════════ */
function buildMaintenancePanel(content) {
  content.innerHTML =
    '<div class="admin-panel">' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">🔧 Maintenance Mode</div>' +
        '<div style="font-size:.75rem;color:var(--muted);margin-bottom:.75rem">When ON — nobody can log in or register. You (Owner/Super Admin) are always exempt.</div>' +
        '<div id="maint-status" style="font-size:.88rem;font-weight:700;margin-bottom:1rem;padding:.6rem;border-radius:8px;text-align:center">Loading...</div>' +
        '<textarea id="maint-msg" rows="3" placeholder="Message shown to users..." style="width:100%;box-sizing:border-box;padding:.6rem;background:var(--bg3);border:.5px solid var(--border);border-radius:8px;color:var(--text);font-size:.82rem;font-family:inherit;outline:none;resize:none;margin-bottom:.75rem"></textarea>' +
        '<div style="display:flex;gap:.5rem">' +
          '<button class="save-pill" style="flex:1;background:var(--red)" onclick="setMaintenance(true)">🔴 Turn ON</button>' +
          '<button class="save-pill" style="flex:1;background:var(--green)" onclick="setMaintenance(false)">🟢 Turn OFF</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  api.get('/admin/maintenance')
    .then(function (res) {
      var el = document.getElementById('maint-status');
      var msgEl = document.getElementById('maint-msg');
      if (!el) return;
      el.style.background = res.maintenance_mode ? 'rgba(226,75,74,.15)' : 'rgba(63,185,80,.1)';
      el.style.color = res.maintenance_mode ? 'var(--red)' : 'var(--green)';
      el.textContent = res.maintenance_mode ? '🔴 MAINTENANCE MODE IS ON' : '🟢 Site is running normally';
      if (msgEl) msgEl.value = res.message || '';
    })
    .catch(function () {});
}

window.setMaintenance = function (enabled) {
  var msg = (document.getElementById('maint-msg') || {}).value || '';
  api.post('/admin/maintenance', { enabled: enabled, message: msg })
    .then(function () {
      toast(enabled ? '🔴 Maintenance ON' : '🟢 Maintenance OFF');
      buildMaintenancePanel(document.getElementById('admin-content'));
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

/* ══════════════════════════════════
   AD-FREE USERS PANEL
══════════════════════════════════ */
function buildAdExemptPanel(content) {
  content.innerHTML =
    '<div class="admin-panel">' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">🚫📣 Ad-Free Users</div>' +
        '<div style="font-size:.72rem;color:var(--muted);margin-bottom:.75rem">These users will NEVER see any ads. Only Owner/Co-Owner can manage this.</div>' +
        '<div style="display:flex;gap:.5rem;margin-bottom:.75rem">' +
          '<input id="exempt-global-search" class="admin-search" placeholder="Search user to grant ad-free..." oninput="exemptGlobalSearch()" style="margin-bottom:0">' +
        '</div>' +
        '<div id="exempt-global-results" style="margin-bottom:.75rem"></div>' +
        '<div style="font-size:.78rem;font-weight:700;margin-bottom:.4rem;color:var(--text)">Currently ad-free:</div>' +
        '<div id="exempt-global-list"><div class="feed-state"><div class="spinner"></div></div></div>' +
      '</div>' +
    '</div>';
  loadGlobalExemptList();
}

function loadGlobalExemptList() {
  api.get('/admin/ad-exempt')
    .then(function (res) {
      var el = document.getElementById('exempt-global-list');
      if (!el) return;
      var users = res.users || [];
      if (!users.length) {
        el.innerHTML = '<div style="font-size:.8rem;color:var(--muted);padding:.5rem 0">No ad-free users yet</div>';
        return;
      }
      el.innerHTML = users.map(function (u) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:.5rem 0;border-bottom:.5px solid var(--border)">' +
          '<div>' +
            '<div style="font-size:.82rem;font-weight:700">@' + escHtml(u.nickname) + '</div>' +
            '<div style="font-size:.67rem;color:var(--muted)">' + escHtml(u.email || '') + '</div>' +
          '</div>' +
          '<button class="save-pill" style="background:var(--red)" onclick="adminRevokeAdFree(\'' + u.id + '\')">Remove</button>' +
        '</div>';
      }).join('');
    })
    .catch(function () {});
}

window.exemptGlobalSearch = function () {
  var q = (document.getElementById('exempt-global-search') || {}).value || '';
  var el = document.getElementById('exempt-global-results');
  if (!el) return;
  if (q.length < 2) { el.innerHTML = ''; return; }
  api.get('/admin/users?search=' + encodeURIComponent(q))
    .then(function (res) {
      var users = (res.users || []).filter(function (u) { return !u.no_ads; });
      el.innerHTML = users.slice(0,5).map(function (u) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:.4rem .5rem;background:var(--bg3);border-radius:8px;margin-bottom:.35rem">' +
          '<span style="font-size:.82rem">@' + escHtml(u.nickname) + '</span>' +
          '<button class="save-pill" style="background:var(--green)" onclick="adminGrantAdFree(\'' + u.id + '\')">+ Grant Ad-Free</button>' +
        '</div>';
      }).join('') || '<div style="font-size:.78rem;color:var(--muted);padding:.35rem 0">No users found</div>';
    })
    .catch(function () {});
};

window.adminGrantAdFree = function (id) {
  api.put('/admin/users', { id: id, no_ads: true })
    .then(function () {
      toast('🚫 Ad-free granted!');
      var el = document.getElementById('exempt-global-search');
      if (el) el.value = '';
      var r = document.getElementById('exempt-global-results');
      if (r) r.innerHTML = '';
      loadGlobalExemptList();
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.adminRevokeAdFree = function (id) {
  api.put('/admin/users', { id: id, no_ads: false })
    .then(function () { toast('✅ Ads restored'); loadGlobalExemptList(); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

/* ══════════════════════════════════
   NUCLEAR PANEL ☢️
══════════════════════════════════ */
var NUCLEAR_CATS = [
  { id:'shorts',   label:'📹 Videos (Shorts)',       desc:'אלע ווידעא אפלאודס' },
  { id:'music',    label:'🎵 Music',                 desc:'אלע מוזיק טרעקס' },
  { id:'channels', label:'📡 Channel Posts',         desc:'אלע קאנאל פּאסטן' },
  { id:'statuses', label:'🌀 Statuses / Stories',    desc:'אלע סטאטוסן' },
  { id:'messages', label:'💬 Chat Messages',         desc:'אלע גרופּע מעסידזשעס' },
  { id:'posts',    label:'📝 Posts',                 desc:'אלע פּאסטן' },
];

function buildNuclearPanel(content) {
  content.innerHTML =
    '<div class="admin-panel">' +
      '<div class="admin-card" style="border-color:rgba(226,75,74,.4)">' +
        '<div class="admin-card-title" style="color:var(--red)">☢️ Nuclear — Hide / Restore Content</div>' +
        '<div style="font-size:.72rem;color:var(--muted);margin-bottom:1rem;padding:.6rem;background:rgba(226,75,74,.06);border:1px solid rgba(226,75,74,.2);border-radius:8px">⚠️ Hide מאכט אז קיינער קען עס נישט זעהן. Restore ברענגט עס צוריק. קיינע דאטן ווערן אויסגעמעקט.</div>' +
        NUCLEAR_CATS.map(function (c) {
          return '<div style="display:flex;justify-content:space-between;align-items:center;padding:.65rem 0;border-bottom:.5px solid var(--border)">' +
            '<div>' +
              '<div style="font-size:.82rem;font-weight:700">' + c.label + '</div>' +
              '<div style="font-size:.68rem;color:var(--muted)">' + c.desc + '</div>' +
            '</div>' +
            '<div style="display:flex;gap:.35rem">' +
              '<button class="save-pill" style="background:var(--red)" onclick="nuclearAction(\'' + c.id + '\',\'hide\')">🔴 Hide All</button>' +
              '<button class="save-pill" style="background:var(--green)" onclick="nuclearAction(\'' + c.id + '\',\'restore\')">🟢 Restore</button>' +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">👥 Nuclear Permissions</div>' +
        '<div style="font-size:.72rem;color:var(--muted);margin-bottom:.75rem">מאך אז א ספּעציפישן אדמין זאל אויך קענען נוצן Nuclear.</div>' +
        '<div style="display:flex;gap:.5rem;margin-bottom:.75rem">' +
          '<input id="nuclear-perm-search" class="admin-search" placeholder="זוך יוזער..." oninput="nuclearPermSearch()" style="margin-bottom:0">' +
        '</div>' +
        '<div id="nuclear-perm-results" style="margin-bottom:.75rem"></div>' +
        '<div style="font-size:.78rem;font-weight:700;margin-bottom:.4rem">מיט Nuclear רעכטן:</div>' +
        '<div id="nuclear-perm-list"><div class="feed-state"><div class="spinner"></div></div></div>' +
      '</div>' +
    '</div>';
  loadNuclearPermList();
}

window.nuclearAction = function (category, action) {
  var label = action === 'hide' ? 'HIDE ALL' : 'RESTORE ALL';
  if (!confirm('⚠️ ' + label + ' ' + category + '?\n\nAre you sure?')) return;
  api.post('/admin/nuclear', { category: category, action: action })
    .then(function () { toast(action === 'hide' ? '🔴 Hidden!' : '🟢 Restored!'); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

function loadNuclearPermList() {
  api.get('/admin/nuclear?permissions=1')
    .then(function (res) {
      var el = document.getElementById('nuclear-perm-list');
      if (!el) return;
      var perms = res.permissions || [];
      if (!perms.length) {
        el.innerHTML = '<div style="font-size:.8rem;color:var(--muted);padding:.5rem 0">Nobody else has Nuclear access yet</div>';
        return;
      }
      el.innerHTML = perms.map(function (p) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:.5rem 0;border-bottom:.5px solid var(--border)">' +
          '<div>' +
            '<div style="font-size:.82rem;font-weight:700">@' + escHtml(p.nickname) + '</div>' +
            '<div style="font-size:.67rem;color:var(--muted)">Granted by @' + escHtml(p.granted_by) + ' · ' + timeAgo(p.created_at) + '</div>' +
          '</div>' +
          '<button class="save-pill" style="background:var(--red)" onclick="adminRevokeNuclear(\'' + p.user_id + '\')">Revoke</button>' +
        '</div>';
      }).join('');
    })
    .catch(function () {});
}

window.nuclearPermSearch = function () {
  var q = (document.getElementById('nuclear-perm-search') || {}).value || '';
  var el = document.getElementById('nuclear-perm-results');
  if (!el) return;
  if (q.length < 2) { el.innerHTML = ''; return; }
  api.get('/admin/users?search=' + encodeURIComponent(q))
    .then(function (res) {
      var users = res.users || [];
      el.innerHTML = users.slice(0,5).map(function (u) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:.4rem .5rem;background:var(--bg3);border-radius:8px;margin-bottom:.35rem">' +
          '<span style="font-size:.82rem">@' + escHtml(u.nickname) + '</span>' +
          '<button class="save-pill" style="background:var(--gold);color:#000" onclick="adminGrantNuclear(\'' + u.id + '\')">+ Grant</button>' +
        '</div>';
      }).join('') || '<div style="font-size:.78rem;color:var(--muted)">No users found</div>';
    })
    .catch(function () {});
};

window.adminGrantNuclear = function (id) {
  api.post('/admin/nuclear?permissions=1', { user_id: id })
    .then(function () {
      toast('☢️ Nuclear access granted!');
      var el = document.getElementById('nuclear-perm-search'); if (el) el.value = '';
      var r = document.getElementById('nuclear-perm-results'); if (r) r.innerHTML = '';
      loadNuclearPermList();
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.adminRevokeNuclear = function (id) {
  if (!confirm('Remove Nuclear access?')) return;
  api.del('/admin/nuclear?permissions=1&id=' + encodeURIComponent(id))
    .then(function () { toast('✓ Access revoked'); loadNuclearPermList(); })
    .catch(function (err) { toast('❌ ' + err.message); });
};
