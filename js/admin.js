// ============================================================
// js/admin.js — Admin Panel (Cloudflare D1)
// Roles: member / admin_limited / admin_super / owner
// Uses: window.api, window.STATE, window.CONFIG, window.ROLES,
//       window.userCan, window.toast, window.setLoad,
//       window.validEmail, window.navTo, window.delay
// NO ES module imports — plain script, attaches to window.
// ============================================================

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
      var authorized = role === 'owner' ||
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

  setLoad('gate-pin', true);

  api.post('/admin/verify-pin', { pin: pin })
    .then(function () {
      setLoad('gate-pin', false);
      document.getElementById('admin-gate').classList.remove('open');

      // ADMIN_gateRole was verified server-side at the email step
      // (check-email returns 'owner' for the two owner accounts), so no
      // client-side email comparison is needed — or wanted — here.
      var role = ADMIN_gateRole || 'member';

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

      // Load the saved settings BEFORE building anything. Every panel reads
      // STATE.settings to show its current values, but nothing on this page
      // ever populated it — so each one fell back to its default and looked
      // like the setting had reverted. It never had: the values were in the
      // database the whole time, the admin panel just never asked for them.
      loadAppSettings().then(function () {
        buildAdminNav();
        navTo('admin');
      }).catch(function () {
        // Still open the panel if settings can't be read — better a panel
        // showing defaults than no panel at all.
        buildAdminNav();
        navTo('admin');
      });
    })
    .catch(function (err) {
      setLoad('gate-pin', false);
      showGateMsg('err', err && err.message ? err.message : 'Incorrect PIN. Access denied.');
      [0,1,2,3].forEach(function (i) {
        var el = document.getElementById('p'+i);
        if (el) el.value = '';
      });
      var p0 = document.getElementById('p0');
      if (p0) p0.focus();
    });
};

/* ══════════════════════════════════
   ADMIN NAV
══════════════════════════════════ */
// SVG icons for admin nav (clean, modern)
var ADMIN_ICONS = {
  'support-chats': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  analytics:      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  'app-settings': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  users:          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  reports:        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  'banned-devices': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
  'ip-logs':      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  'security':     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  'diagnostics':  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
  'channels-mgr': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
  'ai':           '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="12" rx="3"/><path d="M12 8V4"/><circle cx="8.5" cy="14" r="1"/><circle cx="15.5" cy="14" r="1"/></svg>',
  'shorts-mod':   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
  'statuses-mod': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" stroke-dasharray="4 3"/><circle cx="12" cy="12" r="3"/></svg>',
  'chat-watch':   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  'music-mod':    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  broadcast:      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.56 2 2 0 0 1 3.6 1.36h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
  feedback:       '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
  ads:            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
  'ad-exempt':    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  nuclear:        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  maintenance:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
  'audit-logs':   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
  'admin-settings': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  sessions:       '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>',
  export:         '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  leaderboard:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 20 18 10"/><polyline points="12 20 12 4"/><polyline points="6 20 6 14"/></svg>',
  announcements:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 17H2a3 3 0 0 0 3-3V9a7 7 0 0 1 14 0v5a3 3 0 0 0 3 3z"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  badges:         '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>',
  warnings:       '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  'access-control': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  'invite-codes': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z" opacity="0"/><path d="M15 7h5v5"/><path d="M20 7l-8 8"/><path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg>',
  'verify-requests': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  now:            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>',
  features:       '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>',
};

var ADMIN_PANELS = [
  { id:'now',            label:'Now',             roles:['admin_limited','admin_super','owner'] },
  { id:'features',       label:'Features',        roles:['owner'] },
  { id:'analytics',      label:'Analytics',      roles:['admin_limited','admin_super','owner'] },
  { id:'growth',         label:'Growth',          roles:['admin_limited','admin_super','owner'] },
  { id:'health',         label:'Storage',         roles:['owner'] },
  { id:'antispam',       label:'Anti-spam',       roles:['owner'] },
  { id:'email-templates',label:'Email',           roles:['owner'] },
  { id:'featured',       label:'Featured',        roles:['admin_super','owner'] },
  { id:'users',          label:'Users',           roles:['admin_limited','admin_super','owner'] },
  { id:'reports',        label:'Reports',         roles:['admin_limited','admin_super','owner'] },
  { id:'warnings',       label:'Warnings',        roles:['admin_limited','admin_super','owner'] },
  { id:'leaderboard',    label:'Leaderboard',     roles:['admin_limited','admin_super','owner'] },
  { id:'announcements',  label:'Announcements',   roles:['admin_limited','admin_super','owner'] },
  { id:'shorts-mod',     label:'Shorts',          roles:['admin_limited','admin_super','owner'] },
  { id:'statuses-mod',   label:'Statuses',        roles:['admin_super','owner'] },
  { id:'music-mod',      label:'Music',           roles:['admin_limited','admin_super','owner'] },
  { id:'feedback',       label:'Feedback',        roles:['admin_limited','admin_super','owner'] },
  { id:'support-chats',  label:'Support',         roles:['admin_limited','admin_super','owner'] },
  { id:'chat-watch',     label:'Chats',           roles:['admin_limited','admin_super','owner'] },
  // Everything below requires actual configuration/creation power, or exposes
  // extra personal information beyond what's needed to moderate — owner only.
  { id:'channels-mgr',   label:'Channels',        roles:['owner'] },
  { id:'ai',             label:'YID PLUS AI',     roles:['owner'] },
  { id:'access-control', label:'Access',          roles:['owner'] },
  { id:'invite-codes',   label:'Invites',         roles:['owner'] },
  { id:'verify-requests',label:'Verify',          roles:['admin_limited','admin_super','owner'] },
  { id:'broadcast',      label:'Broadcast',       roles:['owner'] },
  { id:'banned-devices', label:'Banned',          roles:['owner'] },
  { id:'ip-logs',        label:'IP Logs',         roles:['owner'] },
  { id:'security',       label:'Attacks',         roles:['owner'] },
  { id:'diagnostics',    label:'Health Check',    roles:['owner'] },
  { id:'sessions',       label:'Sessions',        roles:['owner'] },
  { id:'audit-logs',     label:'Audit Logs',      roles:['owner'] },
  { id:'ads',            label:'Ads',             roles:['owner'] },
  { id:'maintenance',    label:'Maintenance',     roles:['owner'] },
  { id:'app-settings',   label:'App',             roles:['owner'] },
  { id:'badges',         label:'Badges',          roles:['owner'] },
  { id:'ad-exempt',      label:'Ad-Free',         roles:['owner'] },
  { id:'nuclear',        label:'Nuclear',         roles:['owner'] },
  { id:'bad-words',      label:'Word Filter',     roles:['owner'] },
  { id:'export',         label:'Export',          roles:['owner'] },
  { id:'telegram',       label:'Telegram',        roles:['owner'] },
  { id:'admin-settings', label:'Admin Settings',  roles:['owner'] },
];

/* ══════════════════════════════════
   GROUPED DASHBOARD (categories)
══════════════════════════════════ */
var ADMIN_CATEGORIES = [
  { id:'overview',   label:'Overview',   desc:'Now, analytics and leaderboard',       color:'#185FA5', bg:'#E6F1FB', bgd:'#0C447C',
    panels:['now','analytics','growth','leaderboard'] },
  { id:'people',     label:'People',     desc:'Access, verify, users, invites',       color:'#0F6E56', bg:'#E1F5EE', bgd:'#085041',
    panels:['access-control','verify-requests','invite-codes','users','warnings','badges','sessions','banned-devices','ad-exempt'] },
  { id:'moderation', label:'Moderation', desc:'Reports, feedback, support, filter',   color:'#A32D2D', bg:'#FCEBEB', bgd:'#791F1F',
    panels:['reports','feedback','support-chats','chat-watch','shorts-mod','statuses-mod','music-mod','bad-words'] },
  { id:'content',    label:'Content',    desc:'Announce, broadcast, channels, more',  color:'#534AB7', bg:'#EEEDFE', bgd:'#3C3489',
    panels:['announcements','broadcast','channels-mgr','ai','telegram','email-templates','featured'] },
  { id:'system',     label:'System',     desc:'Features, app, ads, logs, export',     color:'#5F5E5A', bg:'#F1EFE8', bgd:'#2C2C2A',
    panels:['features','app-settings','ads','maintenance','antispam','health','security','diagnostics','ip-logs','audit-logs','export','nuclear','admin-settings'] },
];

var ADMIN_CAT_ICONS = {
  overview:   '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  people:     '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  moderation: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
  content:    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>',
  system:     '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
};

function _adminPanelById(id) {
  for (var i = 0; i < ADMIN_PANELS.length; i++) if (ADMIN_PANELS[i].id === id) return ADMIN_PANELS[i];
  return null;
}
function _adminAccessiblePanels(cat, role) {
  return cat.panels
    .map(_adminPanelById)
    .filter(function (p) { return p && p.roles.indexOf(role) !== -1; });
}

// Entry point: show the grouped category home.
function buildAdminNav() {
  showAdminHome();
}

function showAdminHome() {
  clearInterval(window._adminAnalyticsTimer);
  var nav = document.getElementById('admin-nav-row');
  if (nav) { nav.innerHTML = ''; nav.style.display = 'none'; }

  var content = document.getElementById('admin-content');
  if (!content) return;
  var role = ADMIN_gateRole || 'member';
  var dark = document.documentElement.classList.contains('dark-mode');

  var cards = ADMIN_CATEGORIES
    .map(function (cat) {
      var panels = _adminAccessiblePanels(cat, role);
      if (!panels.length) return '';
      var tint = dark ? cat.bgd : cat.bg;
      var fg   = dark ? '#fff' : cat.color;
      return '<button class="admin-cat-card" onclick="openAdminCategory(\'' + cat.id + '\')">' +
          '<span class="acc-ic" style="background:' + tint + ';color:' + fg + '">' + ADMIN_CAT_ICONS[cat.id] + '</span>' +
          '<span class="acc-txt">' +
            '<span class="acc-title">' + cat.label + '</span>' +
            '<span class="acc-desc">' + cat.desc + '</span>' +
          '</span>' +
          '<span class="acc-meta">' + panels.length + '</span>' +
          '<svg class="acc-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>' +
        '</button>';
    }).join('');

  content.innerHTML =
    '<div class="admin-home">' +
      '<div class="admin-home-hdr">Control panel</div>' +
      '<div class="admin-cat-list">' + cards + '</div>' +
    '</div>';
}

window.openAdminCategory = function (catId) {
  var cat = null;
  for (var i = 0; i < ADMIN_CATEGORIES.length; i++) if (ADMIN_CATEGORIES[i].id === catId) cat = ADMIN_CATEGORIES[i];
  if (!cat) return;
  var role = ADMIN_gateRole || 'member';
  var panels = _adminAccessiblePanels(cat, role);
  if (!panels.length) return;

  var nav = document.getElementById('admin-nav-row');
  if (nav) {
    nav.style.display = 'flex';
    nav.innerHTML = '';

    var back = document.createElement('button');
    back.className = 'anav anav-back';
    back.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>' + cat.label;
    back.onclick = showAdminHome;
    nav.appendChild(back);

    panels.forEach(function (p, i) {
      var btn = document.createElement('button');
      btn.className = 'anav' + (i === 0 ? ' active' : '');
      var icon = ADMIN_ICONS[p.id] || '';
      btn.innerHTML = icon + ' ' + p.label.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      btn.onclick = function () {
        document.querySelectorAll('.anav').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        buildAdminPanel(p.id);
      };
      nav.appendChild(btn);
    });
  }

  buildAdminPanel(panels[0].id);
};

window.init_admin = function () {};

/* ══════════════════════════════════
   ADMIN PANELS
══════════════════════════════════ */
function buildAdminPanel(id) {
  var content = document.getElementById('admin-content');
  if (!content) return;

  // Switching panels always tears down the live Attacks monitor, so its poll
  // never keeps running in the background after you've navigated away.
  if (window._secLiveTimer) { clearInterval(window._secLiveTimer); window._secLiveTimer = null; }

  if (id === 'growth') {
    buildGrowthPanel(content); return;
  }
  if (id === 'health') {
    buildHealthPanel(content); return;
  }
  if (id === 'antispam') {
    buildAntispamPanel(content); return;
  }
  if (id === 'email-templates') {
    buildEmailTemplatesPanel(content); return;
  }
  if (id === 'featured') {
    buildFeaturedPanel(content); return;
  }
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
          '<div style="font-size:.75rem;color:var(--muted);margin-bottom:.75rem">Sends to all users. Leave the time empty to send now, or pick a time to schedule it.</div>' +
          '<textarea class="bc-textarea" id="bc-textarea" rows="4" placeholder="Type your announcement..."></textarea>' +
          '<div style="display:flex;align-items:center;gap:.5rem;margin:.6rem 0">' +
            '<span style="font-size:.78rem;color:var(--muted)">🎯 Send to:</span>' +
            '<select id="bc-segment" style="flex:1;padding:.45rem;border:1px solid var(--border);border-radius:8px;background:var(--bg3);color:var(--text);font-family:inherit;font-size:.82rem">' +
              '<option value="all">Everyone</option>' +
              '<option value="new">New members (joined &lt; 7 days)</option>' +
              '<option value="verified">Verified users only</option>' +
              '<option value="unverified">Unverified users only</option>' +
            '</select>' +
          '</div>' +
          '<label style="display:flex;align-items:center;gap:.5rem;margin:.6rem 0;font-size:.82rem;cursor:pointer">' +
            '<input type="checkbox" id="bc-push" style="width:18px;height:18px;accent-color:#1F6F5C">' +
            '🔔 Also send as a push notification to phones' +
          '</label>' +
          '<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.6rem">' +
            '<span style="font-size:.78rem;color:var(--muted)">⏰ Schedule:</span>' +
            '<input type="datetime-local" id="bc-when" style="flex:1;padding:.45rem;border:1px solid var(--border);border-radius:8px;background:var(--bg3);color:var(--text);font-family:inherit;font-size:.8rem">' +
          '</div>' +
          '<button class="bc-send-btn" onclick="sendBroadcast()">📢 Send / Schedule</button>' +
        '</div>' +
        '<div class="admin-card" id="bc-scheduled-card" style="display:none">' +
          '<div class="admin-card-title">⏰ Scheduled</div>' +
          '<div id="bc-scheduled-list"></div>' +
        '</div>' +
        '<div class="admin-card">' +
          '<div class="admin-card-title">✉️ Email all users</div>' +
          '<div style="font-size:.72rem;color:var(--muted);margin-bottom:.5rem">Sends a real email to every user via yidplus.com. Use sparingly.</div>' +
          '<input id="eb-subject" type="text" placeholder="Subject" style="width:100%;padding:.6rem;border:1px solid var(--border);border-radius:10px;background:var(--bg3);color:var(--text);font-family:inherit;font-size:.85rem;margin-bottom:.5rem;box-sizing:border-box">' +
          '<textarea id="eb-message" class="bc-textarea" rows="4" placeholder="Email message..."></textarea>' +
          '<button class="bc-send-btn" style="margin-top:.5rem" onclick="sendEmailBlast()">✉️ Send email to all</button>' +
        '</div>' +
        '<div class="admin-card" id="bc-history-card">' +
          '<div class="admin-card-title">📜 Broadcast History</div>' +
          '<div id="bc-history-list"></div>' +
        '</div>' +
      '</div>';
    loadBroadcastHistory();

  } else if (id === 'app-settings') {
    var userRole = ADMIN_gateRole || (STATE.user && STATE.user.role);

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
          '<div style="display:flex;align-items:center;justify-content:space-between;padding:.75rem 0;border-bottom:.5px solid rgba(201,168,76,.06)">' +
            '<div><div style="font-size:.82rem">"Start Chat" — Sign-In Screen</div><div style="font-size:.68rem;color:var(--muted)">Lets people who can\'t sign in get help</div></div>' +
            '<label style="display:flex;align-items:center;gap:.5rem;cursor:pointer">' +
              '<input type="checkbox" id="sc-login-toggle" ' + (STATE.settings.support_chat_login_enabled !== 'false' ? 'checked' : '') + ' onchange="adminToggleSetting(\'support_chat_login_enabled\', this.checked)" style="width:18px;height:18px;cursor:pointer">' +
              '<span style="font-size:.82rem;font-weight:700">' + (STATE.settings.support_chat_login_enabled !== 'false' ? 'On' : 'Off') + '</span>' +
            '</label>' +
          '</div>' +
          '<div style="display:flex;align-items:center;justify-content:space-between;padding:.75rem 0;border-bottom:.5px solid rgba(201,168,76,.06)">' +
            '<div><div style="font-size:.82rem">"Start Chat" — Main App</div><div style="font-size:.68rem;color:var(--muted)">Lets signed-in users request help</div></div>' +
            '<label style="display:flex;align-items:center;gap:.5rem;cursor:pointer">' +
              '<input type="checkbox" id="sc-home-toggle" ' + (STATE.settings.support_chat_home_enabled !== 'false' ? 'checked' : '') + ' onchange="adminToggleSetting(\'support_chat_home_enabled\', this.checked)" style="width:18px;height:18px;cursor:pointer">' +
              '<span style="font-size:.82rem;font-weight:700">' + (STATE.settings.support_chat_home_enabled !== 'false' ? 'On' : 'Off') + '</span>' +
            '</label>' +
          '</div>' +
          '<div style="padding:.75rem 0">' +
            '<div style="font-size:.82rem;color:var(--red)">🔒 Owner accounts are hardcoded server-side</div>' +
            '<div style="font-size:.68rem;color:var(--muted);margin-top:.25rem">Cannot be changed or removed by anyone.</div>' +
            '<div style="padding:.75rem 0 0;border-top:1px solid var(--border);margin-top:.75rem">' +
            '<div style="font-size:.82rem;font-weight:700;margin-bottom:.35rem">📧 Email Delivery Test</div>' +
            '<div style="font-size:.68rem;color:var(--muted);margin-bottom:.5rem">Send a test email and see exactly what happens — the quickest way to find out why verification / reset emails aren\'t arriving.</div>' +
            '<input class="field" id="email-test-to" placeholder="Send test to... (defaults to your email)">' +
            '<button class="act-btn" style="background:#1F6F5C;color:#fff;border-color:transparent" onclick="runEmailTest()">Send Test Email</button>' +
            '<div id="email-test-result" style="margin-top:.6rem;font-size:.72rem;white-space:pre-wrap;word-break:break-word"></div>' +
          '</div>' +
        '</div>' +
        '<div class="admin-card">' +
          '<div class="admin-card-title">🔒 Admin PIN</div>' +
          '<div style="font-size:.78rem;color:var(--text);line-height:1.5;padding:.5rem 0">The PIN is now verified on the server (not stored or checked in the browser). To set or change it:</div>' +
          '<div style="font-size:.72rem;color:var(--muted);line-height:1.6">1. Cloudflare Dashboard → Workers &amp; Pages → your project → Settings → Environment Variables<br>2. Add/edit the secret <code style="background:var(--bg3);padding:1px 5px;border-radius:4px">ADMIN_PIN</code> (4 digits)<br>3. Redeploy for the change to take effect</div>' +
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
  } else if (id === 'statuses-mod') {
    buildStatusesModPanel(content);

  } else if (id === 'chat-watch') {
    buildChatWatchPanel(content);

  } else if (id === 'music-mod') {
    buildMusicModPanel(content);

  } else if (id === 'feedback') {
    buildFeedbackPanel(content);

  } else if (id === 'support-chats') {
    buildSupportChatsPanel(content);

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

  } else if (id === 'bad-words') {
    buildBadWordsPanel(content);

  } else if (id === 'reports') {
    buildReportsPanel(content);

  } else if (id === 'banned-devices') {
    buildBannedDevicesPanel(content);

  } else if (id === 'ip-logs') {
    buildIpLogsPanel(content);
  } else if (id === 'security') {
    buildSecurityPanel(content);

  } else if (id === 'diagnostics') {
    buildDiagnosticsPanel(content);

  } else if (id === 'channels-mgr') {
    buildChannelsMgrPanel(content);

  } else if (id === 'ai') {
    buildAIPanel(content);

  } else if (id === 'access-control') {
    buildAccessControlPanel(content);

  } else if (id === 'invite-codes') {
    buildInviteCodesPanel(content);

  } else if (id === 'verify-requests') {
    buildVerifyRequestsPanel(content);

  } else if (id === 'now') {
    buildNowPanel(content);

  } else if (id === 'features') {
    buildFeaturesPanel(content);

  } else if (id === 'maintenance') {
    buildMaintenancePanel(content);

  } else if (id === 'sessions') {
    buildSessionsPanel(content);

  } else if (id === 'export') {
    buildExportPanel(content);

  } else if (id === 'leaderboard') {
    buildLeaderboardPanel(content);

  } else if (id === 'announcements') {
    buildAnnouncementsPanel(content);

  } else if (id === 'badges') {
    buildBadgesPanel(content);

  } else if (id === 'warnings') {
    buildWarningsPanel(content);

  } else if (id === 'telegram') {
    buildTelegramPanel(content);

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
  ypConfirm('Delete this short?', { danger: true }).then(function (ok) {
    if (!ok) return;
    api.del('/shorts?id=' + encodeURIComponent(id))
      .then(function () { toast('🗑 Deleted.'); buildShortsModPanel(document.getElementById('admin-content')); })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
};

/* ── CHAT WATCH ── */
var _cwRooms = [];
var _cwDisabled = {};
var _cwFilter = 'all';

function buildChatWatchPanel(content) {
  content.innerHTML =
    '<div class="admin-panel">' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">💬 All Chats (God-Mode)</div>' +
        '<div style="font-size:.72rem;color:var(--muted);margin-bottom:.6rem">See and read every chat. View is invisible — it leaves no trace.</div>' +
        '<div id="cw-filters" style="display:flex;gap:.4rem;margin-bottom:.6rem;flex-wrap:wrap">' +
          '<button class="cw-fbtn on" data-f="all" onclick="_cwSetFilter(\'all\',this)">All</button>' +
          '<button class="cw-fbtn" data-f="private" onclick="_cwSetFilter(\'private\',this)">🔒 Private</button>' +
          '<button class="cw-fbtn" data-f="group" onclick="_cwSetFilter(\'group\',this)">👥 Groups</button>' +
          '<button class="cw-fbtn" data-f="channel" onclick="_cwSetFilter(\'channel\',this)">📡 Channels</button>' +
        '</div>' +
        '<input id="cw-search" placeholder="Search names…" oninput="_cwRender()" style="width:100%;padding:.55rem .8rem;border:1px solid var(--border);border-radius:10px;background:var(--bg3);color:var(--text);font-family:inherit;font-size:.85rem;margin-bottom:.6rem;box-sizing:border-box">' +
        '<div id="chat-watch-list"><div class="feed-state"><div class="spinner"></div></div></div>' +
      '</div>' +
    '</div>';

  Promise.all([
    api.get('/admin/rooms'),
    api.get('/admin/room-control').catch(function () { return { disabled: [] }; }),
  ])
    .then(function (out) {
      _cwRooms = (out[0] && out[0].rooms) || [];
      _cwDisabled = {};
      ((out[1] && out[1].disabled) || []).forEach(function (id) { _cwDisabled[id] = true; });
      _cwRender();
    })
    .catch(function (err) {
      var el = document.getElementById('chat-watch-list');
      if (el) el.innerHTML = '<div style="padding:1rem;color:var(--red);font-size:.8rem">' + escHtml(err.message) + '</div>';
    });
}

window._cwSetFilter = function (f, btn) {
  _cwFilter = f;
  document.querySelectorAll('.cw-fbtn').forEach(function (b) { b.classList.remove('on'); });
  if (btn) btn.classList.add('on');
  _cwRender();
};

window._cwRender = function () {
  var el = document.getElementById('chat-watch-list');
  if (!el) return;
  var q = ((document.getElementById('cw-search') || {}).value || '').toLowerCase().trim();

  var rooms = _cwRooms.filter(function (r) {
    if (_cwFilter !== 'all' && r.type !== _cwFilter) return false;
    if (q) {
      var nm = (r.nick || r.name || '').toLowerCase();
      if (nm.indexOf(q) === -1) return false;
    }
    return true;
  });

  if (!rooms.length) {
    el.innerHTML = '<div style="padding:1rem;text-align:center;font-size:.8rem;color:var(--muted)">No chats here</div>';
    return;
  }

  el.innerHTML =
    '<div style="font-size:.68rem;color:var(--muted);margin-bottom:.5rem">' + rooms.length + ' ' + (_cwFilter === 'all' ? 'chats' : _cwFilter + 's') + '</div>' +
    rooms.map(function (r) {
      var off = !!_cwDisabled[r.id];
      var rn = r.nick || r.name || (r.type === 'private' ? 'Private chat' : 'Chat');
      var nm = escHtml(rn).replace(/'/g, "\\'");
      var typeIcon = r.type === 'private' ? '🔒' : r.type === 'channel' ? '📡' : '👥';
      var count = r.type === 'private' ? '' : ' <span style="font-size:.63rem;color:var(--muted)">(' + (r.members || 0) + ')</span>';
      return '<div class="chat-room-row" style="flex-wrap:wrap;opacity:' + (off ? '.6' : '1') + '">' +
        '<div class="cr-icon">' + (r.emoji || typeIcon) + '</div>' +
        '<div class="cr-info" onclick="adminViewRoom(\'' + r.id + '\',\'' + nm + '\')" style="cursor:pointer"><div class="cr-name" dir="auto">' + escHtml(rn) + count + (off ? ' <span style="font-size:.6rem;color:#D32F2F;font-weight:700">HIDDEN</span>' : '') + '</div>' +
        '<div class="cr-preview" dir="auto">' + escHtml(r.preview || '') + '</div></div>' +
        '<div style="display:flex;gap:.35rem;width:100%;margin-top:.5rem">' +
          '<button onclick="adminViewRoom(\'' + r.id + '\',\'' + nm + '\')" style="flex:1;padding:.4rem;background:var(--bg3);border:1px solid var(--border);border-radius:8px;font-size:.72rem;font-weight:700;color:var(--text);cursor:pointer;font-family:inherit">👁 Read</button>' +
          '<button onclick="adminToggleRoom(\'' + r.id + '\',' + (off ? 'false' : 'true') + ')" style="flex:1;padding:.4rem;background:' + (off ? '#16A34A' : '#B45309') + ';border:none;border-radius:8px;font-size:.72rem;font-weight:700;color:#fff;cursor:pointer;font-family:inherit">' + (off ? '↩ Unhide' : '🚫 Hide') + '</button>' +
          '<button onclick="adminDeleteRoom(\'' + r.id + '\',\'' + nm + '\')" style="flex:1;padding:.4rem;background:none;border:1px solid #E5989B;border-radius:8px;font-size:.72rem;font-weight:700;color:#D32F2F;cursor:pointer;font-family:inherit">🗑 Delete</button>' +
        '</div>' +
      '</div>';
    }).join('');
};

// Hide (reversible) or unhide a group/channel from all regular users.
window.adminToggleRoom = function (roomId, hide) {
  function _go() {
    api.post('/admin/room-control', { room_id: roomId, action: hide ? 'hide' : 'unhide' })
      .then(function () { toast(hide ? '🚫 Hidden' : '↩ Unhidden'); buildChatWatchPanel(document.getElementById('admin-content')); })
      .catch(function (err) { toast('❌ ' + err.message); });
  }
  if (hide) ypConfirm('Hide this group/channel? Regular users won\'t see it. You can unhide anytime.').then(function (ok) { if (ok) _go(); });
  else _go();
};

// Permanently delete a group/channel and all its messages.
window.adminDeleteRoom = function (roomId, name) {
  ypConfirm('PERMANENTLY delete "' + name + '"?\nAll its messages will be gone. This cannot be undone.', { danger: true }).then(function (ok) {
    if (!ok) return;
    ypConfirm('Are you absolutely sure? This is permanent.', { danger: true }).then(function (ok) {
      if (!ok) return;
      api.del('/admin/room-control?room_id=' + encodeURIComponent(roomId))
        .then(function () { toast('🗑 Deleted'); buildChatWatchPanel(document.getElementById('admin-content')); })
        .catch(function (err) { toast('❌ ' + err.message); });
    });
  });
};

window.adminViewRoom = function (roomId, name) {
  var overlay = document.getElementById('gm-viewer');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'gm-viewer';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center';
  overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML =
    '<div style="background:var(--bg);width:100%;max-width:600px;height:88vh;border-radius:16px 16px 0 0;display:flex;flex-direction:column;overflow:hidden">' +
      '<div style="padding:.9rem 1rem;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:.6rem;flex-shrink:0">' +
        '<div style="flex:1;min-width:0"><div dir="auto" style="font-weight:800;font-size:1rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(name) + '</div><div style="font-size:.66rem;color:var(--muted)">👁 God-mode · read-only · invisible</div></div>' +
        '<button onclick="document.getElementById(\'gm-viewer\').remove()" style="background:var(--bg3);border:none;width:34px;height:34px;border-radius:50%;font-size:1.1rem;cursor:pointer;color:var(--text);flex-shrink:0">✕</button>' +
      '</div>' +
      '<div id="gm-msgs" style="flex:1;overflow-y:auto;padding:1rem;display:flex;flex-direction:column;gap:.5rem;background:var(--bg2)"><div style="text-align:center;padding:2rem"><div class="spinner"></div></div></div>' +
    '</div>';
  document.body.appendChild(overlay);

  api.get('/chat?room_id=' + encodeURIComponent(roomId))
    .then(function (res) {
      var msgs = res.messages || [];
      var box = document.getElementById('gm-msgs');
      if (!box) return;
      if (!msgs.length) {
        box.innerHTML = '<div style="text-align:center;color:var(--muted);padding:2rem">No messages in this chat</div>';
        return;
      }
      box.innerHTML = msgs.map(function (m) {
        var k = (m.media_key || '').toLowerCase();
        var body;
        if (m.type === 'text' || !m.type) body = escHtml(m.text || '');
        else if (m.type === 'poll') body = '📊 Poll';
        else if (m.type === 'voice') body = '🎤 Voice note';
        else if (/\.(mp4|webm|mov)$/.test(k)) body = '🎬 Video';
        else if (/\.(jpg|jpeg|png|gif|webp)$/.test(k)) body = '🖼️ Photo';
        else if (m.media_key) body = '📎 File';
        else body = escHtml(m.text || ('[' + (m.type || 'message') + ']'));

        var media = '';
        if (/\.(jpg|jpeg|png|gif|webp)$/.test(k)) {
          media = '<img src="/api/media/' + encodeURIComponent(m.media_key) + '" style="max-width:200px;max-height:200px;border-radius:8px;margin-top:.35rem;display:block" onerror="this.style.display=\'none\'">';
        }
        return '<div style="background:var(--bg);border:.5px solid var(--border);border-radius:10px;padding:.5rem .7rem;max-width:88%">' +
            '<div style="font-size:.72rem;font-weight:700;color:#1F6F5C;margin-bottom:.15rem">@' + escHtml(m.sender_nick || '?') + ' <span style="color:var(--muted);font-weight:400">· ' + timeAgo(m.created_at) + '</span></div>' +
            '<div dir="auto" style="font-size:.9rem;line-height:1.4;word-break:break-word">' + body + '</div>' + media +
          '</div>';
      }).join('');
      box.scrollTop = box.scrollHeight;
    })
    .catch(function (err) {
      var box = document.getElementById('gm-msgs');
      if (box) box.innerHTML = '<div style="color:var(--red);padding:1rem">' + escHtml(err.message) + '</div>';
    });
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
  ypConfirm('Remove "' + MUSIC_ADMIN_DATA[i].name + '" from the platform?', { danger: true }).then(function (ok) {
    if (!ok) return;
    MUSIC_ADMIN_DATA.splice(i, 1);
    renderMusicMod();
    toast('🗑 Track removed.');
  });
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
              '<span class="fb-type ' + (f.type === 'bug' ? 'fb-bug' : f.type === 'block_appeal' ? 'fb-bug' : 'fb-suggest') + '" style="' + (f.type === 'block_appeal' ? 'background:#7A1F2B' : '') + '">' + (f.type === 'bug' ? '🐛 Bug' : f.type === 'block_appeal' ? '🚫 Block Appeal' : '💡 Suggestion') + '</span>' +
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
  ypConfirm('Delete this feedback?', { danger: true }).then(function (ok) {
    if (!ok) return;
    api.del('/feedback?id=' + encodeURIComponent(id))
      .then(function () { toast('🗑 Deleted.'); buildFeedbackPanel(document.getElementById('admin-content')); })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
};

/* ── ANALYTICS ── */
function refreshAnalytics() {
  api.get('/admin/stats', true)
    .then(function (res) {
      var stats  = res.stats || {};
      var online = stats.online    || 0;
      var total  = stats.users     || 0;
      var shorts = stats.shorts    || 0;
      var msgs   = stats.messages  || 0;
      var music  = stats.music     || 0;
      var newTdy = stats.new_today || 0;
      var openRp = stats.open_reports || 0;

      // Daily visitors from API
      var dailyData = res.daily_visitors || [];
      var vals = dailyData.map(function(d){ return d.visitors || 0; });
      // Pad to 7 days if needed
      while (vals.length < 7) vals.unshift(0);
      vals = vals.slice(-7);
      var max = Math.max.apply(null, vals) || 1;

      var liveCt = document.getElementById('live-ct');
      if (liveCt) liveCt.textContent = '● ' + online + ' users online now';

      var grid = document.getElementById('stats-grid');
      if (grid) {
        var cards = [
          ['Total Users',    total,  '↑ ' + newTdy + ' today',  'up'],
          ['Online Now',     online, 'Live count',               'up'],
          ['Videos',         shorts, 'Cloudflare R2',            'up'],
          ['Messages',       msgs,   'Cloudflare D1',            'up'],
          ['Music Tracks',   music,  'Cloudflare R2',            'up'],
          ['Open Reports',   openRp, 'Needs review',             openRp > 0 ? 'down' : 'up'],
        ];
        grid.innerHTML = cards.map(function (c) {
          return '<div class="stat-card">' +
            '<div class="stat-num">' + fmtN(c[1]) + '</div>' +
            '<div class="stat-lbl">' + c[0] + '</div>' +
            '<div style="font-size:.65rem;color:' + (c[3]==='up'?'var(--green)':'#E11D48') + ';margin-top:.15rem">' + c[2] + '</div>' +
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
    var isOwnerRow = !!u.protected;
    var canBlock   = userCan('block_users') && !isOwnerRow;
    var canManage  = userCan('manage_users') && !isOwnerRow;
    var roleClass  = (u.role === 'admin_super' || u.role === 'admin_limited') ? 'admin' : 'user';
    var roleBadge  = '<span class="role-badge role-' + roleClass + '">' + (u.role || 'member') + '</span>';
    var isMuted    = !!(u.muted_until && new Date(u.muted_until).getTime() > Date.now());

    var SVG_EDIT   = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>';
    var SVG_DEL    = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
    var SVG_BAN    = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>';
    var SVG_VERIFY = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    var SVG_PROMO  = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>';
    var SVG_DEMOTE = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    var SVG_ADS    = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';

    var isViewingAsOwner = userCan('view_pii') && (ADMIN_gateRole === 'owner' || (typeof isOwner === 'function' && isOwner()));
    var actions = '';
    if (isViewingAsOwner && !isOwnerRow) {
      actions += '<button class="act-btn" style="background:var(--muted);color:#fff;border-color:var(--muted)" onclick="openUserDetailModal(\'' + u.id + '\')">🔍 Details</button>';
      actions += '<button class="act-btn" style="background:#1F6F5C;color:#fff;border-color:#1F6F5C" onclick="adminEditUser(\'' + u.id + '\')">' + SVG_EDIT + ' Edit</button>';
      actions += '<button class="act-btn act-verify" onclick="adminVerify(\'' + u.id + '\',\'' + !!u.verified + '\')">' + SVG_VERIFY + ' ' + (u.verified ? 'Unverify' : 'Verify') + '</button>';
      actions += '<button class="act-btn act-promote" onclick="adminPromote(\'' + u.id + '\',\'' + (u.role || 'member') + '\')">' + (u.role === 'admin_super' ? SVG_DEMOTE + ' Demote' : SVG_PROMO + ' Promote') + '</button>';
      actions += '<button class="act-btn act-block" onclick="adminBlock(\'' + u.id + '\',\'' + !!u.blocked + '\')">' + SVG_BAN + ' ' + (u.blocked ? 'Unblock' : 'Block') + '</button>';
      actions += '<button class="act-btn" style="background:' + (u.no_ads ? '#16A34A' : '#637087') + ';color:#fff;border-color:transparent" onclick="adminToggleNoAds(\'' + u.id + '\',' + !!u.no_ads + ')" title="Ad-free toggle">' + SVG_ADS + ' ' + (u.no_ads ? 'Ad-Free ON' : 'Ads ON') + '</button>';
      actions += '<button class="act-btn" style="background:#B45309;color:#fff;border-color:#B45309" onclick="acForceLogout(\'' + u.id + '\',\'' + escHtml(u.nickname||'') + '\')" title="Force sign-out">👢 Kick out</button>';
      actions += '<button class="act-btn" style="background:' + (isMuted ? '#E11D48' : '#637087') + ';color:#fff;border-color:transparent" onclick="adminMuteUser(\'' + u.id + '\',' + isMuted + ')">' + (isMuted ? '🔇 Unmute' : '🔇 Mute') + '</button>';
      actions += '<button class="act-btn" style="background:#E11D48;color:#fff;border-color:#E11D48" onclick="adminDeleteUser(\'' + u.id + '\',\'' + escHtml(u.nickname||'') + '\')">' + SVG_DEL + ' Delete</button>';
    } else {
      if (canManage) {
        actions += '<button class="act-btn act-verify" onclick="adminVerify(\'' + u.id + '\',\'' + !!u.verified + '\')">' + SVG_VERIFY + ' ' + (u.verified ? 'Unverify' : 'Verify') + '</button>';
        actions += '<button class="act-btn" style="background:' + (isMuted ? '#E11D48' : '#637087') + ';color:#fff;border-color:transparent" onclick="adminMuteUser(\'' + u.id + '\',' + isMuted + ')">' + (isMuted ? '🔇 Unmute' : '🔇 Mute') + '</button>';
        if (userCan('promote_users')) {
          actions += '<button class="act-btn act-promote" onclick="adminPromote(\'' + u.id + '\',\'' + (u.role || 'member') + '\')">' + (u.role === 'admin_super' ? SVG_DEMOTE + ' Demote' : SVG_PROMO + ' Promote') + '</button>';
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
      if (u.created_at) piiRows += '<div style="font-size:.67rem;color:var(--muted)">📅 Joined ' + timeAgo(u.created_at) + '</div>';
      piiRows += '<div style="font-size:.67rem;color:var(--muted)">' + (u.online ? '🟢 Online now' : '⚪ Offline') + '</div>';
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

window.adminSetNewPassword = function (userId) {
  ypPrompt('Enter a new temporary password for this user (they should change it after logging in):', { title: 'New password', okText: 'Set' }).then(function (pass) {
    if (pass === null) return;
    if (pass.trim().length < 6) return toast('⚠️ Password must be at least 6 characters.');
    api.put('/admin/users', { id: userId, password: pass.trim() })
      .then(function () { toast('🔑 New password set! Let them know to change it once they sign in.'); })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
};

window.adminMuteUser = function (id, currentlyMuted) {
  if (currentlyMuted) {
    api.post('/admin/mute', { user_id: id, hours: 0 })
      .then(function () { toast('🔊 Unmuted!'); buildUsersPanel(document.getElementById('admin-content')); })
      .catch(function (err) { toast('❌ ' + err.message); });
    return;
  }
  ypPrompt('Mute for how many hours? (e.g. 1, 24, 168 for a week)', { title: 'Mute user', value: '24', okText: 'Mute' }).then(function (hoursStr) {
    if (hoursStr === null) return;
    var hours = parseFloat(hoursStr);
    if (!hours || hours <= 0) return toast('⚠️ Enter a positive number of hours.');
    api.post('/admin/mute', { user_id: id, hours: hours })
      .then(function () { toast('🔇 Muted for ' + hours + 'h!'); buildUsersPanel(document.getElementById('admin-content')); })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
};

window.filterAdminUsers = function () {
  var q = (document.getElementById('usr-search') || {}).value || '';
  q = q.toLowerCase();
  var filtered = ADMIN_allUsers.filter(function (u) {
    return (u.nickname || '').toLowerCase().indexOf(q) !== -1 ||
           (u.email    || '').toLowerCase().indexOf(q) !== -1;
  });
  renderUsersList(filtered);
};

// Show the rows behind one of the activity counts. Same numbers, just opened up.
window.adminOpenUserList = function (userId, type) {
  var old = document.getElementById('adm-user-list');
  if (old) old.remove();
  var ov = document.createElement('div');
  ov.id = 'adm-user-list';
  ov.style.cssText = 'position:fixed;inset:0;z-index:980;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;justify-content:center';
  ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
  ov.innerHTML =
    '<div style="background:var(--surface);width:100%;max-width:520px;border-radius:16px 16px 0 0;height:85vh;display:flex;flex-direction:column">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:.8rem 1rem;border-bottom:1px solid var(--border);flex-shrink:0">' +
        '<div id="aul-title" style="font-weight:700;font-size:.95rem">Loading…</div>' +
        '<button onclick="document.getElementById(\'adm-user-list\').remove()" style="background:none;border:none;color:var(--muted);font-size:1.2rem;cursor:pointer">✕</button>' +
      '</div>' +
      '<div id="aul-body" style="overflow-y:auto;padding:.3rem 0"><div style="padding:1.5rem;text-align:center"><div class="spinner"></div></div></div>' +
    '</div>';
  document.body.appendChild(ov);

  api.get('/admin/user-lists?user_id=' + encodeURIComponent(userId) + '&type=' + encodeURIComponent(type))
    .then(function (res) {
      var t = document.getElementById('aul-title');
      var b = document.getElementById('aul-body');
      if (!b) return;
      if (res.error) { if (t) t.textContent = 'Error'; b.innerHTML = '<div style="padding:1.2rem;color:var(--red);font-size:.85rem">' + escHtml(res.error) + '</div>'; return; }
      var items = res.items || [];
      if (t) t.textContent = (res.title || type) + ' (' + items.length + ')';
      if (!items.length) { b.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--muted);font-size:.85rem">Nothing here.</div>'; return; }

      var isPeople = (type === 'followers' || type === 'following');
      b.innerHTML = items.map(function (it) {
        var label = it.nickname || (isPeople ? 'Unknown' : '(untitled)');
        var av = it.photo_url
          ? '<div style="width:28px;height:28px;border-radius:50%;background-image:url(' + it.photo_url + ');background-size:cover;background-position:center;flex-shrink:0"></div>'
          : '<div style="width:28px;height:28px;border-radius:' + (isPeople ? '50%' : '7px') + ';background:linear-gradient(135deg,var(--gold),var(--gold-l));color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.75rem;flex-shrink:0">' +
              escHtml(it.emoji || String(label).charAt(0).toUpperCase()) + '</div>';
        // A person opens their own admin page; anything else is just a row.
        var click = isPeople && it.id
          ? ' onclick="document.getElementById(\'adm-user-list\').remove();openUserDetailModal(\'' + it.id + '\')" style="cursor:pointer"'
          : '';
        // One line per row, date on the right — the two-line layout meant only
        // a handful fit on a phone before you had to scroll.
        return '<div' + click + ' style="display:flex;align-items:center;gap:.55rem;padding:.35rem .8rem;border-bottom:1px solid var(--border)">' +
          av +
          '<div style="flex:1;min-width:0;font-size:.85rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;unicode-bidi:plaintext;text-align:left;direction:ltr">' + escHtml(label) + '</div>' +
          '<div style="font-size:.66rem;color:var(--muted);flex-shrink:0">' + (it.created_at ? new Date(it.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '') + '</div>' +
          (isPeople ? '<span style="color:var(--muted);font-size:.85rem;flex-shrink:0">›</span>' : '') +
        '</div>';
      }).join('');
    })
    .catch(function (e) {
      var b = document.getElementById('aul-body');
      if (b) b.innerHTML = '<div style="padding:1.2rem;color:var(--red);font-size:.85rem">' + escHtml(e.message) + '</div>';
    });
};

window.openUserDetailModal = function (userId) {
  var existing = document.getElementById('user-detail-overlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'user-detail-overlay';
  overlay.className = 'modal-overlay open';
  overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML =
    '<div class="modal-sheet" style="max-height:85vh;overflow-y:auto">' +
      '<div class="modal-title" style="text-align:left;display:flex;justify-content:space-between;align-items:center">' +
        '<span>🔍 User Activity</span>' +
        '<button onclick="document.getElementById(\'user-detail-overlay\').remove()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--muted)">✕</button>' +
      '</div>' +
      '<div id="user-detail-body"><div class="feed-state"><div class="spinner"></div></div></div>' +
    '</div>';
  document.body.appendChild(overlay);

  api.get('/admin/user-detail?user_id=' + encodeURIComponent(userId))
    .then(function (res) {
      var body = document.getElementById('user-detail-body');
      if (!body) return;
      var p = res.profile, c = res.counts;

      var profileRows =
        '<div class="admin-card" style="margin:0 0 .75rem">' +
          '<div style="font-size:.95rem;font-weight:700;margin-bottom:.5rem">@' + escHtml(p.nickname || 'user') + ' ' + (p.online ? '🟢' : '⚪') + '</div>' +
          (p.email ? '<div style="font-size:.78rem;color:var(--muted)">📧 <a href="mailto:' + escHtml(p.email) + '" style="color:var(--gold)">' + escHtml(p.email) + '</a></div>' : '') +
          (p.phone ? '<div style="font-size:.78rem;color:var(--muted)">📞 <a href="tel:' + escHtml(p.phone) + '" style="color:var(--gold)">' + escHtml(p.phone) + '</a></div>' : '') +
          '<div style="font-size:.78rem;color:var(--muted)">📅 Joined ' + timeAgo(p.created_at) + '</div>' +
          '<div style="font-size:.78rem;color:var(--muted)">🎭 Role: ' + (p.role || 'member') + (p.verified ? ' · ✅ Verified' : '') + (p.blocked ? ' · 🚫 Blocked' : '') + '</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.6rem">' +
            '<button class="act-btn" style="background:#637087;color:#fff;border-color:transparent" onclick="adminSetNewPassword(\'' + userId + '\')">🔑 New Password</button>' +
            (STATE.user && STATE.user.is_owner
              ? '<button class="act-btn" style="background:#1F6F5C;color:#fff;border-color:transparent" onclick="document.getElementById(\'user-detail-overlay\').remove();startImpersonation(\'' + userId + '\',\'' + escAttrA(p.nickname || '') + '\')">👁 View as user</button>'
              : '') +
            '<button class="act-btn act-block" onclick="adminBlock(\'' + userId + '\',\'' + !!p.blocked + '\');document.getElementById(\'user-detail-overlay\').remove()">' + (p.blocked ? '✅ Unblock' : '🚫 Block account') + '</button>' +
            '<button class="act-btn" style="background:#B45309;color:#fff;border-color:#B45309" onclick="acForceLogout(\'' + userId + '\',\'' + escHtml(p.nickname||'') + '\')">👢 Kick out</button>' +
          '</div>' +
        '</div>';

      // Each count opens the list behind it — a number on its own doesn't tell
      // you who or what it's made of, which is the thing you actually want when
      // you're looking at a user. Messages stays a plain number: there's no
      // useful list to show and it can run to thousands.
      var cell = function (icon, n, label, type) {
        var v = n || 0;
        if (!type || !v) return '<div>' + icon + '<br><strong>' + v + '</strong><br>' + label + '</div>';
        return '<div onclick="adminOpenUserList(\'' + userId + '\',\'' + type + '\')" ' +
          'style="cursor:pointer;border-radius:8px;padding:.25rem 0;transition:background .12s" ' +
          'onmouseover="this.style.background=\'var(--bg3)\'" onmouseout="this.style.background=\'\'">' +
          icon + '<br><strong style="color:var(--gold)">' + v + '</strong><br>' + label +
        '</div>';
      };

      var countsGrid =
        '<div class="admin-card" style="margin:0 0 .75rem">' +
          '<div class="admin-card-title">📊 Activity Counts</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.5rem;text-align:center;font-size:.78rem">' +
            cell('👤', c.followers, 'Followers', 'followers') +
            cell('➡️', c.following, 'Following', 'following') +
            cell('💬', c.messages, 'Messages', null) +
            cell('🎬', c.shorts, 'Shorts', 'shorts') +
            cell('⭐', c.statuses, 'Statuses', 'statuses') +
            cell('🎵', c.music, 'Music', 'music') +
            cell('👥', c.groups_created, 'Groups Made', 'groups_created') +
            cell('🚪', c.groups_joined, 'Groups Joined', 'groups_joined') +
            cell('📨', c.telegram_channels, 'TG Channels', 'telegram_channels') +
          '</div>' +
          '<div style="font-size:.68rem;color:var(--muted);text-align:center;margin-top:.5rem">Tap a number to see the list</div>' +
        '</div>';

      // ── Devices & IPs — ban a blocked user's device so they can't return ──
      var devices = res.devices || [];
      var deviceRows = devices.length ? devices.map(function (d) {
        var label = escHtml(d.ip || '?') + (d.fingerprint ? ' · ' + escHtml(String(d.fingerprint).slice(0, 10)) : '');
        return '<div style="display:flex;align-items:center;gap:.5rem;padding:.45rem 0;border-bottom:.5px solid var(--border)">' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:.76rem;font-weight:700;direction:ltr;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + label + '</div>' +
              '<div style="font-size:.66rem;color:var(--muted)">' + (d.hits || 1) + ' logins · ' + timeAgo(d.last_seen) + '</div>' +
            '</div>' +
            (d.banned
              ? '<span style="font-size:.68rem;font-weight:700;color:#D32F2F">🚫 Banned</span>'
              : '<button class="act-btn" style="background:#C62828;color:#fff;border-color:#C62828" onclick="adminBanDevice(\'' + escAttrA(d.ip || '') + '\',\'' + escAttrA(d.fingerprint || '') + '\',this)">Ban device</button>') +
          '</div>';
      }).join('') : '<div style="font-size:.75rem;color:var(--muted)">No device history yet</div>';

      var devicesCard =
        '<div class="admin-card" style="margin:0 0 .75rem">' +
          '<div class="admin-card-title">📱 Devices &amp; IPs</div>' +
          '<div style="font-size:.68rem;color:var(--muted);margin-bottom:.5rem">Ban a device to stop this person returning with a new account from the same device/IP.</div>' +
          deviceRows +
        '</div>';

      var loginRows = (res.login_history || []).slice(0, 10).map(function (l) {
        return '<div style="font-size:.72rem;color:var(--muted);padding:.3rem 0;border-bottom:.5px solid var(--border)">' +
          (l.action === 'fail' ? '❌ Failed login' : '✅ Login') + ' — ' + escHtml(l.ip || '?') + ' — ' + timeAgo(l.created_at) +
        '</div>';
      }).join('') || '<div style="font-size:.75rem;color:var(--muted)">No login history yet</div>';

      var auditRows = (res.audit_as_target || []).slice(0, 10).map(function (a) {
        return '<div style="font-size:.72rem;color:var(--muted);padding:.3rem 0;border-bottom:.5px solid var(--border)">' +
          '⚡ ' + escHtml(a.action || '') + ' by @' + escHtml(a.actor_nick || '?') + ' — ' + timeAgo(a.created_at) +
        '</div>';
      }).join('') || '<div style="font-size:.75rem;color:var(--muted)">No moderation actions on this user</div>';

      body.innerHTML = profileRows + countsGrid + devicesCard +
        '<div class="admin-card" style="margin:0 0 .75rem"><div class="admin-card-title">🔐 Login History (last 10)</div>' + loginRows + '</div>' +
        '<div class="admin-card" style="margin:0 0 .75rem"><div class="admin-card-title">📋 Moderation Actions Taken Against This User</div>' + auditRows + '</div>' +
        '<div class="admin-card" style="margin:0 0 .75rem">' +
          '<div class="admin-card-title">🚫 Feature Blocks</div>' +
          '<div style="font-size:.68rem;color:var(--muted);margin-bottom:.5rem">Blocking only hides access to that feature — nothing is ever deleted.</div>' +
          '<div id="user-blocks-list" style="margin-bottom:.6rem"><div class="spinner" style="margin:.5rem auto"></div></div>' +
          '<div style="display:flex;gap:.4rem">' +
            '<select id="user-block-feature" class="field" style="flex:1;padding:.5rem">' +
              '<option value="shorts">Shorts</option>' +
              '<option value="statuses">Status</option>' +
              '<option value="music">Music</option>' +
              '<option value="channels">Channels</option>' +
              '<option value="chat">Chat</option>' +
            '</select>' +
            '<input id="user-block-hours" type="number" placeholder="Hours (blank = forever)" class="field" style="flex:1;padding:.5rem" />' +
          '</div>' +
          '<button class="save-pill" style="width:100%;margin-top:.4rem" onclick="adminAddFeatureBlock(\'' + userId + '\')">Block From This</button>' +
        '</div>' +
        '<div class="admin-card" style="margin:0">' +
          '<div class="admin-card-title">📝 Private Admin Notes</div>' +
          '<div id="user-notes-list" style="margin-bottom:.5rem"><div class="spinner" style="margin:.5rem auto"></div></div>' +
          '<textarea id="user-note-input" class="bc-textarea" rows="2" placeholder="Add a private note only admins can see..." style="margin-bottom:.4rem"></textarea>' +
          '<button class="save-pill" style="width:100%" onclick="adminAddUserNote(\'' + userId + '\')">Add Note</button>' +
        '</div>';
      loadUserNotes(userId);
      loadUserBlocks(userId);
    })
    .catch(function (err) {
      var body = document.getElementById('user-detail-body');
      if (body) body.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--red);font-size:.8rem">⚠️ ' + escHtml(err.message) + '</div>';
    });
};

var FEATURE_LABELS = { shorts: 'Shorts', statuses: 'Status', music: 'Music', channels: 'Channels', chat: 'Chat' };

function loadUserBlocks(userId) {
  var el = document.getElementById('user-blocks-list');
  if (!el) return;
  api.get('/admin/feature-blocks?user_id=' + encodeURIComponent(userId), true)
    .then(function (res) {
      var now = Date.now();
      var active = (res.blocks || []).filter(function (b) { return !b.blocked_until || new Date(b.blocked_until).getTime() > now; });
      if (!active.length) { el.innerHTML = '<div style="font-size:.75rem;color:var(--muted)">No active blocks.</div>'; return; }
      el.innerHTML = active.map(function (b) {
        var until = b.blocked_until ? 'until ' + new Date(b.blocked_until).toLocaleString() : 'indefinitely';
        return '<div style="display:flex;align-items:center;justify-content:space-between;font-size:.75rem;padding:.4rem;background:var(--bg3);border-radius:8px;margin-bottom:.35rem">' +
          '<div>🚫 <strong>' + (FEATURE_LABELS[b.feature] || b.feature) + '</strong> — ' + until + '<div style="color:var(--muted);font-size:.65rem">by @' + escHtml(b.blocked_by || '?') + '</div></div>' +
          '<button class="act-btn" style="background:#637087;color:#fff;border-color:transparent" onclick="adminRemoveFeatureBlock(\'' + userId + '\',\'' + b.feature + '\')">Unblock</button>' +
        '</div>';
      }).join('');
    })
    .catch(function () { el.innerHTML = '<div style="font-size:.75rem;color:var(--muted)">Could not load blocks.</div>'; });
}

window.adminAddFeatureBlock = function (userId) {
  var feature = document.getElementById('user-block-feature').value;
  var hoursStr = (document.getElementById('user-block-hours').value || '').trim();
  var hours = hoursStr ? parseFloat(hoursStr) : 0;
  api.post('/admin/feature-blocks', { user_id: userId, feature: feature, hours: hours })
    .then(function () {
      toast('🚫 Blocked from ' + (FEATURE_LABELS[feature] || feature) + '!');
      document.getElementById('user-block-hours').value = '';
      loadUserBlocks(userId);
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.adminRemoveFeatureBlock = function (userId, feature) {
  api.del('/admin/feature-blocks?user_id=' + encodeURIComponent(userId) + '&feature=' + encodeURIComponent(feature))
    .then(function () { toast('✅ Unblocked from ' + (FEATURE_LABELS[feature] || feature)); loadUserBlocks(userId); })
    .catch(function (err) { toast('❌ ' + err.message); });
};


function loadUserNotes(userId) {
  var el = document.getElementById('user-notes-list');
  if (!el) return;
  api.get('/admin/notes?user_id=' + encodeURIComponent(userId), true)
    .then(function (res) {
      var notes = res.notes || [];
      if (!notes.length) { el.innerHTML = '<div style="font-size:.75rem;color:var(--muted)">No notes yet.</div>'; return; }
      el.innerHTML = notes.map(function (n) {
        return '<div style="font-size:.75rem;padding:.4rem;background:var(--bg3);border-radius:8px;margin-bottom:.35rem">' +
          '<div>' + escHtml(n.note) + '</div>' +
          '<div style="color:var(--muted);font-size:.65rem;margin-top:.2rem">— @' + escHtml(n.author_nick || '?') + ' · ' + timeAgo(n.created_at) + '</div>' +
        '</div>';
      }).join('');
    })
    .catch(function () { el.innerHTML = '<div style="font-size:.75rem;color:var(--muted)">Could not load notes.</div>'; });
}

window.adminAddUserNote = function (userId) {
  var inp = document.getElementById('user-note-input');
  var note = (inp && inp.value || '').trim();
  if (!note) return toast('⚠️ Write something first.');
  api.post('/admin/notes', { user_id: userId, note: note })
    .then(function () {
      if (inp) inp.value = '';
      toast('✅ Note added!');
      loadUserNotes(userId);
    })
    .catch(function (err) { toast('❌ ' + err.message); });
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

window.adminDeleteUser = function (id, nick) {
  ypConfirm('⚠️ DELETE @' + nick + '?\n\nThis will permanently remove the user and all their data from the platform. This CANNOT be undone!', { danger: true }).then(function (ok) {
    if (!ok) return;
    api.del('/admin/users?id=' + encodeURIComponent(id))
      .then(function () {
        toast('🗑 @' + nick + ' deleted permanently.');
        buildUsersPanel(document.getElementById('admin-content'));
      })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
};


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
  var whenEl = document.getElementById('bc-when');
  var pushCb = document.getElementById('bc-push');
  var whenVal = whenEl && whenEl.value ? new Date(whenEl.value).toISOString() : null;
  var isSchedule = !!whenVal && new Date(whenVal).getTime() > Date.now() + 60000;

  ypConfirm(isSchedule ? ('Schedule this for ' + whenEl.value + '?') : ('Send this to ALL users now?\n\n"' + text + '"'), { danger: true }).then(function (ok) {
    if (!ok) return;

    var payload = {
      text: text,
      segment: (document.getElementById('bc-segment') || {}).value || 'all',
      sender_email: ADMIN_gateEmail || (STATE.user && STATE.user.email) || '',
    };
    if (isSchedule) { payload.scheduled_for = whenVal; payload.push = !!(pushCb && pushCb.checked); }

    api.post('/broadcasts', payload)
      .then(function (res) {
        ta.value = '';
        if (whenEl) whenEl.value = '';
        if (res.scheduled) {
          toast('⏰ Scheduled!');
        } else {
          toast('📢 Broadcast sent to all users!');
          if (pushCb && pushCb.checked) {
            api.post('/push/send', { title: 'YID PLUS', body: text, url: '/chat' })
              .then(function (r) { toast('🔔 Pushed to ' + (r.sent || 0) + ' devices'); })
              .catch(function () { toast('⚠ In-app sent, but push failed'); });
          }
        }
        if (pushCb) pushCb.checked = false;
        loadBroadcastHistory();
      })
      .catch(function (err) { toast('❌ Failed: ' + err.message); });
  });
};

window.sendEmailBlast = function () {
  var subject = (document.getElementById('eb-subject').value || '').trim();
  var message = (document.getElementById('eb-message').value || '').trim();
  if (!subject || !message) return toast('⚠ Add a subject and message.');
  ypConfirm('Send this email to ALL users? This cannot be undone.', { danger: true }).then(function (ok) {
    if (!ok) return;
    toast('✉️ Sending…');
    api.post('/admin/email-blast', { subject: subject, message: message })
      .then(function (res) {
        toast('✉️ Sent to ' + (res.sent || 0) + ' / ' + (res.total || 0) + ' users');
        document.getElementById('eb-subject').value = '';
        document.getElementById('eb-message').value = '';
      })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
};

window.cancelScheduled = function (id) {
  ypConfirm('Cancel this scheduled broadcast?', { danger: true }).then(function (ok) {
    if (!ok) return;
    api.del('/broadcasts?scheduled_id=' + encodeURIComponent(id))
      .then(function () { toast('Cancelled'); loadBroadcastHistory(); })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
};

function loadBroadcastHistory() {
  var el = document.getElementById('bc-history-list');
  if (!el) return;

  api.get('/broadcasts?limit=10')
    .then(function (res) {
      // Upcoming scheduled broadcasts (owner only)
      var schedCard = document.getElementById('bc-scheduled-card');
      var schedList = document.getElementById('bc-scheduled-list');
      var scheduled = res.scheduled || [];
      if (schedCard && schedList) {
        if (scheduled.length) {
          schedCard.style.display = '';
          schedList.innerHTML = scheduled.map(function (s) {
            return '<div style="display:flex;align-items:center;gap:.5rem;background:var(--bg3);border:.5px solid var(--border);border-radius:8px;padding:.6rem .8rem;margin-bottom:.5rem">' +
              '<div style="flex:1;min-width:0"><div style="font-size:.8rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(s.text) + '</div>' +
              '<div style="font-size:.65rem;color:var(--muted)">' + (s.push ? '🔔 ' : '') + '⏰ ' + new Date(s.scheduled_for).toLocaleString() + '</div></div>' +
              '<button onclick="cancelScheduled(\'' + s.id + '\')" style="padding:.3rem .6rem;background:none;border:1px solid #E5989B;border-radius:8px;font-size:.7rem;font-weight:700;color:#D32F2F;cursor:pointer;font-family:inherit">Cancel</button>' +
            '</div>';
          }).join('');
        } else {
          schedCard.style.display = 'none';
        }
      }

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
window.runEmailTest = function () {
  var to = (document.getElementById('email-test-to') || {}).value || '';
  var resEl = document.getElementById('email-test-result');
  if (resEl) resEl.innerHTML = '<span style="color:var(--muted)">Sending… [build v2]</span>';
  api.post('/admin/email-test', { to: to.trim() })
    .then(function (res) {
      if (!resEl) return;
      if (res.delivered) {
        resEl.innerHTML = '<span style="color:#1F6F5C;font-weight:700">✅ Sent successfully to ' + escHtml(res.sent_to) + '</span>\n\n' +
          'From: ' + escHtml(res.config.from_address_used) + '\nResend status: ' + res.resend_status + '\n\nIf it\'s not in the inbox, check the spam folder.';
      } else {
        var lines = '❌ Not delivered.\n\n';
        if (res.config) {
          lines += 'API key set: ' + (res.config.resend_api_key_present ? 'yes' : 'NO') + '\n';
          lines += 'From-email configured: ' + (res.config.resend_from_email_configured ? 'yes' : 'no (using Resend test sender)') + '\n';
          lines += 'From address: ' + escHtml(res.config.from_address_used) + '\n';
        }
        if (res.resend_status) lines += 'Resend status: ' + res.resend_status + '\n';
        if (res.resend_response) lines += 'Resend said: ' + escHtml(JSON.stringify(res.resend_response)) + '\n';
        if (res.network_error) lines += 'Network error: ' + escHtml(res.network_error) + '\n';
        if (res.hint) lines += '\n💡 ' + escHtml(res.hint);
        resEl.innerHTML = '<span style="color:#C62828">' + lines + '</span>';
      }
    })
    .catch(function (err) {
      if (resEl) resEl.innerHTML = '<span style="color:#C62828">❌ ' + escHtml(err.message) + '</span>';
    });
};

window.adminToggleSetting = function (key, isOn) {
  saveSetting(key, isOn ? 'true' : 'false');
};

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
      buildAdminPanel('app-settings'); // re-render the app-settings panel to show the new preview
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

console.log('[YID PLUS] admin.js loaded ✓ (Cloudflare D1 mode)');

/* ── SUPPORT CHATS ── */
var SUPPORT_ACTIVE_TAB = 'new';

function buildSupportChatsPanel(content) {
  var isOwnerHere = ADMIN_gateRole === 'owner' || (typeof isOwner === 'function' && isOwner());
  content.innerHTML =
    '<div class="admin-panel">' +
      '<div style="display:flex;gap:.4rem;padding:.6rem .75rem;background:var(--surface);border-bottom:1px solid var(--border);align-items:center">' +
        '<button class="save-pill" id="sc-tab-new" onclick="loadSupportChatsTab(\'new\')">New</button>' +
        '<button class="save-pill" id="sc-tab-mine" onclick="loadSupportChatsTab(\'mine\')">Mine</button>' +
        '<button class="save-pill" id="sc-tab-all" onclick="loadSupportChatsTab(\'all\')">All</button>' +
        (isOwnerHere ? '<button class="save-pill" style="margin-left:auto;background:#637087" onclick="openManageSupportQuestions()">⚙️ Questions</button>' : '') +
      '</div>' +
      '<div id="sc-list-body" style="padding:.75rem"></div>' +
    '</div>';
  loadSupportChatsTab('new');
}

window.loadSupportChatsTab = function (tab) {
  SUPPORT_ACTIVE_TAB = tab;
  ['new', 'mine', 'all'].forEach(function (t) {
    var btn = document.getElementById('sc-tab-' + t);
    if (btn) { btn.style.background = (t === tab) ? '#1F6F5C' : '#637087'; btn.style.color = '#fff'; }
  });
  var body = document.getElementById('sc-list-body');
  if (!body) return;
  body.innerHTML = '<div class="spinner" style="margin:2rem auto"></div>';

  api.get('/support-chats?tab=' + tab, true)
    .then(function (res) {
      var chats = res.chats || [];
      if (!chats.length) { body.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--muted)">No chats here.</div>'; return; }
      body.innerHTML = chats.map(function (c) {
        var statusBadge = c.status === 'closed'
          ? '<span style="color:var(--muted)">✅ Closed</span>'
          : (c.claimed_by ? '<span style="color:#B08D4F">🟡 Claimed by @' + escHtml(c.claimed_by_nick || '?') + '</span>' : '<span style="color:#1F6F5C;font-weight:700">🆕 New</span>');
        return '<div class="admin-card" style="cursor:pointer;margin-bottom:.5rem" onclick="openSupportChatThread(\'' + c.id + '\')">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem">' +
            '<div style="font-weight:700;font-size:.85rem">' + escHtml(c.question_label) + '</div>' +
            '<div style="font-size:.68rem;color:var(--muted);white-space:nowrap">' + timeAgo(c.updated_at) + '</div>' +
          '</div>' +
          '<div style="font-size:.75rem;color:var(--muted)">' + (c.user_id ? '@' + escHtml(c.user_nick || 'user') : escHtml(c.user_nick || 'Guest')) + (c.user_email ? ' · ' + escHtml(c.user_email) : '') + ' · ' + (c.screen === 'login' ? 'Sign-in screen' : 'Main app') + '</div>' +
          '<div style="font-size:.72rem;margin-top:.3rem">' + statusBadge + '</div>' +
        '</div>';
      }).join('');
    })
    .catch(function (err) { body.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--red)">⚠️ ' + escHtml(err.message) + '</div>'; });
};

window.openSupportChatThread = function (chatId) {
  var existing = document.getElementById('sc-thread-overlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'sc-thread-overlay';
  overlay.className = 'modal-overlay open';
  overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML =
    '<div class="modal-sheet" style="max-height:85vh;overflow-y:auto">' +
      '<div class="modal-title" style="display:flex;justify-content:space-between;align-items:center">' +
        '<span>💬 Support Chat</span>' +
        '<button onclick="document.getElementById(\'sc-thread-overlay\').remove()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--muted)">✕</button>' +
      '</div>' +
      '<div id="sc-thread-body"><div class="spinner" style="margin:2rem auto"></div></div>' +
    '</div>';
  document.body.appendChild(overlay);

  _loadSupportChatThread(chatId);
};

function _loadSupportChatThread(chatId) {
  api.get('/support-chats?chat_id=' + encodeURIComponent(chatId) + '&admin=1', true)
    .then(function (res) {
      var body = document.getElementById('sc-thread-body');
      if (!body) return;
      var chat = res.chat, messages = res.messages || [];

      var userInfo = chat.user_id
        ? '<button class="act-btn" style="background:#1F6F5C;color:#fff;border-color:transparent;width:100%;margin-bottom:.75rem" onclick="openUserDetailModal(\'' + chat.user_id + '\')">🔍 View Full User Info &amp; Set Password</button>'
        : '<div class="admin-card" style="margin:0 0 .75rem"><div style="font-size:.78rem;color:var(--muted)">Not signed in — contact: ' + escHtml(chat.user_email || 'no email given') + (chat.user_nick ? ' (' + escHtml(chat.user_nick) + ')' : '') + '</div></div>';

      var claimRow = chat.status !== 'closed'
        ? '<div style="display:flex;gap:.4rem;margin-bottom:.75rem">' +
            (!chat.claimed_by ? '<button class="act-btn" style="background:#1F6F5C;color:#fff;border-color:transparent" onclick="claimSupportChat(\'' + chatId + '\')">✋ Claim This</button>' : '') +
            '<button class="act-btn" style="background:#637087;color:#fff;border-color:transparent" onclick="closeSupportChat(\'' + chatId + '\')">✅ Close Ticket</button>' +
          '</div>'
        : '<div style="font-size:.75rem;color:var(--muted);margin-bottom:.75rem">This ticket is closed.</div>';

      var msgsHtml = messages.map(function (m) {
        var isAdminMsg = m.sender_type === 'admin';
        return '<div style="display:flex;' + (isAdminMsg ? 'justify-content:flex-end' : 'justify-content:flex-start') + ';margin-bottom:.5rem">' +
          '<div style="max-width:75%;padding:.5rem .75rem;border-radius:14px;background:' + (isAdminMsg ? '#1F6F5C' : 'var(--bg3)') + ';color:' + (isAdminMsg ? '#fff' : 'var(--text)') + ';font-size:.82rem">' +
            (isAdminMsg ? '<div style="font-size:.65rem;opacity:.8;margin-bottom:.15rem">@' + escHtml(m.sender_nick || 'admin') + '</div>' : '') +
            (m.text ? escHtml(m.text) : '') +
            (m.media_url ? '<img src="' + escHtml(m.media_url) + '" onclick="window.open(this.src,\'_blank\')" style="max-width:200px;border-radius:8px;display:block;margin-top:' + (m.text ? '.3rem' : '0') + ';cursor:pointer">' : '') +
            '<div style="font-size:.62rem;opacity:.7;margin-top:.2rem">' + timeAgo(m.created_at) + '</div>' +
          '</div>' +
        '</div>';
      }).join('');

      body.innerHTML = userInfo + claimRow +
        '<div style="border:1px solid var(--border);border-radius:12px;padding:.6rem;margin-bottom:.75rem;max-height:280px;overflow-y:auto">' + (msgsHtml || '<div style="color:var(--muted);font-size:.78rem">No messages yet.</div>') + '</div>' +
        (chat.status !== 'closed'
          ? '<textarea class="bc-textarea" id="sc-reply-text" rows="2" placeholder="Reply..."></textarea>' +
            '<button class="btn-primary" onclick="sendSupportChatReply(\'' + chatId + '\')">Send Reply</button>'
          : '');
    })
    .catch(function (err) {
      var body = document.getElementById('sc-thread-body');
      if (body) body.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--red);font-size:.8rem">⚠️ ' + escHtml(err.message) + '</div>';
    });
}

window.claimSupportChat = function (chatId) {
  api.post('/support-chats', { chat_id: chatId, claim: true })
    .then(function () { toast('✋ Claimed!'); _loadSupportChatThread(chatId); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.closeSupportChat = function (chatId) {
  api.post('/support-chats', { chat_id: chatId, close: true })
    .then(function () { toast('✅ Ticket closed.'); _loadSupportChatThread(chatId); loadSupportChatsTab(SUPPORT_ACTIVE_TAB); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.sendSupportChatReply = function (chatId) {
  var inp = document.getElementById('sc-reply-text');
  var text = (inp && inp.value || '').trim();
  if (!text) return toast('⚠️ Write a reply first.');
  api.post('/support-chats', { chat_id: chatId, text: text, admin: true })
    .then(function () { _loadSupportChatThread(chatId); loadSupportChatsTab(SUPPORT_ACTIVE_TAB); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.openManageSupportQuestions = function () {
  var existing = document.getElementById('sc-questions-overlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'sc-questions-overlay';
  overlay.className = 'modal-overlay open';
  overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML =
    '<div class="modal-sheet" style="max-height:85vh;overflow-y:auto">' +
      '<div class="modal-title" style="display:flex;justify-content:space-between;align-items:center">' +
        '<span>⚙️ Support Questions</span>' +
        '<button onclick="document.getElementById(\'sc-questions-overlay\').remove()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--muted)">✕</button>' +
      '</div>' +
      '<div style="display:flex;gap:.4rem;margin-bottom:.75rem">' +
        '<button class="save-pill" id="scq-tab-login" onclick="loadSupportQuestionsAdmin(\'login\')">Sign-In Screen</button>' +
        '<button class="save-pill" id="scq-tab-home" onclick="loadSupportQuestionsAdmin(\'home\')">Main App</button>' +
      '</div>' +
      '<div id="scq-list"></div>' +
      '<div style="border-top:1px solid var(--border);margin-top:.75rem;padding-top:.75rem">' +
        '<input class="field" id="scq-new-label" placeholder="Question text (in English)">' +
        '<select class="field" id="scq-new-action">' +
          '<option value="admin_message">Sends a message to admins</option>' +
          '<option value="auto_resend">Auto-resend verification email</option>' +
          '<option value="self_block">Let user block themselves from a feature</option>' +
          '<option value="free_text">Free text (something else)</option>' +
        '</select>' +
        '<button class="btn-primary" onclick="addSupportQuestion()">Add Question</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  loadSupportQuestionsAdmin('login');
};

var SCQ_ACTIVE_SCREEN = 'login';
window.loadSupportQuestionsAdmin = function (screen) {
  SCQ_ACTIVE_SCREEN = screen;
  ['login', 'home'].forEach(function (s) {
    var btn = document.getElementById('scq-tab-' + s);
    if (btn) { btn.style.background = (s === screen) ? '#1F6F5C' : '#637087'; btn.style.color = '#fff'; }
  });
  var list = document.getElementById('scq-list');
  if (!list) return;
  list.innerHTML = '<div class="spinner" style="margin:1rem auto"></div>';
  api.get('/support-questions?screen=' + screen, true).then(function (res) {
    var qs = res.questions || [];
    list.innerHTML = qs.length ? qs.map(function (q) {
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:.5rem;border-bottom:1px solid var(--border);font-size:.8rem">' +
        '<span>' + escHtml(q.label) + ' <span style="color:var(--muted);font-size:.68rem">(' + q.action_type + ')</span></span>' +
        '<button class="act-btn" style="background:#E11D48;color:#fff;border-color:transparent" onclick="deleteSupportQuestion(\'' + q.id + '\')">Delete</button>' +
      '</div>';
    }).join('') : '<div style="color:var(--muted);font-size:.8rem;padding:.5rem">No questions yet.</div>';
  });
};

window.addSupportQuestion = function () {
  var label = (document.getElementById('scq-new-label').value || '').trim();
  var actionType = document.getElementById('scq-new-action').value;
  if (!label) return toast('⚠️ Enter the question text.');
  api.post('/support-questions', { screen: SCQ_ACTIVE_SCREEN, label: label, action_type: actionType })
    .then(function () {
      document.getElementById('scq-new-label').value = '';
      toast('✅ Question added!');
      loadSupportQuestionsAdmin(SCQ_ACTIVE_SCREEN);
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.deleteSupportQuestion = function (id) {
  api.del('/support-questions?id=' + encodeURIComponent(id))
    .then(function () { loadSupportQuestionsAdmin(SCQ_ACTIVE_SCREEN); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

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
  ypPrompt('Show every how many minutes?', { title: 'Ad interval', value: '60', okText: 'Next' }).then(function (mins) {
    if (!mins) return;
    ypPrompt('Countdown seconds before Skip?', { title: 'Skip countdown', value: '5', okText: 'Save' }).then(function (secs) {
      if (!secs) return;
      api.put('/admin/ads', { id: id, interval_minutes: parseInt(mins), countdown_seconds: parseInt(secs) })
        .then(function () { toast('✅ Updated!'); loadAdsList(); })
        .catch(function (err) { toast('❌ ' + err.message); });
    });
  });
};

window.adminEditAdPages = function (id) {
  ypPrompt('Pages (all / home / chat / shorts / music or comma-separated):', { title: 'Ad pages', value: 'all', okText: 'Save' }).then(function (p) {
    if (!p) return;
    api.put('/admin/ads', { id: id, pages: p.trim() })
      .then(function () { toast('✅ Updated!'); loadAdsList(); })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
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
  ypConfirm('Delete this ad?', { danger: true }).then(function (ok) {
    if (!ok) return;
    api.del('/admin/ads?id=' + encodeURIComponent(id))
      .then(function () { toast('🗑 Deleted.'); loadAdsList(); })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
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
  ypConfirm('Ban @' + nick + '? This will also block their device.', { danger: true }).then(function (ok) {
    if (!ok) return;
    api.put('/admin/users', { id: userId, blocked: true })
      .then(function () { toast('🚫 @' + nick + ' banned!'); buildReportsPanel(document.getElementById('admin-content')); })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
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
  ypConfirm('Remove this ban?', { danger: true }).then(function (ok) {
    if (!ok) return;
    api.del('/admin/device-bans?id=' + encodeURIComponent(id))
      .then(function () { toast('✓ Ban removed'); loadBansList(); })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
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
  ypConfirm('Ban IP: ' + ip + '?', { danger: true }).then(function (ok) {
    if (!ok) return;
    api.post('/admin/device-bans', { ip: ip, reason: 'Banned from IP Logs' })
      .then(function () { toast('🚫 IP banned!'); })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
};

/* ══════════════════════════════════
   SECURITY / ATTACKS PANEL
   Every attack the middleware blocks (SQL injection, XSS, path traversal,
   scanners, brute-force logins) is recorded with the attacker's IP, country,
   city, network, browser and exactly what they tried. Owner-only.
══════════════════════════════════ */

// 2-letter ISO country code -> flag emoji (each letter maps to a regional
// indicator symbol). Returns '' for missing/invalid codes.
function _flagEmoji(cc) {
  if (!cc || cc.length !== 2 || !/^[A-Za-z]{2}$/.test(cc)) return '';
  var base = 0x1F1E6;
  var a = cc.toUpperCase().charCodeAt(0) - 65;
  var b = cc.toUpperCase().charCodeAt(1) - 65;
  if (a < 0 || a > 25 || b < 0 || b > 25) return '';
  return String.fromCodePoint(base + a) + String.fromCodePoint(base + b);
}

function _attackColor(type) {
  var t = (type || '').toLowerCase();
  if (t.indexOf('sql') >= 0)        return '#C0392B';
  if (t.indexOf('xss') >= 0)        return '#8E44AD';
  if (t.indexOf('traversal') >= 0)  return '#D35400';
  if (t.indexOf('brute') >= 0)      return '#B7410E';
  if (t.indexOf('pin') >= 0)        return '#7D3C98';
  if (t.indexOf('code') >= 0)       return '#922B21';
  if (t.indexOf('template') >= 0)   return '#6C3483';
  if (t.indexOf('system') >= 0)     return '#A04000';
  return '#5D6D7E'; // scanner / probe / other
}

function buildSecurityPanel(content) {
  // Inject the new-attack flash animation once.
  if (!document.getElementById('sec-flash-style')) {
    var st = document.createElement('style');
    st.id = 'sec-flash-style';
    st.textContent = '@keyframes secflash{0%{background:rgba(192,57,43,.35)}100%{background:transparent}}' +
      '.sec-new{animation:secflash 2.6s ease}' +
      '@keyframes secpulse{0%,100%{opacity:1}50%{opacity:.35}}' +
      '.sec-live-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#e53935;animation:secpulse 1.4s ease-in-out infinite;margin-inline-end:.35rem;vertical-align:middle}';
    document.head.appendChild(st);
  }

  // Fresh monitoring state each time the panel opens.
  window._secSeenIds = null;      // Set of attack ids already shown (null = first load)
  window._secNewCount = 0;        // new attacks since the panel opened
  window._secPaused = false;

  content.innerHTML =
    '<div class="admin-panel">' +
      '<div class="admin-card">' +
        '<div class="admin-card-title" style="display:flex;justify-content:space-between;align-items:center">' +
          '<span>&#128737;&#65039; Security &mdash; Intrusion Log</span>' +
          '<button class="save-pill" style="font-size:.62rem;background:var(--red)" onclick="adminClearSecurityLog()">Clear log</button>' +
        '</div>' +
        // Live monitor bar
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;background:var(--card2,rgba(0,0,0,.06));border-radius:10px;padding:.5rem .6rem;margin:.3rem 0 .6rem">' +
          '<div style="min-width:0">' +
            '<div id="sec-live-status" style="font-size:.72rem;font-weight:700"><span class="sec-live-dot"></span>Watching live&hellip;</div>' +
            '<div id="sec-live-sub" style="font-size:.6rem;color:var(--muted);margin-top:.1rem">Checking every few seconds. New attacks appear at the top and flash.</div>' +
          '</div>' +
          '<button id="sec-pause-btn" class="save-pill" style="font-size:.6rem;flex-shrink:0" onclick="secToggleLive()">&#9208;&#65039; Pause</button>' +
        '</div>' +
        '<div id="security-stats" style="display:flex;gap:.5rem;margin:.2rem 0 .5rem"></div>' +
        // Phone alert toggle
        '<div id="sec-alerts-row" style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex-wrap:wrap;background:var(--card2,rgba(0,0,0,.06));border-radius:10px;padding:.5rem .6rem;margin-bottom:.6rem"></div>' +
        '<div style="font-size:.68rem;color:var(--muted);margin-bottom:.2rem;line-height:1.45">' +
          'Every request below was <strong>automatically blocked</strong> before it could do anything. ' +
          'For each one you can see where it came from, everything the attacker\'s own request revealed, ' +
          'and block them &mdash; by their address, their whole country, or their whole network &mdash; so ' +
          'they can\'t reach any part of the site again. Repeat attackers are banned automatically.' +
        '</div>' +
      '</div>' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">&#128260; Repeat offenders</div>' +
        '<div id="security-offenders"><div class="feed-state"><div class="spinner"></div></div></div>' +
      '</div>' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">&#128220; Every attempt</div>' +
        '<div id="security-list"><div class="feed-state"><div class="spinner"></div></div></div>' +
      '</div>' +
    '</div>';

  _secRefresh();

  // Poll while the panel is open. buildAdminPanel() clears this the moment you
  // switch to any other panel, so it never runs in the background.
  if (window._secLiveTimer) clearInterval(window._secLiveTimer);
  window._secLiveTimer = setInterval(function () {
    if (window._secPaused) return;
    // Stop cleanly if the panel is no longer on screen.
    if (!document.getElementById('security-list')) {
      clearInterval(window._secLiveTimer); window._secLiveTimer = null; return;
    }
    _secRefresh();
  }, 8000);
}

// Fetch latest and render. Detects attacks not seen before and flashes them,
// updating the live status line with when we last checked and how many new
// attacks have come in since the panel was opened.
function _secRefresh() {
  return api.get('/admin/security-log?limit=150')
    .then(function (res) {
      var logs = res.logs || [];
      var stats = res.stats || {};
      var offenders = res.offenders || [];
      var banned = res.banned || [];

      // Work out which ids are new since last check.
      var newIds = {};
      if (window._secSeenIds === null) {
        // First load — everything is "already seen", nothing flashes.
        window._secSeenIds = {};
        logs.forEach(function (l) { window._secSeenIds[l.id] = 1; });
      } else {
        var freshest = null;
        logs.forEach(function (l) {
          if (!window._secSeenIds[l.id]) {
            newIds[l.id] = 1;
            window._secSeenIds[l.id] = 1;
            window._secNewCount++;
            if (!freshest) freshest = l;
          }
        });
        if (freshest) {
          var where = [_flagEmoji(freshest.country), freshest.ip].filter(Boolean).join(' ');
          toast('\u26A0 New attack: ' + (freshest.attack_type || 'blocked') + ' \u2014 ' + (where || 'unknown'));
        }
      }

      _secRenderStats(stats);
      _secRenderAlerts(res.alerts !== false);
      _secRenderOffenders(offenders, banned);
      _secRenderFeed(logs, banned, newIds);
      _secUpdateLiveStatus();
    })
    .catch(function (err) {
      var el = document.getElementById('security-list');
      if (el && el.querySelector('.spinner')) {
        el.innerHTML = '<div style="padding:1rem;color:var(--red);font-size:.8rem">' + escHtml(err.message) + '</div>';
      }
    });
}

function _secUpdateLiveStatus() {
  var s = document.getElementById('sec-live-status');
  var sub = document.getElementById('sec-live-sub');
  if (!s) return;
  if (window._secPaused) {
    s.innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--muted);margin-inline-end:.35rem;vertical-align:middle"></span>Paused';
  } else {
    s.innerHTML = '<span class="sec-live-dot"></span>Watching live' +
      (window._secNewCount ? ' &middot; <span style="color:#e53935">' + window._secNewCount + ' new</span>' : '');
  }
  if (sub) {
    var t = new Date();
    var hh = ('0' + t.getHours()).slice(-2), mm = ('0' + t.getMinutes()).slice(-2), ss = ('0' + t.getSeconds()).slice(-2);
    sub.textContent = 'Last checked ' + hh + ':' + mm + ':' + ss + (window._secPaused ? ' (paused)' : '');
  }
}

window.secToggleLive = function () {
  window._secPaused = !window._secPaused;
  var b = document.getElementById('sec-pause-btn');
  if (b) b.innerHTML = window._secPaused ? '\u25B6\uFE0F Resume' : '\u23F8\uFE0F Pause';
  if (!window._secPaused) _secRefresh();
  _secUpdateLiveStatus();
};

// Phone-alert toggle: when on, the owner's phone gets a push the moment a NEW
// source starts attacking (throttled server-side to one per 10 min).
function _secRenderAlerts(on) {
  var el = document.getElementById('sec-alerts-row');
  if (!el) return;
  window._secAlertsOn = on;
  el.innerHTML =
    '<div style="min-width:0">' +
      '<div style="font-size:.72rem;font-weight:700">' + (on ? '\uD83D\uDD14' : '\uD83D\uDD15') + ' Phone alerts: ' +
        '<span style="color:' + (on ? '#0F6E56' : 'var(--muted)') + '">' + (on ? 'ON' : 'OFF') + '</span></div>' +
      '<div style="font-size:.6rem;color:var(--muted);margin-top:.1rem">Sends a notification to the phone where you\u2019ve turned on YID PLUS notifications, when someone new starts attacking.</div>' +
    '</div>' +
    '<div style="display:flex;gap:.3rem;flex-shrink:0">' +
      (on ? '<button class="save-pill" style="font-size:.6rem;background:var(--muted)" onclick="secTestAlert(this)">\uD83D\uDCF2 Send test</button>' : '') +
      '<button class="save-pill" style="font-size:.6rem" onclick="secToggleAlerts(' + (on ? 'false' : 'true') + ')">' + (on ? 'Turn off' : 'Turn on') + '</button>' +
    '</div>';
}

window.secToggleAlerts = function (turnOn) {
  api.post('/admin/security-log', { alerts: !!turnOn })
    .then(function () {
      toast(turnOn ? '\uD83D\uDD14 Phone alerts on' : '\uD83D\uDD15 Phone alerts off');
      _secRenderAlerts(!!turnOn);
    })
    .catch(function (err) { toast('\u274C ' + err.message); });
};

window.secTestAlert = function (btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Sending\u2026'; }
  api.post('/admin/security-log', { test: true })
    .then(function () {
      toast('\uD83D\uDCF2 Test sent \u2014 check your phone. If nothing arrives, enable notifications in Settings.');
    })
    .catch(function (err) { toast('\u274C ' + err.message); })
    .then(function () { if (btn) { btn.disabled = false; btn.innerHTML = '\uD83D\uDCF2 Send test'; } });
};


// Is a source already banned? Checks its exact IP, its whole country, and its
// whole network against the ban list returned by the server.
function _secIsBanned(ip, country, asnNum, banned) {
  if (!banned || !banned.length) return false;
  if (ip && banned.indexOf(ip) >= 0) return true;
  if (country && banned.indexOf('country:' + country.toUpperCase()) >= 0) return true;
  if (asnNum && banned.indexOf('asn:' + asnNum) >= 0) return true;
  return false;
}

function _secRenderStats(stats) {
  var statsEl = document.getElementById('security-stats');
  if (!statsEl) return;
  var card = function (n, label, color) {
    return '<div style="flex:1;background:var(--card2,rgba(0,0,0,.06));border-radius:10px;padding:.5rem .3rem;text-align:center">' +
      '<div style="font-size:1.15rem;font-weight:800;color:' + color + '">' + (n || 0) + '</div>' +
      '<div style="font-size:.6rem;color:var(--muted);text-transform:uppercase;letter-spacing:.03em">' + label + '</div>' +
    '</div>';
  };
  statsEl.innerHTML =
    card(stats.total, 'Total blocked', 'var(--text)') +
    card(stats.last24, 'Last 24h', 'var(--gold)') +
    card(stats.unique_ips, 'Unique IPs', 'var(--red)');
}

function _secRenderOffenders(offenders, banned) {
  var el = document.getElementById('security-offenders');
  if (!el) return;
  if (!offenders.length) {
    el.innerHTML = '<div style="font-size:.75rem;color:var(--muted);padding:.4rem 0">No repeat sources yet.</div>';
    return;
  }
  el.innerHTML = offenders.map(function (o) {
    var flag = _flagEmoji(o.country);
    var loc = [o.city, o.country].filter(Boolean).join(', ');
    var net = o.asn ? escHtml(o.asn) : '';
    var isBanned = _secIsBanned(o.ip, o.country, null, banned);
    var safeIp = (o.ip || '').replace(/'/g, '');
    var safeCc = (o.country || '').replace(/'/g, '');

    var right = isBanned
      ? '<span style="font-size:.62rem;font-weight:700;color:var(--red);white-space:nowrap">&#9989; Banned</span>'
      : '<button class="save-pill" style="font-size:.6rem;flex-shrink:0" onclick="secBanIp(\'' + safeIp + '\')">&#128683; Ban IP</button>';

    return '<div style="padding:.55rem 0;border-bottom:.5px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:.5rem">' +
      '<div style="min-width:0;flex:1">' +
        '<div style="font-size:.8rem;font-weight:700;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          (flag ? flag + ' ' : '') + escHtml(o.ip || '&mdash;') +
          ' <span style="color:var(--red);font-weight:800">&times;' + (o.hits || 0) + '</span></div>' +
        (loc ? '<div style="font-size:.64rem;color:var(--muted)">&#128205; ' + escHtml(loc) + (net ? ' &middot; ' + net : '') + '</div>' : (net ? '<div style="font-size:.64rem;color:var(--muted)">' + net + '</div>' : '')) +
        '<div style="font-size:.6rem;color:var(--muted);margin-top:.1rem">first ' + timeAgo(o.first_seen) + ' &middot; last ' + timeAgo(o.last_seen) + '</div>' +
        (safeCc ? '<div style="margin-top:.3rem;display:flex;gap:.3rem;flex-wrap:wrap">' +
            (isBanned ? '' : '<button class="save-pill" style="font-size:.58rem;background:var(--muted)" onclick="secBanCountry(\'' + safeCc + '\')">&#127760; Ban ' + escHtml(safeCc) + '</button>') +
            '<a href="https://www.abuseipdb.com/check/' + encodeURIComponent(o.ip || '') + '" target="_blank" rel="noopener" class="save-pill" style="font-size:.58rem;background:var(--muted);text-decoration:none;display:inline-block">&#128269; Report</a>' +
          '</div>' : '') +
      '</div>' +
      '<div style="flex-shrink:0">' + right + '</div>' +
    '</div>';
  }).join('');
}

// If the attacker was signed in, show which account it was, with a button to
// open their full profile in the admin. Anonymous attackers show nothing here.
function _secAccountBlock(meta) {
  var a = meta && meta.account;
  if (!a || !a.id) return '';
  var name = escHtml(a.nickname || '(no name)');
  var email = a.email ? escHtml(a.email) : '';
  var role = a.role ? escHtml(a.role) : '';
  var safeId = String(a.id).replace(/'/g, '');
  return '<div style="margin-top:.35rem;padding:.4rem .5rem;background:rgba(192,57,43,.1);border:1px solid rgba(192,57,43,.35);border-radius:8px">' +
    '<div style="font-size:.66rem;font-weight:700">&#128100; Signed in as: ' + name +
      (role ? ' <span style="font-size:.56rem;color:var(--muted)">(' + role + ')</span>' : '') + '</div>' +
    (email ? '<div style="font-size:.62rem;color:var(--muted);word-break:break-all">&#9993;&#65039; ' + email + '</div>' : '') +
    '<button class="save-pill" style="font-size:.58rem;margin-top:.3rem" onclick="secViewAccount(\'' + safeId + '\')">&#128269; View account</button>' +
  '</div>';
}

window.secViewAccount = function (userId) {
  if (typeof openUserDetailModal === 'function') { openUserDetailModal(userId); }
  else { toast('User: ' + userId); }
};

function _secRenderFeed(logs, banned, newIds) {
  newIds = newIds || {};
  var el = document.getElementById('security-list');
  if (!el) return;
  if (!logs.length) {
    el.innerHTML = '<div style="padding:1.2rem;text-align:center;font-size:.8rem;color:var(--muted)">' +
      '&#9989; No attacks recorded. The site is quiet.</div>';
    return;
  }

  el.innerHTML = logs.map(function (l, idx) {
    var color = _attackColor(l.attack_type);
    var flag = _flagEmoji(l.country);
    var loc = [l.city, l.region, l.country].filter(Boolean).join(', ');
    var net = l.asn ? (' &middot; ' + escHtml(l.asn)) : '';
    var safeIp = (l.ip || '').replace(/'/g, '');
    var meta = {};
    try { meta = JSON.parse(l.meta || '{}'); } catch (e) { meta = {}; }
    var asnNum = meta.asnNum || '';
    var isBanned = _secIsBanned(l.ip, l.country, asnNum, banned);

    var actionBtn = isBanned
      ? '<span style="font-size:.62rem;font-weight:700;color:var(--red);flex-shrink:0">&#9989; Banned</span>'
      : '<button class="save-pill" style="font-size:.62rem;flex-shrink:0" onclick="secBanIp(\'' + safeIp + '\')">&#128683; Ban</button>';

    var isNew = !!newIds[l.id];
    return '<div class="' + (isNew ? 'sec-new' : '') + '" style="padding:.6rem 0;border-bottom:.5px solid var(--border)">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem">' +
        '<div style="min-width:0;flex:1">' +
          '<span style="display:inline-block;font-size:.62rem;font-weight:700;color:#fff;background:' + color + ';padding:.12rem .4rem;border-radius:5px;margin-bottom:.25rem">' +
            escHtml(l.attack_type || 'Blocked') + '</span>' +
          '<div style="font-size:.78rem;font-weight:700;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
            (flag ? flag + ' ' : '') + escHtml(l.ip || '&mdash;') + '</div>' +
          (loc ? '<div style="font-size:.66rem;color:var(--muted)">&#128205; ' + escHtml(loc) + net + '</div>' : (net ? '<div style="font-size:.66rem;color:var(--muted)">' + net.replace(/^ &middot; /, '') + '</div>' : '')) +
          '<div style="font-size:.66rem;color:var(--muted);font-family:monospace;margin-top:.15rem;word-break:break-all">' +
            escHtml(l.method || '') + ' ' + escHtml(l.path || '') + '</div>' +
          (l.user_agent ? '<div style="font-size:.6rem;color:var(--muted);margin-top:.15rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">&#128421;&#65039; ' + escHtml(l.user_agent) + '</div>' : '') +
          '<div style="font-size:.62rem;color:var(--muted);margin-top:.15rem">&#128336; ' + timeAgo(l.created_at) + '</div>' +
          _secAccountBlock(meta) +
          '<div id="secd-' + idx + '" style="display:none;margin-top:.5rem;padding:.5rem;background:var(--card2,rgba(0,0,0,.05));border-radius:8px">' +
            _secDetailHtml(l, meta) + '</div>' +
          '<div style="margin-top:.35rem;display:flex;gap:.3rem;flex-wrap:wrap">' +
            '<button class="save-pill" style="font-size:.58rem;background:var(--muted)" onclick="secToggleDetail(' + idx + ')">&#8942; Full details</button>' +
            (isBanned ? '' :
              (l.country ? '<button class="save-pill" style="font-size:.58rem;background:var(--muted)" onclick="secBanCountry(\'' + (l.country || '').replace(/'/g, '') + '\')">&#127760; Ban country</button>' : '') +
              (asnNum ? '<button class="save-pill" style="font-size:.58rem;background:var(--muted)" onclick="secBanNetwork(\'' + asnNum.replace(/'/g, '') + '\')">&#128225; Ban network</button>' : '')
            ) +
            '<a href="https://www.abuseipdb.com/check/' + encodeURIComponent(l.ip || '') + '" target="_blank" rel="noopener" class="save-pill" style="font-size:.58rem;background:var(--muted);text-decoration:none;display:inline-block">&#128269; Report</a>' +
          '</div>' +
        '</div>' +
        actionBtn +
      '</div>' +
    '</div>';
  }).join('');
}

// The full intelligence a single request revealed. Everything here is data the
// attacker's own connection handed our server.
function _secDetailHtml(l, meta) {
  var rows = [];
  var add = function (icon, label, val) {
    if (val === undefined || val === null || val === '' ) return;
    rows.push('<div style="display:flex;gap:.4rem;font-size:.63rem;padding:.12rem 0">' +
      '<span style="color:var(--muted);min-width:96px;flex-shrink:0">' + icon + ' ' + label + '</span>' +
      '<span style="word-break:break-all">' + escHtml(String(val)) + '</span></div>');
  };

  // Approximate location on a map (Cloudflare's coarse coordinates).
  if (meta.latitude && meta.longitude) {
    var q = encodeURIComponent(meta.latitude + ',' + meta.longitude);
    rows.push('<div style="display:flex;gap:.4rem;font-size:.63rem;padding:.12rem 0">' +
      '<span style="color:var(--muted);min-width:96px;flex-shrink:0">&#128506;&#65039; Map</span>' +
      '<a href="https://www.google.com/maps?q=' + q + '" target="_blank" rel="noopener" style="color:var(--gold)">' +
      escHtml(meta.latitude + ', ' + meta.longitude) + ' &#8599;</a></div>');
  }
  add('&#127759;', 'Continent', meta.continent);
  add('&#9993;&#65039;', 'Postal', meta.postalCode);
  add('&#128336;', 'Timezone', meta.timezone);
  add('&#128225;', 'Network', l.asn);
  if (meta.asnNum) add('&#35;', 'ASN', meta.asnNum);
  add('&#127760;', 'Language', meta.acceptLanguage);
  add('&#128241;', 'Platform', meta.platform + (meta.mobile ? ' (mobile)' : ''));
  add('&#127970;', 'CF datacenter', meta.colo);
  add('&#128274;', 'TLS', [meta.tlsVersion, meta.tlsCipher].filter(Boolean).join(' / '));
  add('&#128246;', 'Protocol', meta.httpProtocol);
  if (meta.botScore !== '' && meta.botScore !== undefined) add('&#129302;', 'Bot score', meta.botScore + (meta.verifiedBot ? ' (verified bot)' : ''));
  if (meta.threatScore !== '' && meta.threatScore !== undefined) add('&#9888;&#65039;', 'Threat score', meta.threatScore);
  add('&#8617;&#65039;', 'Referer', l.referer);
  add('&#127760;', 'Origin', meta.origin);
  add('&#128421;&#65039;', 'User-Agent', l.user_agent);
  add('&#128279;', 'X-Forwarded', meta.xff);

  if (!rows.length) return '<div style="font-size:.63rem;color:var(--muted)">No extra details captured.</div>';
  return rows.join('');
}

window.secToggleDetail = function (idx) {
  var d = document.getElementById('secd-' + idx);
  if (d) d.style.display = (d.style.display === 'none' ? 'block' : 'none');
};

// One helper backs all three ban buttons. `value` is either a raw IP, a
// 'country:XX' sentinel, or an 'asn:AS123' sentinel — the middleware's ban
// check understands all three, so a single device_bans row can wall off an
// address, a country, or a whole network.
function _secBan(value, human, reason) {
  ypConfirm('Block ' + human + '? They will be turned away from the entire site.', { danger: true }).then(function (ok) {
    if (!ok) return;
    api.post('/admin/device-bans', { ip: value, reason: reason })
      .then(function () {
        toast('🚫 Blocked ' + human);
        var c = document.getElementById('admin-content');
        if (c) buildSecurityPanel(c);
      })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
}

window.secBanIp = function (ip) {
  if (!ip || ip === '0.0.0.0' || ip === 'unknown') { toast('No valid IP'); return; }
  _secBan(ip, 'IP ' + ip, 'Blocked from Attacks panel');
};
window.secBanCountry = function (cc) {
  if (!cc) { toast('No country'); return; }
  _secBan('country:' + cc.toUpperCase(), 'everyone from ' + cc.toUpperCase(), 'Country block from Attacks panel');
};
window.secBanNetwork = function (asnNum) {
  if (!asnNum) { toast('No network'); return; }
  _secBan('asn:' + asnNum, 'network ' + asnNum, 'Network block from Attacks panel');
};

window.adminClearSecurityLog = function () {
  ypConfirm('Clear the entire security log? This cannot be undone.', { danger: true }).then(function (ok) {
    if (!ok) return;
    api.del('/admin/security-log')
      .then(function () { toast('🧹 Security log cleared'); var c = document.getElementById('admin-content'); if (c) buildSecurityPanel(c); })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
};

/* ══════════════════════════════════
   HEALTH CHECK / DIAGNOSTICS PANEL
   A whole-site self-check: server-side config/storage/database/data checks
   (from /api/admin/diagnostics) plus live in-browser probes of every major
   endpoint, so the owner can see at a glance what's broken, half-broken,
   misconfigured or missing. Owner-only.
══════════════════════════════════ */

function _diagColor(status) {
  if (status === 'ok')   return '#0F6E56';
  if (status === 'warn') return '#B7791F';
  if (status === 'fail') return '#C0392B';
  return '#7A7A7A'; // skip / unknown
}
function _diagLabel(status) {
  if (status === 'ok')   return 'OK';
  if (status === 'warn') return 'Check';
  if (status === 'fail') return 'Problem';
  return 'Skipped';
}
function _diagRow(status, label, detail, fix) {
  var c = _diagColor(status);
  return '<div style="display:flex;gap:.55rem;padding:.5rem 0;border-bottom:.5px solid var(--border)">' +
    '<div style="width:9px;height:9px;border-radius:50%;background:' + c + ';flex-shrink:0;margin-top:.28rem"></div>' +
    '<div style="min-width:0;flex:1">' +
      '<div style="font-size:.78rem;font-weight:700">' + escHtml(label) +
        ' <span style="font-size:.58rem;font-weight:700;color:' + c + ';text-transform:uppercase;letter-spacing:.04em">&middot; ' + _diagLabel(status) + '</span></div>' +
      (detail ? '<div style="font-size:.66rem;color:var(--muted);margin-top:.1rem;line-height:1.4">' + escHtml(detail) + '</div>' : '') +
      (fix ? '<div style="font-size:.64rem;color:var(--gold);margin-top:.15rem;line-height:1.4">&#128295; ' + escHtml(fix) + '</div>' : '') +
    '</div>' +
  '</div>';
}

function buildDiagnosticsPanel(content) {
  content.innerHTML =
    '<div class="admin-panel">' +
      '<div class="admin-card">' +
        '<div class="admin-card-title" style="display:flex;justify-content:space-between;align-items:center">' +
          '<span>&#129658; Health Check</span>' +
          '<button class="save-pill" style="font-size:.62rem" onclick="var c=document.getElementById(\'admin-content\');if(c)buildDiagnosticsPanel(c)">&#8635; Re-run</button>' +
        '</div>' +
        '<div style="font-size:.68rem;color:var(--muted);line-height:1.45;margin-bottom:.5rem">' +
          'A full sweep of the site: configuration, storage, the database, your data, and a live test of every major feature. ' +
          'Anything <strong>red</strong> is broken, <strong>amber</strong> needs a look, <strong>green</strong> is fine.' +
        '</div>' +
        '<div id="diag-summary" style="display:flex;gap:.5rem;margin-bottom:.3rem"></div>' +
      '</div>' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">&#128225; Live feature test</div>' +
        '<div style="font-size:.64rem;color:var(--muted);margin-bottom:.4rem">Each of these calls a real part of the site right now and checks it responds.</div>' +
        '<div id="diag-client"><div class="feed-state"><div class="spinner"></div></div></div>' +
      '</div>' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">&#128295; Configuration &amp; data</div>' +
        '<div id="diag-server"><div class="feed-state"><div class="spinner"></div></div></div>' +
      '</div>' +
    '</div>';

  _diagRunServer();
  _diagRunClient();
}

// Server-side battery.
function _diagRunServer() {
  api.get('/admin/diagnostics')
    .then(function (res) {
      var checks = res.checks || [];
      var summary = res.summary || {};
      window._diagServerSummary = summary;
      _diagRenderSummary();

      // Group by category, preserving first-seen order.
      var order = [], groups = {};
      checks.forEach(function (c) {
        if (!groups[c.category]) { groups[c.category] = []; order.push(c.category); }
        groups[c.category].push(c);
      });

      var html = order.map(function (cat) {
        var rows = groups[cat].map(function (c) { return _diagRow(c.status, c.label, c.detail, c.fix); }).join('');
        return '<div style="margin-bottom:.6rem">' +
          '<div style="font-size:.64rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:.3rem 0 .1rem">' + escHtml(cat) + '</div>' +
          rows + '</div>';
      }).join('');

      var el = document.getElementById('diag-server');
      if (el) el.innerHTML = html || '<div style="font-size:.75rem;color:var(--muted)">No checks returned.</div>';
    })
    .catch(function (err) {
      var el = document.getElementById('diag-server');
      if (el) el.innerHTML = '<div style="padding:.6rem;color:var(--red);font-size:.78rem">Could not run server checks: ' + escHtml(err.message) + '</div>';
    });
}

// Live in-browser probes: hit each major endpoint and the device's own push
// readiness, so a feature that's throwing errors right now shows up even if
// the config looks fine.
function _diagRunClient() {
  var probes = [
    { label: 'Feed / posts',      url: '/api/posts' },
    { label: 'Chat rooms',        url: '/api/chat/rooms' },
    { label: 'Shorts',            url: '/api/shorts' },
    { label: 'Music',             url: '/api/music' },
    { label: 'Status updates',    url: '/api/statuses' },
    { label: 'Channels',          url: '/api/channels' },
    { label: 'Your session',      url: '/api/auth/me' },
    { label: 'Admin stats',       url: '/api/admin/stats' },
  ];

  var results = new Array(probes.length);
  var done = 0;

  var render = function () {
    var el = document.getElementById('diag-client');
    if (!el) return;
    var rows = results.map(function (r) {
      if (!r) return '';
      return _diagRow(r.status, r.label, r.detail, r.fix);
    }).join('');

    // Device push readiness (local browser facts).
    var extra = '';
    var perm = (typeof Notification !== 'undefined') ? Notification.permission : 'unsupported';
    if (perm === 'granted') {
      extra += _diagRow('ok', 'Notifications allowed on this device', 'This device can receive push + attack alerts.');
    } else if (perm === 'denied') {
      extra += _diagRow('fail', 'Notifications blocked on this device', 'You blocked notifications — attack alerts can\'t arrive here.', 'Allow notifications for the site in your browser/phone settings.');
    } else {
      extra += _diagRow('warn', 'Notifications not enabled on this device', 'You haven\'t turned on notifications yet.', 'Enable notifications in the app so attack alerts reach this phone.');
    }

    el.innerHTML = rows + extra;
  };

  probes.forEach(function (p, i) {
    var t0 = Date.now();
    fetch(p.url, { credentials: 'include', headers: { 'Accept': 'application/json' } })
      .then(function (resp) {
        var ms = Date.now() - t0;
        return resp.text().then(function (txt) {
          var okBody = true, parsed = null;
          try { parsed = JSON.parse(txt); if (parsed && parsed.ok === false) okBody = false; } catch (e) { /* non-JSON is fine for some */ }
          if (resp.ok && okBody) {
            results[i] = { status: 'ok', label: p.label, detail: 'Responded ' + resp.status + ' in ' + ms + 'ms.' };
          } else if (resp.status === 401 || resp.status === 403) {
            // Not an outage — just needs auth/permission (e.g. admin stats when not owner).
            results[i] = { status: 'ok', label: p.label, detail: 'Reachable (' + resp.status + ' — needs sign-in/permission).' };
          } else {
            results[i] = { status: 'fail', label: p.label, detail: 'Returned ' + resp.status + (parsed && parsed.error ? ' — ' + parsed.error : '') + '.', fix: 'This feature is erroring right now.' };
          }
          done++; render();
        });
      })
      .catch(function (err) {
        results[i] = { status: 'fail', label: p.label, detail: 'No response: ' + err.message + '.', fix: 'The endpoint is unreachable.' };
        done++; render();
      });
  });

  // Kick an initial render so the section isn't stuck on a spinner if fetches lag.
  setTimeout(render, 400);
}

function _diagRenderSummary() {
  var el = document.getElementById('diag-summary');
  if (!el) return;
  var s = window._diagServerSummary || {};
  var pill = function (n, label, color) {
    return '<div style="flex:1;background:var(--card2,rgba(0,0,0,.06));border-radius:10px;padding:.5rem .3rem;text-align:center">' +
      '<div style="font-size:1.1rem;font-weight:800;color:' + color + '">' + (n || 0) + '</div>' +
      '<div style="font-size:.58rem;color:var(--muted);text-transform:uppercase;letter-spacing:.03em">' + label + '</div></div>';
  };
  el.innerHTML =
    pill(s.fail, 'Problems', '#C0392B') +
    pill(s.warn, 'To check', '#B7791F') +
    pill(s.ok, 'Healthy', '#0F6E56');
}

/* ══════════════════════════════════
   CHANNELS MANAGER PANEL
══════════════════════════════════ */
function _tgcLoad() {
  var el = document.getElementById('tgc-list');
  if (!el) return;
  api.get('/telegram-channels').then(function (res) {
    var chans = (res && res.channels) || [];
    window._tgcChannels = chans;
    if (!chans.length) { el.innerHTML = '<div style="font-size:.78rem;color:var(--muted);text-align:center;padding:.5rem">No Telegram channels yet.</div>'; return; }
    el.innerHTML = chans.map(function (c) {
      var av = c.photo_url
        ? '<div style="width:32px;height:32px;border-radius:50%;background-image:url(' + c.photo_url + ');background-size:cover;background-position:center;flex-shrink:0"></div>'
        : '<div style="width:32px;height:32px;border-radius:50%;background:#229ED9;color:#fff;display:flex;align-items:center;justify-content:center;font-size:.9rem;flex-shrink:0">📨</div>';
      return '<div style="display:flex;align-items:center;gap:.5rem;padding:.45rem 0;border-bottom:1px solid var(--border)">' +
        av +
        '<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;unicode-bidi:plaintext">' + (c.is_private ? '🔒 ' : '') + escHtml(c.title || c.username) + '</div>' +
        '<div style="font-size:.68rem;color:var(--muted)">@' + escHtml(c.username) + ' · ' + (c.members || 0) + ' joined here</div></div>' +
        '<button onclick="tgcEdit(\'' + c.id + '\')" style="background:none;color:var(--gold);border:none;font-size:.78rem;cursor:pointer">Edit</button>' +
        '<button onclick="tgcRemove(\'' + c.id + '\',this)" style="background:none;color:var(--red);border:none;font-size:.78rem;cursor:pointer">Remove</button>' +
      '</div>';
    }).join('');
  }).catch(function () { el.innerHTML = '<div style="font-size:.78rem;color:var(--muted)">Could not load.</div>'; });
}
window.tgcAdd = function () {
  var u = (document.getElementById('tgc-user') || {}).value || '';
  var t = (document.getElementById('tgc-title') || {}).value || '';
  var pEl = document.getElementById('tgc-photo');
  var photo = pEl && pEl.files && pEl.files[0];
  if (!u.trim()) { toast('Enter a @username'); return; }

  var done = function (res) {
    if (!res.ok) { toast('❌ ' + (res.error || 'Failed')); return; }
    toast('✅ Channel added');
    document.getElementById('tgc-user').value = '';
    document.getElementById('tgc-title').value = '';
    if (pEl) pEl.value = '';
    _tgcLoad();
  };
  var fail = function (e) { toast('❌ ' + e.message); };

  if (photo) {
    var fd = new FormData();
    fd.append('username', u);
    fd.append('title', t);
    fd.append('photo', photo);
    api.post('/telegram-channels', fd, true).then(done).catch(fail);
  } else {
    api.post('/telegram-channels', { username: u, title: t }).then(done).catch(fail);
  }
};
window.tgcEdit = function (id) {
  var old = document.getElementById('tgc-edit');
  if (old) old.remove();
  var ov = document.createElement('div');
  ov.id = 'tgc-edit';
  ov.style.cssText = 'position:fixed;inset:0;z-index:950;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:1rem';
  ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
  ov.innerHTML =
    '<div style="background:var(--surface);border-radius:14px;padding:1rem;width:100%;max-width:380px;box-sizing:border-box">' +
      '<div style="font-weight:700;font-size:.95rem;margin-bottom:.7rem">Edit channel</div>' +
      '<label style="font-size:.75rem;color:var(--muted)">Name</label>' +
      '<input id="tge-title" placeholder="Channel name" style="width:100%;box-sizing:border-box;padding:.55rem;border:1px solid var(--border);border-radius:8px;background:var(--bg3);color:var(--text);font-family:inherit;font-size:.85rem;margin:.25rem 0 .7rem">' +
      '<label style="font-size:.75rem;color:var(--muted)">Photo</label>' +
      '<input type="file" id="tge-photo" accept="image/*" style="width:100%;font-size:.78rem;margin:.25rem 0 .9rem">' +
      '<label style="display:flex;align-items:center;gap:.5rem;font-size:.82rem;margin-bottom:.5rem;cursor:pointer">' +
        '<input type="checkbox" id="tge-private" onchange="document.getElementById(\'tge-allowed-wrap\').style.display=this.checked?\'block\':\'none\'" style="width:18px;height:18px"> 🔒 Private channel (only people you list can see it)' +
      '</label>' +
      '<div id="tge-allowed-wrap" style="display:none;margin-bottom:.9rem">' +
        '<label style="font-size:.75rem;color:var(--muted)">Allowed people — one @username (or email) per line:</label>' +
        '<textarea id="tge-allowed" rows="4" placeholder="@yanky\n@moshe" style="width:100%;box-sizing:border-box;padding:.55rem;border:1px solid var(--border);border-radius:8px;background:var(--bg3);color:var(--text);font-family:inherit;font-size:.85rem;margin-top:.25rem"></textarea>' +
        '<div style="font-size:.68rem;color:var(--muted);margin-top:.25rem">You (the admin) can always see every channel.</div>' +
      '</div>' +
      '<div style="display:flex;gap:.5rem;justify-content:flex-end">' +
        '<button onclick="document.getElementById(\'tgc-edit\').remove()" style="background:none;border:none;color:var(--muted);font-size:.85rem;cursor:pointer;padding:.4rem .8rem">Cancel</button>' +
        '<button class="save-pill" onclick="tgcSaveEdit(\'' + id + '\')">Save</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(ov);
  // Pre-fill from the loaded channel (name, privacy, allow-list).
  var ch = (window._tgcChannels || []).find(function (c) { return c.id === id; });
  if (ch) {
    var tEl = document.getElementById('tge-title'); if (tEl) tEl.value = ch.title || '';
    if (ch.is_private) {
      var pc = document.getElementById('tge-private'); if (pc) pc.checked = true;
      var aw = document.getElementById('tge-allowed-wrap'); if (aw) aw.style.display = 'block';
      var list = [];
      try { list = JSON.parse(ch.allowed_users || '[]'); } catch (e) { list = []; }
      var aEl = document.getElementById('tge-allowed'); if (aEl) aEl.value = list.map(function (x) { return '@' + x; }).join('\n');
    }
  }
};

window.tgcSaveEdit = function (id) {
  var title = (document.getElementById('tge-title') || {}).value || '';
  var fileEl = document.getElementById('tge-photo');
  var file = fileEl && fileEl.files && fileEl.files[0];
  var isPrivate = (document.getElementById('tge-private') || {}).checked ? '1' : '0';
  var allowed = (document.getElementById('tge-allowed') || {}).value || '';

  var fd = new FormData();
  fd.append('id', id);
  if (title.trim()) fd.append('title', title.trim());
  if (file) fd.append('photo', file);
  fd.append('is_private', isPrivate);
  fd.append('allowed_users', allowed);

  api.put('/telegram-channels', fd, true).then(function (res) {
    if (res.error) { toast('❌ ' + res.error); return; }
    toast('✅ Saved');
    var ov = document.getElementById('tgc-edit'); if (ov) ov.remove();
    _tgcLoad();
  }).catch(function (e) { toast('❌ ' + e.message); });
};

window.tgcRemove = function (id, btn) {
  if (btn) btn.disabled = true;
  api.del('/telegram-channels?id=' + encodeURIComponent(id)).then(function () { toast('Removed'); _tgcLoad(); })
    .catch(function (e) { toast('❌ ' + e.message); if (btn) btn.disabled = false; });
};


function buildChannelsMgrPanel(content) {
  content.innerHTML =
    '<div class="admin-panel">' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">📨 Telegram channels</div>' +
        '<div style="font-size:.76rem;color:var(--muted);margin-bottom:.7rem">Add a <b>public</b> Telegram channel by its @username (e.g. <code>@channelname</code>). It shows in the Channels tab and streams its posts from Telegram, read-only.<br><b>Note:</b> private invite links (t.me/+…) can\'t be embedded — only public channels with a @username.</div>' +
        '<div style="display:flex;gap:.4rem;margin-bottom:.5rem">' +
          '<input id="tgc-user" placeholder="@channelusername" style="flex:1;padding:.55rem;border:1px solid var(--border);border-radius:8px;background:var(--bg3);color:var(--text);font-family:inherit;font-size:.85rem">' +
          '<button class="save-pill" onclick="tgcAdd()">Add</button>' +
        '</div>' +
        '<input id="tgc-title" placeholder="Display name (optional)" style="width:100%;box-sizing:border-box;padding:.5rem;border:1px solid var(--border);border-radius:8px;background:var(--bg3);color:var(--text);font-family:inherit;font-size:.82rem;margin-bottom:.4rem">' +
        '<label style="font-size:.72rem;color:var(--muted)">Photo (optional)</label>' +
        '<input type="file" id="tgc-photo" accept="image/*" style="width:100%;font-size:.75rem;margin:.2rem 0 .7rem">' +
        '<div id="tgc-list"><div class="feed-state"><div class="spinner"></div></div></div>' +
        '</div>' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">📡 All Channels</div>' +
        '<div id="channels-mgr-list"><div class="feed-state"><div class="spinner"></div></div></div>' +
      '</div>' +
    '</div>';

  _tgcLoad();

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
  ypConfirm('Delete channel @' + nick + '? This cannot be undone.', { danger: true }).then(function (ok) {
    if (!ok) return;
    api.del('/channels?id=' + encodeURIComponent(id))
      .then(function () { toast('🗑 Deleted'); buildChannelsMgrPanel(document.getElementById('admin-content')); })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
};

/* ══════════════════════════════════
   YID PLUS AI — control panel
   Lets the owner configure how the assistant behaves for everyone: on/off,
   its name, its instructions (persona/behaviour), a welcome message, and the
   per-user hourly limit. Also shows which AI engine is active.
══════════════════════════════════ */
function buildAIPanel(content) {
  content.innerHTML =
    '<div class="admin-panel"><div class="admin-card">' +
      '<div class="admin-card-title">🤖 YID PLUS AI</div>' +
      '<div id="ai-panel-body"><div class="feed-state"><div class="spinner"></div></div></div>' +
    '</div></div>';

  api.get('/admin/ai-settings')
    .then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'Failed to load');
      var s = res.settings || {};
      var provider = res.provider || 'none';

      var providerLine;
      if (provider === 'claude') {
        providerLine = '<div style="background:rgba(15,110,86,.12);border:1px solid rgba(15,110,86,.4);border-radius:10px;padding:.55rem .7rem;font-size:.72rem;line-height:1.45">🟢 <b>Engine:</b> Claude (best quality). Active.</div>';
      } else if (provider === 'cloudflare') {
        providerLine = '<div style="background:rgba(34,158,217,.12);border:1px solid rgba(34,158,217,.4);border-radius:10px;padding:.55rem .7rem;font-size:.72rem;line-height:1.45">🔵 <b>Engine:</b> Cloudflare Workers AI (free). Active. For stronger Yiddish you can add an ANTHROPIC_API_KEY.</div>';
      } else {
        providerLine = '<div style="background:rgba(192,57,43,.12);border:1px solid rgba(192,57,43,.4);border-radius:10px;padding:.55rem .7rem;font-size:.72rem;line-height:1.45">🔴 <b>No engine connected.</b> Bind Cloudflare Workers AI (free) as <code>AI</code> in your Pages settings, or add an <code>ANTHROPIC_API_KEY</code> secret. The settings below still save.</div>';
      }

      var body = document.getElementById('ai-panel-body');
      if (!body) return;
      body.innerHTML =
        providerLine +

        // Enable toggle
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin:.9rem 0 .3rem">' +
          '<div><div style="font-weight:700;font-size:.85rem">Show YID PLUS AI for everyone</div>' +
            '<div style="font-size:.66rem;color:var(--muted)">Off = it disappears from everyone\'s chat list and no one can use it. On = it comes back.</div></div>' +
          '<input type="checkbox" id="ai-enabled"' + (s.enabled ? ' checked' : '') + ' style="width:22px;height:22px;cursor:pointer;accent-color:#7C3AED;flex-shrink:0">' +
        '</div>' +

        // Name
        '<label style="font-size:.75rem;color:var(--muted);display:block;margin-top:.8rem">Name</label>' +
        '<input id="ai-name" value="' + escHtml(s.name || 'YID PLUS AI') + '" style="width:100%;box-sizing:border-box;padding:.55rem;border:1px solid var(--border);border-radius:8px;background:var(--bg3);color:var(--text);font-family:inherit;font-size:.85rem;margin-top:.2rem">' +

        // Instructions
        '<label style="font-size:.75rem;color:var(--muted);display:block;margin-top:.8rem">How the AI should behave (your instructions)</label>' +
        '<div style="font-size:.64rem;color:var(--muted);margin:.15rem 0 .3rem;line-height:1.4">Write, in your own words, how the AI should act — its personality, tone, what it should focus on, what to avoid. This applies to everyone. (Basic safety rules always stay on.)</div>' +
        '<textarea id="ai-instructions" rows="7" placeholder="למשל: ביסט א פֿריינדליכער אידישער אסיסטענט פֿאר אונזער קהילה. ענטפער קורץ און קלאר. זיי תמיד בכבודיק…" style="width:100%;box-sizing:border-box;padding:.6rem;border:1px solid var(--border);border-radius:8px;background:var(--bg3);color:var(--text);font-family:inherit;font-size:.82rem;line-height:1.5" dir="auto">' + escHtml(s.instructions || '') + '</textarea>' +

        // Welcome
        '<label style="font-size:.75rem;color:var(--muted);display:block;margin-top:.8rem">Welcome message (shown before the first message)</label>' +
        '<textarea id="ai-welcome" rows="2" placeholder="ווילקומען! פרעג מיר וואס דו ווילסט…" style="width:100%;box-sizing:border-box;padding:.55rem;border:1px solid var(--border);border-radius:8px;background:var(--bg3);color:var(--text);font-family:inherit;font-size:.82rem" dir="auto">' + escHtml(s.welcome || '') + '</textarea>' +

        // Hourly limit
        '<label style="font-size:.75rem;color:var(--muted);display:block;margin-top:.8rem">Messages per user per hour</label>' +
        '<input id="ai-limit" type="number" min="1" max="1000" value="' + (s.hourly_limit || 40) + '" style="width:120px;box-sizing:border-box;padding:.5rem;border:1px solid var(--border);border-radius:8px;background:var(--bg3);color:var(--text);font-family:inherit;font-size:.85rem;margin-top:.2rem">' +
        '<div style="font-size:.64rem;color:var(--muted);margin-top:.2rem">Keeps costs/abuse in check. 40 is a sensible default.</div>' +

        '<button class="save-pill" style="margin-top:1rem;width:100%;padding:.6rem" onclick="saveAISettings(this)">💾 Save</button>';
    })
    .catch(function (err) {
      var body = document.getElementById('ai-panel-body');
      if (body) body.innerHTML = '<div style="padding:.6rem;color:var(--red);font-size:.8rem">' + escHtml(err.message) + '</div>';
    });
}

window.saveAISettings = function (btn) {
  var payload = {
    enabled: !!(document.getElementById('ai-enabled') || {}).checked,
    name: ((document.getElementById('ai-name') || {}).value || '').trim(),
    instructions: (document.getElementById('ai-instructions') || {}).value || '',
    welcome: (document.getElementById('ai-welcome') || {}).value || '',
    hourly_limit: parseInt((document.getElementById('ai-limit') || {}).value || '40', 10) || 40,
  };
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  api.post('/admin/ai-settings', payload)
    .then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'Failed');
      toast('✅ Saved');
    })
    .catch(function (err) { toast('❌ ' + err.message); })
    .then(function () { if (btn) { btn.disabled = false; btn.innerHTML = '💾 Save'; } });
};

/* ══════════════════════════════════
   MAINTENANCE MODE PANEL
══════════════════════════════════ */
function buildMaintenancePanel(content) {
  content.innerHTML =
    '<div class="admin-panel">' +

      // ── Reset view counts (Owner only) ──
      '<div class="admin-card">' +
        '<div class="admin-card-title">🔢 Reset View Counts</div>' +
        '<div style="font-size:.75rem;color:var(--muted);margin-bottom:.75rem">Sets every short and post view count back to 0, so the numbers start clean and real from now on. This cannot be undone.</div>' +
        '<div id="reset-views-status" style="font-size:.85rem;font-weight:700;margin-bottom:.75rem;text-align:center"></div>' +
        '<button class="save-pill" style="width:100%;background:#DC2626" onclick="resetAllViews()">Reset all views to 0</button>' +
      '</div>' +

      // ── Email Verification (Owner only) ──
      '<div class="admin-card">' +
        '<div class="admin-card-title">📧 Email Verification</div>' +
        '<div style="font-size:.75rem;color:var(--muted);margin-bottom:.75rem">When ON — new users must click a confirmation link sent to their email before they can fully use their account. When OFF — accounts are activated immediately, no email sent.</div>' +
        '<div id="email-verify-status" style="font-size:.88rem;font-weight:700;margin-bottom:1rem;padding:.6rem;border-radius:8px;text-align:center">Loading...</div>' +
        '<div style="display:flex;gap:.5rem">' +
          '<button class="save-pill" style="flex:1;background:var(--green)" onclick="setEmailVerify(true)">✅ Require Verification</button>' +
          '<button class="save-pill" style="flex:1;background:var(--bg3);color:var(--text);border:1px solid var(--border)" onclick="setEmailVerify(false)">⚡ Skip Verification</button>' +
        '</div>' +
      '</div>' +

      // ── Guest Mode (Owner only) ──
      '<div class="admin-card">' +
        '<div class="admin-card-title">👁️ Guest Mode</div>' +
        '<div style="font-size:.75rem;color:var(--muted);margin-bottom:.75rem">When ON — anyone can browse the site without signing in, but cannot post, like, chat, or take any action. They will see a "Sign In" popup when they try.</div>' +
        '<div id="guest-status" style="font-size:.88rem;font-weight:700;margin-bottom:1rem;padding:.6rem;border-radius:8px;text-align:center">Loading...</div>' +
        '<div style="display:flex;gap:.5rem">' +
          '<button class="save-pill" style="flex:1;background:var(--blue)" onclick="setGuestMode(true)">👁️ Turn ON (Allow Guests)</button>' +
          '<button class="save-pill" style="flex:1;background:#7C3AED" onclick="setGuestMode(false)">🔒 Turn OFF (Login Required)</button>' +
        '</div>' +
      '</div>' +

      // ── Maintenance Mode ──
      '<div class="admin-card">' +
        '<div class="admin-card-title">🔧 Maintenance Mode</div>' +
        '<div style="font-size:.75rem;color:var(--muted);margin-bottom:.75rem">When ON — <strong>nobody</strong> can log in or register. Only you (Owner) are exempt.</div>' +
        '<div id="maint-status" style="font-size:1rem;font-weight:800;margin-bottom:1rem;padding:.85rem;border-radius:10px;text-align:center;letter-spacing:.02em">Loading...</div>' +
        '<textarea id="maint-msg" rows="2" placeholder="Message shown to users (e.g. Back in 10 minutes!)" style="width:100%;box-sizing:border-box;padding:.6rem;background:var(--bg3);border:.5px solid var(--border);border-radius:8px;color:var(--text);font-size:.82rem;font-family:inherit;outline:none;resize:none;margin-bottom:.75rem"></textarea>' +
        '<div style="display:flex;gap:.5rem">' +
          '<button class="save-pill" style="flex:1;background:#DC2626;font-size:.88rem;font-weight:800" onclick="setMaintenance(true)">🔴 TURN ON</button>' +
          '<button class="save-pill" style="flex:1;background:#16A34A;font-size:.88rem;font-weight:800" onclick="setMaintenance(false)">🟢 TURN OFF</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  // Load email verification status
  api.get('/admin/email-verify-toggle')
    .then(function (res) {
      var el = document.getElementById('email-verify-status');
      if (!el) return;
      el.style.background = res.enabled ? 'rgba(34,197,94,.12)' : 'rgba(148,148,148,.12)';
      el.style.color = res.enabled ? 'var(--green)' : 'var(--muted)';
      el.textContent = res.enabled ? '✅ VERIFICATION REQUIRED — Email links sent' : '⚡ NO VERIFICATION — Instant signup';
    })
    .catch(function () {});

  // Load guest mode status
  api.get('/admin/guest-mode')
    .then(function (res) {
      var el = document.getElementById('guest-status');
      if (!el) return;
      el.style.background = res.enabled ? 'rgba(31,111,92,.1)' : 'rgba(124,58,237,.1)';
      el.style.color = res.enabled ? 'var(--blue)' : '#7C3AED';
      el.textContent = res.enabled ? '👁️ GUEST MODE IS ON — Anyone can browse' : '🔒 LOGIN REQUIRED — Guests cannot access';
    })
    .catch(function () {});

  // Load maintenance status
  api.get('/admin/maintenance')
    .then(function (res) {
      var el = document.getElementById('maint-status');
      var msgEl = document.getElementById('maint-msg');
      if (!el) return;
      el.style.background = res.maintenance_mode ? 'rgba(220,38,38,.2)' : 'rgba(22,163,74,.15)';
      el.style.color = res.maintenance_mode ? '#DC2626' : '#16A34A';
      el.textContent = res.maintenance_mode ? '🔴 ON — Nobody can log in right now' : '🟢 OFF — Site is open normally';
      if (msgEl) msgEl.value = res.message || '';
    })
    .catch(function () {});
}

window.setEmailVerify = function (enabled) {
  api.post('/admin/email-verify-toggle', { enabled: enabled })
    .then(function () {
      toast(enabled ? '✅ Email Verification Required' : '⚡ Verification Skipped');
      buildMaintenancePanel(document.getElementById('admin-content'));
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.setGuestMode = function (enabled) {
  api.post('/admin/guest-mode', { enabled: enabled })
    .then(function () {
      toast(enabled ? '👁️ Guest Mode ON' : '🔒 Login Required');
      buildMaintenancePanel(document.getElementById('admin-content'));
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

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
  ypConfirm('⚠️ ' + label + ' ' + category + '?\n\nAre you sure?', { danger: true }).then(function (ok) {
    if (!ok) return;
    api.post('/admin/nuclear', { category: category, action: action })
      .then(function () { toast(action === 'hide' ? '🔴 Hidden!' : '🟢 Restored!'); })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
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
  ypConfirm('Remove Nuclear access?', { danger: true }).then(function (ok) {
    if (!ok) return;
    api.del('/admin/nuclear?permissions=1&id=' + encodeURIComponent(id))
      .then(function () { toast('✓ Access revoked'); loadNuclearPermList(); })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
};

/* ══════════════════════════════════
   SESSIONS MANAGER
══════════════════════════════════ */
function buildSessionsPanel(content) {
  content.innerHTML =
    '<div class="admin-panel">' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">' + (ADMIN_ICONS.sessions||'') + ' Active Sessions</div>' +
        '<div style="display:flex;gap:.5rem;margin-bottom:.75rem">' +
          '<button class="save-pill" style="background:#E11D48;flex:1" onclick="adminForceLogoutAll()">Force Logout Everyone</button>' +
        '</div>' +
        '<div id="sessions-list"><div class="feed-state"><div class="spinner"></div></div></div>' +
      '</div>' +
    '</div>';
  api.get('/admin/sessions-mgr')
    .then(function (res) {
      var el = document.getElementById('sessions-list');
      if (!el) return;
      var sessions = res.sessions || [];
      if (!sessions.length) { el.innerHTML = '<div style="padding:1rem;text-align:center;font-size:.8rem;color:var(--muted)">No active sessions</div>'; return; }
      el.innerHTML = sessions.map(function (s) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:.55rem 0;border-bottom:.5px solid var(--border)">' +
          '<div>' +
            '<div style="font-size:.82rem;font-weight:700">@' + escHtml(s.nickname || s.user_id) + (s.online ? ' <span style="color:#22C55E;font-size:.65rem">● online</span>' : '') + '</div>' +
            '<div style="font-size:.67rem;color:var(--muted)">' + escHtml(s.email||'') + ' · ' + timeAgo(s.created_at) + '</div>' +
          '</div>' +
          '<button class="act-btn act-block" onclick="adminKickSession(\'' + s.user_id + '\')">Logout</button>' +
        '</div>';
      }).join('');
    })
    .catch(function (err) { var el = document.getElementById('sessions-list'); if (el) el.innerHTML = '<div style="padding:1rem;color:#E11D48;font-size:.8rem">' + escHtml(err.message) + '</div>'; });
}
window.adminForceLogoutAll = function () {
  ypConfirm('Force logout ALL users? (You will also be logged out)', { danger: true }).then(function (ok) {
    if (!ok) return;
    api.del('/admin/sessions-mgr?all=1')
      .then(function () { toast('Done — all sessions cleared'); buildSessionsPanel(document.getElementById('admin-content')); })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
};
window.adminKickSession = function (userId) {
  api.del('/admin/sessions-mgr?user_id=' + encodeURIComponent(userId))
    .then(function () { toast('Logged out'); buildSessionsPanel(document.getElementById('admin-content')); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

/* ══════════════════════════════════
   EXPORT CSV
══════════════════════════════════ */
function buildExportPanel(content) {
  content.innerHTML =
    '<div class="admin-panel">' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">' + (ADMIN_ICONS.export||'') + ' Export Data</div>' +
        '<div style="font-size:.78rem;color:var(--muted);margin-bottom:1rem">אראפלאדן אלע יוזערס אלס CSV פייל — נאמען, עמעיל, טעלעפאן, ראלע.</div>' +
        '<button class="bc-send-btn" onclick="adminDownloadCSV()">Download Users CSV</button>' +
      '</div>' +
    '</div>';
}
window.adminDownloadCSV = function () {
  var a = document.createElement('a');
  a.href = CONFIG.API_BASE + '/admin/export';
  a.download = 'yidplus-users.csv';
  a.click();
  toast('Downloading...');
};

/* ══════════════════════════════════
   GROWTH ANALYTICS
══════════════════════════════════ */
function buildGrowthPanel(content) {
  content.innerHTML = '<div class="admin-panel"><div class="admin-card"><div class="admin-card-title">📈 Growth</div>' +
    '<div style="color:var(--muted);font-size:.8rem">Loading…</div></div></div>';
  api.get('/admin/growth').then(function (d) {
    if (!d.ok) { content.innerHTML = '<div class="admin-panel"><div class="admin-card">❌ ' + (d.error || 'Error') + '</div></div>'; return; }
    function stat(label, val) {
      return '<div style="flex:1;min-width:90px;background:var(--bg3);border-radius:12px;padding:.7rem .5rem;text-align:center">' +
        '<div style="font-size:1.4rem;font-weight:800">' + (val == null ? '—' : val.toLocaleString()) + '</div>' +
        '<div style="font-size:.66rem;color:var(--muted);margin-top:.15rem">' + label + '</div></div>';
    }
    var per = d.per_day || [];
    var max = per.reduce(function (m, x) { return Math.max(m, x.count); }, 1);
    var bars = per.map(function (x) {
      var h = Math.round((x.count / max) * 90) + 4;
      return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:2px" title="' + x.day + ': ' + x.count + '">' +
        '<div style="width:100%;max-width:16px;height:' + h + 'px;background:#185FA5;border-radius:3px 3px 0 0"></div>' +
        '<div style="font-size:.5rem;color:var(--muted);transform:rotate(-45deg);white-space:nowrap;margin-top:2px">' + x.day.slice(5) + '</div></div>';
    }).join('');
    content.innerHTML = '<div class="admin-panel">' +
      '<div class="admin-card"><div class="admin-card-title">📈 Growth</div>' +
        '<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.8rem">' +
          stat('Total users', d.total) + stat('New 24h', d.new_24h) + stat('New 7d', d.new_7d) +
        '</div>' +
        '<div style="display:flex;gap:.5rem;flex-wrap:wrap">' +
          stat('Active today', d.dau) + stat('Active 7d', d.wau) + stat('Active 30d', d.mau) +
        '</div>' +
      '</div>' +
      '<div class="admin-card"><div class="admin-card-title">New users / day (30d)</div>' +
        (per.length ? '<div style="display:flex;align-items:flex-end;gap:2px;height:120px;padding-top:.5rem;overflow-x:auto">' + bars + '</div>'
                    : '<div style="color:var(--muted);font-size:.8rem">No signups in the last 30 days.</div>') +
      '</div>' +
    '</div>';
  }).catch(function (e) { content.innerHTML = '<div class="admin-panel"><div class="admin-card">❌ ' + e.message + '</div></div>'; });
}

/* ══════════════════════════════════
   ANTI-SPAM & WELCOME
══════════════════════════════════ */
// Flipping this on with broken email delivery locks everyone out of signing up,
// so the switch and the test sit together and the warning stays until it's on.
// Goes through email-verify-toggle rather than writing the setting directly:
// that endpoint also grandfathers existing accounts, which is what stops the
// switch locking out everyone who signed up before the column existed.
window.asSaveVerify = function (on) {
  var lbl = document.querySelector('#as-verify + span');
  api.post('/admin/email-verify-toggle', { enabled: on }).then(function (res) {
    if (!res.ok) {
      toast('❌ ' + (res.error || 'Failed'));
      var cb = document.getElementById('as-verify');
      if (cb) cb.checked = !on;   // put the switch back where it was
      return;
    }
    if (STATE.settings) STATE.settings.require_email_verify = on ? 'true' : 'false';
    if (lbl) lbl.textContent = on ? 'On' : 'Off';
    var warn = document.getElementById('as-verify-warn');
    if (warn) warn.style.display = on ? 'none' : '';
    toast(on
      ? '✅ New accounts must verify' + (res.grandfathered ? ' · ' + res.grandfathered + ' existing accounts kept their access' : '')
      : 'Email verification off');
  }).catch(function (e) {
    toast('❌ ' + e.message);
    var cb = document.getElementById('as-verify');
    if (cb) cb.checked = !on;
  });
};

window.asTestEmail = function () {
  var out = document.getElementById('as-test-out');
  if (out) { out.style.color = 'var(--muted)'; out.textContent = 'Sending…'; }
  // No recipient = the endpoint sends to the signed-in owner.
  api.post('/admin/email-test', {}).then(function (res) {
    if (!out) return;
    if (res.ok) {
      out.style.color = 'var(--green,#1F6F5C)';
      out.textContent = '✅ Sent. Check your inbox (and spam). If it arrived, verification is safe to switch on.';
    } else {
      out.style.color = 'var(--red)';
      out.textContent = '❌ ' + (res.error || 'Failed') + (res.resend_status ? ' (Resend ' + res.resend_status + ')' : '');
    }
  }).catch(function (e) {
    if (out) { out.style.color = 'var(--red)'; out.textContent = '❌ ' + e.message; }
  });
};

function buildAntispamPanel(content) {
  var s = STATE.settings || {};
  var rateMax = s.register_rate_max || '5';
  var welEnabled = s.welcome_enabled === 'true';
  var welMsg = s.welcome_message || '';
  var verifyOn = s.require_email_verify === 'true';
  content.innerHTML = '<div class="admin-panel">' +
    // The site has always been able to do this — register.js sends the email
    // and verify-email.js handles the click — it was just never switched on,
    // and there was nowhere in the UI to switch it on.
    '<div class="admin-card">' +
      '<div class="admin-card-title">📧 Require email verification</div>' +
      '<div style="font-size:.76rem;color:var(--muted);margin-bottom:.8rem;line-height:1.5">' +
        'New accounts must click a link sent to their email before they can use the site. Someone who typed an address that isn\'t theirs never gets in.<br>' +
        '<b>This is the only way to check an address is real.</b> No site can verify someone\'s email password — not even their email provider can, and any site that asks for it is a phishing attempt.' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:.7rem;flex-wrap:wrap">' +
        '<label style="display:flex;align-items:center;gap:.5rem;cursor:pointer">' +
          '<input type="checkbox" id="as-verify" ' + (verifyOn ? 'checked' : '') + ' onchange="asSaveVerify(this.checked)" style="width:18px;height:18px;cursor:pointer">' +
          '<span style="font-size:.9rem;font-weight:600">' + (verifyOn ? 'On' : 'Off') + '</span>' +
        '</label>' +
        '<button class="save-pill" onclick="asTestEmail()" style="margin-left:auto">Send test email</button>' +
      '</div>' +
      '<div id="as-verify-warn" style="font-size:.74rem;color:var(--red);margin-top:.6rem;' + (verifyOn ? 'display:none' : '') + '">' +
        '⚠️ Test that emails actually arrive before switching this on — if they don\'t, nobody will be able to register at all.' +
      '</div>' +
      '<div id="as-test-out" style="font-size:.76rem;margin-top:.5rem"></div>' +
    '</div>' +
    '<div class="admin-card">' +
      '<div class="admin-card-title">🛡 Anti-spam</div>' +
      '<div style="font-size:.76rem;color:var(--muted);margin-bottom:.8rem">Cap how many new accounts one IP can create per hour. Stops bot floods when you open to the public.</div>' +
      '<div style="display:flex;align-items:center;gap:.6rem">' +
        '<span style="font-size:.85rem">Max sign-ups / IP / hour:</span>' +
        '<input id="as-reg-max" type="number" min="1" value="' + escHtml(rateMax) + '" style="width:80px;padding:.5rem;border:1px solid var(--border);border-radius:8px;background:var(--bg3);color:var(--text);font-family:inherit">' +
        '<button class="save-pill" onclick="asSaveRate()">Save</button>' +
      '</div>' +
    '</div>' +
    '<div class="admin-card">' +
      '<div class="admin-card-title">👋 Welcome message</div>' +
      '<div style="font-size:.76rem;color:var(--muted);margin-bottom:.8rem">Automatically DM every new member from your account. Use <code>{name}</code> to insert their name.</div>' +
      '<label style="display:flex;align-items:center;gap:.5rem;margin-bottom:.7rem;cursor:pointer">' +
        '<input type="checkbox" id="as-wel-on" ' + (welEnabled ? 'checked' : '') + ' style="width:18px;height:18px;cursor:pointer">' +
        '<span style="font-size:.85rem;font-weight:700">Send a welcome DM to new members</span>' +
      '</label>' +
      '<textarea id="as-wel-msg" dir="auto" rows="4" placeholder="ברוך הבא {name}! מיר פרייען זיך דיך צו האבן דא..." style="width:100%;box-sizing:border-box;padding:.7rem;border:1px solid var(--border);border-radius:10px;background:var(--bg3);color:var(--text);font-family:inherit;font-size:.85rem;resize:vertical">' + escHtml(welMsg) + '</textarea>' +
      '<button class="bc-send-btn" style="margin-top:.7rem" onclick="asSaveWelcome()">Save welcome message</button>' +
    '</div>' +
  '</div>';
}
window.asSaveRate = function () {
  var v = (document.getElementById('as-reg-max') || {}).value || '5';
  saveSetting('register_rate_max', String(Math.max(1, parseInt(v) || 5)));
};
window.asSaveWelcome = function () {
  var on = (document.getElementById('as-wel-on') || {}).checked;
  var msg = (document.getElementById('as-wel-msg') || {}).value || '';
  saveSetting('welcome_enabled', on ? 'true' : 'false');
  saveSetting('welcome_message', msg);
};

/* ══════════════════════════════════
   EMAIL TEMPLATES
══════════════════════════════════ */
function buildEmailTemplatesPanel(content) {
  var s = STATE.settings || {};
  function fld(id, label, val, ph) {
    return '<div style="margin-bottom:.9rem"><div style="font-size:.78rem;font-weight:700;margin-bottom:.3rem">' + label + '</div>' +
      '<input id="' + id + '" value="' + escHtml(val || '') + '" placeholder="' + ph + '" style="width:100%;box-sizing:border-box;padding:.6rem;border:1px solid var(--border);border-radius:8px;background:var(--bg3);color:var(--text);font-family:inherit;font-size:.85rem"></div>';
  }
  content.innerHTML = '<div class="admin-panel">' +
    '<div class="admin-card">' +
      '<div class="admin-card-title">✉️ Email settings</div>' +
      '<div style="font-size:.76rem;color:var(--muted);margin-bottom:.9rem">Customize the emails members receive. Leave blank to use the defaults. The confirm button/link is added automatically.</div>' +
      fld('et-from', 'From name (shown as the sender)', s.email_from_name, 'YID PLUS') +
      fld('et-verify-subj', 'Verification email — subject', s.email_verify_subject, 'Confirm your YID PLUS account') +
      '<div style="margin-bottom:.9rem"><div style="font-size:.78rem;font-weight:700;margin-bottom:.3rem">Verification email — intro text</div>' +
        '<textarea id="et-verify-intro" dir="auto" rows="3" placeholder="Please confirm your email address to activate your account." style="width:100%;box-sizing:border-box;padding:.6rem;border:1px solid var(--border);border-radius:8px;background:var(--bg3);color:var(--text);font-family:inherit;font-size:.85rem;resize:vertical">' + escHtml(s.email_verify_intro || '') + '</textarea></div>' +
      '<button class="bc-send-btn" onclick="etSave()">Save email templates</button>' +
    '</div>' +
  '</div>';
}
window.etSave = function () {
  saveSetting('email_from_name', (document.getElementById('et-from') || {}).value || '');
  saveSetting('email_verify_subject', (document.getElementById('et-verify-subj') || {}).value || '');
  saveSetting('email_verify_intro', (document.getElementById('et-verify-intro') || {}).value || '');
  toast('✅ Email templates saved!');
};

/* ══════════════════════════════════
   FEATURED CONTENT
══════════════════════════════════ */
function buildFeaturedPanel(content) {
  content.innerHTML = '<div class="admin-panel"><div class="admin-card"><div class="admin-card-title">⭐ Featured posts</div>' +
    '<div style="color:var(--muted);font-size:.8rem">Loading…</div></div></div>';
  api.get('/admin/feature').then(function (d) {
    if (!d.ok) { content.innerHTML = '<div class="admin-panel"><div class="admin-card">❌ ' + (d.error || 'Error') + '</div></div>'; return; }
    var rows = (d.posts || []).map(function (p) {
      var feat = !!p.is_featured;
      var cap = (p.caption || '(no caption)').slice(0, 60);
      return '<div style="display:flex;align-items:center;gap:.5rem;padding:.5rem 0;border-bottom:1px solid var(--border)">' +
        (feat ? '<span style="font-size:1rem">⭐</span>' : '') +
        '<div style="flex:1;min-width:0"><div style="font-size:.82rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" dir="auto">' + escHtml(cap) + '</div>' +
        '<div style="font-size:.66rem;color:var(--muted)">@' + escHtml(p.username || '?') + ' · ' + timeAgo(p.created_at) + '</div></div>' +
        '<button class="save-pill" style="' + (feat ? 'background:#B45309' : '') + '" onclick="adminToggleFeature(\'' + p.id + '\',' + (feat ? 'false' : 'true') + ',this)">' + (feat ? 'Unfeature' : '⭐ Feature') + '</button>' +
      '</div>';
    }).join('');
    content.innerHTML = '<div class="admin-panel"><div class="admin-card">' +
      '<div class="admin-card-title">⭐ Featured posts</div>' +
      '<div style="font-size:.74rem;color:var(--muted);margin-bottom:.7rem">Featured posts are pinned to the top of everyone\'s feed.</div>' +
      (rows || '<div style="color:var(--muted);font-size:.8rem">No posts yet.</div>') +
    '</div></div>';
  }).catch(function (e) { content.innerHTML = '<div class="admin-panel"><div class="admin-card">❌ ' + e.message + '</div></div>'; });
}
window.adminToggleFeature = function (postId, featured, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  api.post('/admin/feature', { post_id: postId, featured: featured })
    .then(function () { toast(featured ? '⭐ Featured!' : 'Unfeatured'); buildFeaturedPanel(document.getElementById('admin-content')); })
    .catch(function (err) { toast('❌ ' + err.message); if (btn) btn.disabled = false; });
};

function buildHealthPanel(content) {
  content.innerHTML = '<div class="admin-panel"><div class="admin-card"><div class="admin-card-title">💾 Storage</div>' +
    '<div style="color:var(--muted);font-size:.8rem">Loading…</div></div></div>';
  api.get('/admin/health').then(function (d) {
    if (!d.ok) { content.innerHTML = '<div class="admin-panel"><div class="admin-card">❌ ' + (d.error || 'Error') + '</div></div>'; return; }
    function fmtBytes(b) { return b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1073741824).toFixed(2) + ' GB'; }
    var rows = Object.keys(d.counts || {}).map(function (t) {
      var c = d.counts[t];
      return '<div style="display:flex;justify-content:space-between;padding:.42rem .1rem;border-bottom:1px solid var(--border)">' +
        '<span style="font-size:.82rem">' + t + '</span>' +
        '<span style="font-weight:700;font-size:.82rem">' + (c == null ? '—' : c.toLocaleString()) + '</span></div>';
    }).join('');
    var r2 = d.r2 || {};
    content.innerHTML = '<div class="admin-panel">' +
      '<div class="admin-card"><div class="admin-card-title">📦 R2 media storage</div>' +
        '<div style="display:flex;gap:.5rem">' +
          '<div style="flex:1;background:var(--bg3);border-radius:12px;padding:.7rem;text-align:center"><div style="font-size:1.3rem;font-weight:800">' + (r2.objects || 0).toLocaleString() + (r2.truncated ? '+' : '') + '</div><div style="font-size:.66rem;color:var(--muted)">files</div></div>' +
          '<div style="flex:1;background:var(--bg3);border-radius:12px;padding:.7rem;text-align:center"><div style="font-size:1.3rem;font-weight:800">' + fmtBytes(r2.bytes || 0) + (r2.truncated ? '+' : '') + '</div><div style="font-size:.66rem;color:var(--muted)">used</div></div>' +
        '</div>' +
        (r2.truncated ? '<div style="font-size:.66rem;color:var(--muted);margin-top:.5rem">Showing first ~10k files.</div>' : '') +
      '</div>' +
      '<div class="admin-card"><div class="admin-card-title">🗄 Database rows</div>' + rows + '</div>' +
    '</div>';
  }).catch(function (e) { content.innerHTML = '<div class="admin-panel"><div class="admin-card">❌ ' + e.message + '</div></div>'; });
}

/* ══════════════════════════════════
   LEADERBOARD
══════════════════════════════════ */
function buildLeaderboardPanel(content) {
  content.innerHTML =
    '<div class="admin-panel">' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">' + (ADMIN_ICONS.leaderboard||'') + ' Top Users by Activity</div>' +
        '<div id="leaderboard-content"><div class="feed-state"><div class="spinner"></div></div></div>' +
      '</div>' +
    '</div>';
  api.get('/admin/leaderboard')
    .then(function (res) {
      var el = document.getElementById('leaderboard-content');
      if (!el) return;
      function section(title, items, label) {
        if (!items || !items.length) return '';
        return '<div style="margin-bottom:1.25rem"><div style="font-size:.72rem;font-weight:800;color:#1F6F5C;letter-spacing:.1em;text-transform:uppercase;margin-bottom:.5rem">' + title + '</div>' +
          items.map(function (u, i) {
            return '<div style="display:flex;align-items:center;gap:.6rem;padding:.4rem 0;border-bottom:.5px solid var(--border)">' +
              '<div style="width:22px;font-size:.8rem;font-weight:800;color:' + (['#F59E0B','#94A3B8','#CD7C32'][i]||'var(--muted)') + '">#' + (i+1) + '</div>' +
              '<div style="flex:1;font-size:.82rem">' + escHtml(u.uid||'unknown') + '</div>' +
              '<div style="font-size:.78rem;font-weight:700;color:#1F6F5C">' + fmtN(u.cnt) + ' ' + label + '</div>' +
            '</div>';
          }).join('') + '</div>';
      }
      el.innerHTML =
        section('Videos (Shorts)', res.shorts, 'vids') +
        section('Music Uploads', res.music, 'tracks') +
        section('Messages Sent', res.messages, 'msgs') ||
        '<div style="text-align:center;font-size:.8rem;color:var(--muted);padding:1rem">No data yet</div>';
    })
    .catch(function (err) { var el = document.getElementById('leaderboard-content'); if (el) el.innerHTML = '<div style="color:#E11D48;font-size:.8rem;padding:1rem">' + escHtml(err.message) + '</div>'; });
}

/* ══════════════════════════════════
   ANNOUNCEMENTS
══════════════════════════════════ */
function buildAnnouncementsPanel(content) {
  content.innerHTML =
    '<div class="admin-panel">' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">' + (ADMIN_ICONS.announcements||'') + ' Pinned Announcements</div>' +
        '<div style="font-size:.72rem;color:var(--muted);margin-bottom:.75rem">ארויסגעשטעלטע נאכריכטן וואס אלע יוזערס זעען אויפן הויפטשירם.</div>' +
        '<textarea id="ann-text" rows="3" placeholder="Type announcement..." style="width:100%;box-sizing:border-box;padding:.6rem;background:var(--bg3);border:1.5px solid var(--border);border-radius:10px;color:var(--text);font-size:.82rem;font-family:inherit;outline:none;resize:none;margin-bottom:.6rem"></textarea>' +
        '<button class="bc-send-btn" onclick="adminPostAnnouncement()" style="margin-bottom:1rem">Post Announcement</button>' +
        '<div style="font-size:.72rem;font-weight:800;color:#1F6F5C;letter-spacing:.1em;text-transform:uppercase;margin-bottom:.5rem">Active:</div>' +
        '<div id="ann-list"><div class="feed-state"><div class="spinner"></div></div></div>' +
      '</div>' +
    '</div>';
  loadAnnouncementsList();
}
function loadAnnouncementsList() {
  api.get('/admin/announcements')
    .then(function (res) {
      var el = document.getElementById('ann-list'); if (!el) return;
      var list = res.announcements || [];
      if (!list.length) { el.innerHTML = '<div style="font-size:.8rem;color:var(--muted);padding:.5rem 0">No announcements yet</div>'; return; }
      el.innerHTML = list.map(function (a) {
        return '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:.6rem 0;border-bottom:.5px solid var(--border)">' +
          '<div style="flex:1"><div style="font-size:.82rem">' + escHtml(a.text) + '</div><div style="font-size:.67rem;color:var(--muted)">by @' + escHtml(a.created_by) + ' · ' + timeAgo(a.created_at) + '</div></div>' +
          '<button class="act-btn act-block" onclick="adminDeleteAnnouncement(\'' + a.id + '\')">Remove</button>' +
        '</div>';
      }).join('');
    }).catch(function () {});
}
window.adminPostAnnouncement = function () {
  var text = (document.getElementById('ann-text')||{}).value || '';
  if (!text.trim()) { toast('Type something first'); return; }
  api.post('/admin/announcements', { text: text.trim() })
    .then(function () { toast('Posted!'); document.getElementById('ann-text').value = ''; loadAnnouncementsList(); })
    .catch(function (err) { toast('❌ ' + err.message); });
};
window.adminDeleteAnnouncement = function (id) {
  api.del('/admin/announcements?id=' + encodeURIComponent(id))
    .then(function () { toast('Removed'); loadAnnouncementsList(); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

/* ══════════════════════════════════
   CUSTOM BADGES
══════════════════════════════════ */
function buildBadgesPanel(content) {
  content.innerHTML =
    '<div class="admin-panel">' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">' + (ADMIN_ICONS.badges||'') + ' Custom Badges</div>' +
        '<div style="font-size:.72rem;color:var(--muted);margin-bottom:.75rem">צולייגן א ספּעציאל באדזש צו א יוזער (z.b. ⭐ VIP, 🎵 Artist).</div>' +
        '<input id="badge-user-search" class="admin-search" placeholder="Search user..." oninput="badgeUserSearch()">' +
        '<div id="badge-user-results" style="margin-bottom:.75rem"></div>' +
        '<div style="font-size:.72rem;font-weight:800;color:#1F6F5C;letter-spacing:.1em;text-transform:uppercase;margin-bottom:.5rem">All Badges:</div>' +
        '<div id="badges-list"><div class="feed-state"><div class="spinner"></div></div></div>' +
      '</div>' +
    '</div>';
  loadBadgesList();
}
function loadBadgesList() {
  api.get('/admin/badges')
    .then(function (res) {
      var el = document.getElementById('badges-list'); if (!el) return;
      var badges = res.badges || [];
      if (!badges.length) { el.innerHTML = '<div style="font-size:.8rem;color:var(--muted);padding:.5rem 0">No badges yet</div>'; return; }
      el.innerHTML = badges.map(function (b) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:.5rem 0;border-bottom:.5px solid var(--border)">' +
          '<div>' +
            '<span style="background:' + escHtml(b.badge_color) + ';color:#fff;border-radius:6px;padding:.1rem .45rem;font-size:.72rem;font-weight:700">' + escHtml(b.badge_text) + '</span>' +
            '<span style="font-size:.75rem;color:var(--muted);margin-left:.5rem">→ @' + escHtml(b.nickname||b.user_id) + '</span>' +
          '</div>' +
          '<button class="act-btn act-block" onclick="adminDeleteBadge(\'' + b.id + '\')">Remove</button>' +
        '</div>';
      }).join('');
    }).catch(function () {});
}
window.badgeUserSearch = function () {
  var q = (document.getElementById('badge-user-search')||{}).value || '';
  var el = document.getElementById('badge-user-results'); if (!el) return;
  if (q.length < 2) { el.innerHTML = ''; return; }
  api.get('/admin/users?search=' + encodeURIComponent(q))
    .then(function (res) {
      var users = res.users || [];
      el.innerHTML = users.slice(0,5).map(function (u) {
        return '<div style="display:flex;align-items:center;gap:.5rem;padding:.4rem .5rem;background:var(--bg3);border-radius:8px;margin-bottom:.35rem">' +
          '<span style="font-size:.82rem;flex:1">@' + escHtml(u.nickname) + '</span>' +
          '<input id="badge-text-' + u.id + '" placeholder="Badge text..." style="flex:1;padding:.35rem .5rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:.75rem;outline:none">' +
          '<input type="color" id="badge-color-' + u.id + '" value="#1F6F5C" style="width:30px;height:28px;border:none;border-radius:6px;cursor:pointer;padding:0">' +
          '<button class="save-pill" style="background:#1F6F5C;margin-left:0" onclick="adminGrantBadge(\'' + u.id + '\')">Add</button>' +
        '</div>';
      }).join('') || '<div style="font-size:.78rem;color:var(--muted)">No users found</div>';
    }).catch(function () {});
};
window.adminGrantBadge = function (userId) {
  var text  = (document.getElementById('badge-text-' + userId)||{}).value || '';
  var color = (document.getElementById('badge-color-' + userId)||{}).value || '#1F6F5C';
  if (!text.trim()) { toast('Enter badge text'); return; }
  api.post('/admin/badges', { user_id: userId, badge_text: text.trim(), badge_color: color })
    .then(function () { toast('Badge granted!'); loadBadgesList(); })
    .catch(function (err) { toast('❌ ' + err.message); });
};
window.adminDeleteBadge = function (id) {
  api.del('/admin/badges?id=' + encodeURIComponent(id))
    .then(function () { toast('Removed'); loadBadgesList(); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

/* ══════════════════════════════════
   WARNINGS PANEL
══════════════════════════════════ */
function buildWarningsPanel(content) {
  content.innerHTML =
    '<div class="admin-panel">' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">' + (ADMIN_ICONS.warnings||'') + ' Send Warning to User</div>' +
        '<div style="font-size:.72rem;color:var(--muted);margin-bottom:.75rem">שיק א וואָרענונג צו א יוזער — ער קריגט עס ווי א נאכריכט. קיין בלאק, נאר א וואָרענונג.</div>' +
        '<input id="warn-user-search" class="admin-search" placeholder="Search user to warn..." oninput="warnUserSearch()">' +
        '<div id="warn-user-results"></div>' +
      '</div>' +
    '</div>';
}
window.warnUserSearch = function () {
  var q = (document.getElementById('warn-user-search')||{}).value || '';
  var el = document.getElementById('warn-user-results'); if (!el) return;
  if (q.length < 2) { el.innerHTML = ''; return; }
  api.get('/admin/users?search=' + encodeURIComponent(q))
    .then(function (res) {
      var users = res.users || [];
      el.innerHTML = users.slice(0,5).map(function (u) {
        return '<div style="background:var(--bg3);border-radius:10px;padding:.75rem;margin-bottom:.5rem">' +
          '<div style="font-size:.82rem;font-weight:700;margin-bottom:.4rem">@' + escHtml(u.nickname) + '</div>' +
          '<textarea id="warn-msg-' + u.id + '" rows="2" placeholder="Warning message..." style="width:100%;box-sizing:border-box;padding:.5rem;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:.78rem;font-family:inherit;outline:none;resize:none;margin-bottom:.4rem"></textarea>' +
          '<button class="save-pill" style="background:#F59E0B;color:#000" onclick="adminSendWarning(\'' + u.id + '\')">⚠️ Send Warning</button>' +
        '</div>';
      }).join('') || '<div style="font-size:.78rem;color:var(--muted);padding:.5rem 0">No users found</div>';
    }).catch(function () {});
};
window.adminSendWarning = function (userId) {
  var msg = (document.getElementById('warn-msg-' + userId)||{}).value || '';
  if (!msg.trim()) { toast('Write a message first'); return; }
  api.post('/admin/warnings', { user_id: userId, message: msg.trim() })
    .then(function () { toast('⚠️ Warning sent!'); buildWarningsPanel(document.getElementById('admin-content')); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

/* ══════════════════════════════════
   BAD WORDS / CONTENT FILTER PANEL
══════════════════════════════════ */
function buildBadWordsPanel(content) {
  content.innerHTML =
    '<div class="admin-section-title">🚫 Word Filter</div>' +
    '<div class="admin-card">' +
      '<div style="font-size:.82rem;color:var(--muted);margin-bottom:.85rem;line-height:1.5">' +
        'Words will be automatically blurred for all users. Users get a warning when typing them.' +
      '</div>' +
      // ── Step 1: Paste ──
      '<div style="margin-bottom:.65rem">' +
        '<div style="font-size:.75rem;color:var(--muted);margin-bottom:.3rem;font-weight:700">Step 1 — Paste your word list:</div>' +
        '<textarea id="bw-bulk-inp" placeholder="Paste words here — one per line or comma/space separated..." rows="5" style="width:100%;box-sizing:border-box;padding:.55rem .75rem;background:var(--bg3);border:1.5px solid var(--border);border-radius:10px;color:var(--text);font-size:.82rem;font-family:inherit;outline:none;resize:vertical" oninput="previewBulkWords()"></textarea>' +
      '</div>' +
      // ── Step 2: Preview ──
      '<div id="bw-preview-area" style="display:none;margin-bottom:.65rem">' +
        '<div style="font-size:.75rem;color:var(--muted);margin-bottom:.4rem;font-weight:700">Step 2 — Review words (click ✕ to remove mistakes):</div>' +
        '<div id="bw-preview-tags" style="display:flex;flex-wrap:wrap;gap:.35rem;max-height:150px;overflow-y:auto;padding:.5rem;background:var(--bg3);border-radius:10px;border:1px solid var(--border)"></div>' +
        '<div style="margin-top:.5rem;display:flex;gap:.5rem">' +
          '<div id="bw-preview-count" style="flex:1;font-size:.78rem;color:var(--muted);display:flex;align-items:center"></div>' +
          '<button onclick="importPreviewedWords()" id="bw-import-btn" style="padding:.55rem 1.25rem;background:#DC2626;color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-family:inherit;font-size:.85rem">⬆️ Import All</button>' +
        '</div>' +
      '</div>' +
      // ── Single word ──
      '<div style="display:flex;gap:.5rem;margin-bottom:.85rem">' +
        '<input id="bw-inp" placeholder="Or add one word at a time..." style="flex:1;padding:.55rem .75rem;background:var(--bg3);border:1.5px solid var(--border);border-radius:10px;color:var(--text);font-size:.85rem;font-family:inherit;outline:none" onkeydown="if(event.key===\'Enter\')addBadWord()">' +
        '<button onclick="addBadWord()" style="padding:.55rem 1rem;background:#DC2626;color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-family:inherit;font-size:.85rem">Add</button>' +
      '</div>' +
      '<div style="border-top:1px solid var(--border);padding-top:.75rem">' +
        '<div style="display:flex;gap:.5rem;margin-bottom:.5rem">' +
          '<button onclick="bwShowTab(\'words\',this)" class="bw-tab-btn active" style="flex:1;padding:.4rem;background:var(--blue);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:.78rem;font-weight:700;font-family:inherit">Words</button>' +
          '<button onclick="bwShowTab(\'phrases\',this)" class="bw-tab-btn" style="flex:1;padding:.4rem;background:var(--bg3);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:.78rem;font-weight:600;font-family:inherit;color:var(--text)">Phrases (multi-word)</button>' +
        '</div>' +
        '<div id="bw-list"><div class="spinner-sm"></div></div>' +
        '<div id="bw-phrases-list" style="display:none"><div class="spinner-sm"></div></div>' +
        '<div id="bw-add-phrase" style="display:none;margin-top:.5rem">' +
          '<div style="font-size:.72rem;color:var(--muted);margin-bottom:.3rem">Add a phrase (2+ words that are bad together):</div>' +
          '<div style="display:flex;gap:.5rem">' +
            '<input id="bw-phrase-inp" placeholder="e.g. two word phrase..." style="flex:1;padding:.5rem .75rem;background:var(--bg3);border:1.5px solid var(--border);border-radius:10px;color:var(--text);font-size:.82rem;font-family:inherit;outline:none" onkeydown="if(event.key===\'Enter\')addBadPhrase()">' +
            '<button onclick="addBadPhrase()" style="padding:.5rem .85rem;background:#DC2626;color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-family:inherit">Add</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  loadBadWordsList();
}

function loadBadWordsList() {
  var el = document.getElementById('bw-list');
  if (!el) return;
  api.get('/admin/bad-words', true)
    .then(function (res) {
      var words = res.words || [];
      if (!words.length) {
        el.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--muted);font-size:.85rem">No words blocked yet</div>';
        return;
      }
      el.innerHTML =
        '<div style="display:flex;flex-wrap:wrap;gap:.4rem">' +
          words.map(function (w) {
            return '<div style="display:flex;align-items:center;gap:.35rem;background:rgba(220,38,38,.1);border:1px solid rgba(220,38,38,.25);border-radius:20px;padding:.25rem .65rem">' +
              '<span style="font-size:.82rem;font-weight:600;color:#DC2626">' + escHtml(w.word) + '</span>' +
              '<button onclick="removeBadWord(\'' + w.id + '\')" style="background:none;border:none;cursor:pointer;color:#DC2626;padding:0;line-height:1;font-size:.9rem">✕</button>' +
            '</div>';
          }).join('') +
        '</div>';
    })
    .catch(function () {
      var el = document.getElementById('bw-list');
      if (el) el.innerHTML = '<div style="color:#DC2626;font-size:.82rem">Could not load list</div>';
    });
}

// Preview words before importing
var BW_previewWords = [];   // single words
var BW_previewPhrases = []; // multi-word phrases

window.previewBulkWords = function () {
  var inp = document.getElementById('bw-bulk-inp');
  var area = document.getElementById('bw-preview-area');
  var tagsEl = document.getElementById('bw-preview-tags');
  var countEl = document.getElementById('bw-preview-count');
  if (!inp || !area || !tagsEl) return;

  var raw = inp.value;
  if (!raw.trim()) { area.style.display = 'none'; BW_previewWords = []; BW_previewPhrases = []; return; }

  // Split by newlines ONLY — each line is one entry (could be 1 word or a phrase)
  var lines = raw.split(/\n/)
    .map(function (line) { return line.trim().toLowerCase(); })
    .filter(function (line) { return line.length >= 2; });

  // Remove duplicates
  var seen = {};
  lines = lines.filter(function (l) { if (seen[l]) return false; seen[l] = true; return true; });

  // Separate single words from multi-word phrases
  BW_previewWords = [];
  BW_previewPhrases = [];
  lines.forEach(function (line) {
    var parts = line.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      BW_previewPhrases.push(line); // multi-word → phrase
    } else {
      BW_previewWords.push(line); // single word
    }
  });

  area.style.display = 'block';

  // Render tag chips — words in red, phrases in orange
  tagsEl.innerHTML =
    BW_previewWords.map(function (w, i) {
      return '<div id="bw-tag-w-' + i + '" style="display:flex;align-items:center;gap:.25rem;background:rgba(220,38,38,.1);border:1px solid rgba(220,38,38,.25);border-radius:20px;padding:.2rem .55rem">' +
        '<span style="font-size:.78rem;color:#DC2626;font-weight:600">' + escHtml(w) + '</span>' +
        '<button onclick="removeBWItem(\'w\',' + i + ')" style="background:none;border:none;cursor:pointer;color:#DC2626;padding:0;font-size:.8rem;line-height:1">✕</button>' +
      '</div>';
    }).join('') +
    BW_previewPhrases.map(function (p, i) {
      return '<div id="bw-tag-p-' + i + '" style="display:flex;align-items:center;gap:.25rem;background:rgba(234,88,12,.1);border:1px solid rgba(234,88,12,.3);border-radius:20px;padding:.2rem .55rem">' +
        '<span style="font-size:.65rem;color:#EA580C;margin-right:.1rem">📝</span>' +
        '<span style="font-size:.78rem;color:#EA580C;font-weight:600">' + escHtml(p) + '</span>' +
        '<button onclick="removeBWItem(\'p\',' + i + ')" style="background:none;border:none;cursor:pointer;color:#EA580C;padding:0;font-size:.8rem;line-height:1">✕</button>' +
      '</div>';
    }).join('');

  var total = BW_previewWords.length + BW_previewPhrases.length;
  if (countEl) countEl.innerHTML =
    '<span style="color:#DC2626;font-weight:600">' + BW_previewWords.length + ' words</span>' +
    (BW_previewPhrases.length ? ' + <span style="color:#EA580C;font-weight:600">' + BW_previewPhrases.length + ' phrases</span>' : '') +
    ' ready to import';
};

window.removeBWItem = function (type, i) {
  if (type === 'w') {
    BW_previewWords.splice(i, 1);
    var tag = document.getElementById('bw-tag-w-' + i);
    if (tag) tag.remove();
  } else {
    BW_previewPhrases.splice(i, 1);
    var tag2 = document.getElementById('bw-tag-p-' + i);
    if (tag2) tag2.remove();
  }
  var total = BW_previewWords.length + BW_previewPhrases.length;
  var countEl = document.getElementById('bw-preview-count');
  if (countEl) countEl.innerHTML =
    '<span style="color:#DC2626;font-weight:600">' + BW_previewWords.length + ' words</span>' +
    (BW_previewPhrases.length ? ' + <span style="color:#EA580C;font-weight:600">' + BW_previewPhrases.length + ' phrases</span>' : '') +
    ' ready to import';
  if (!total) {
    var area = document.getElementById('bw-preview-area');
    if (area) area.style.display = 'none';
  }
};

// Keep backward compat
window.removeBWPreviewWord = function (i) { removeBWItem('w', i); };

window.importPreviewedWords = function () {
  var words = BW_previewWords.slice();
  var phrases = BW_previewPhrases.slice();
  var total = words.length + phrases.length;
  if (!total) { toast('No words to import'); return; }

  var btn = document.getElementById('bw-import-btn');
  if (btn) { btn.textContent = 'Importing ' + total + '...'; btn.disabled = true; }

  var added = 0, failed = 0;
  var allItems = words.map(function(w){ return {word: w}; }).concat(phrases.map(function(p){ return {phrase: p}; }));

  function sendNext(i) {
    if (i >= allItems.length) {
      BW_previewWords = [];
      BW_previewPhrases = [];
      var inp = document.getElementById('bw-bulk-inp');
      if (inp) inp.value = '';
      var area = document.getElementById('bw-preview-area');
      if (area) area.style.display = 'none';
      if (btn) { btn.textContent = '⬆️ Import All'; btn.disabled = false; }
      toast('✅ Imported ' + added + (failed ? ' (' + failed + ' skipped)' : ''));
      loadBadWordsList();
      var el = document.getElementById('bw-phrases-list');
      if (el) { el.dataset.loaded = ''; }
      FILTER_loaded = false;
      if (typeof loadContentFilter === 'function') loadContentFilter();
      return;
    }
    api.post('/admin/bad-words', allItems[i])
      .then(function () { added++; sendNext(i + 1); })
      .catch(function () { failed++; sendNext(i + 1); });
  }
  sendNext(0);
};

window.addBulkBadWords = window.importPreviewedWords;

window.addBadWord = function () {
  var inp = document.getElementById('bw-inp');
  if (!inp) return;
  var word = inp.value.trim().toLowerCase();
  if (!word) return;
  if (word.length < 2) { toast('Word too short'); return; }
  inp.value = '';
  api.post('/admin/bad-words', { word: word })
    .then(function () {
      toast('✅ "' + word + '" added to filter');
      loadBadWordsList();
      // Reload filter in frontend
      FILTER_loaded = false;
      if (typeof loadContentFilter === 'function') loadContentFilter();
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.removeBadWord = function (id) {
  api.del('/admin/bad-words?id=' + encodeURIComponent(id))
    .then(function () {
      toast('Removed from filter');
      loadBadWordsList();
      FILTER_loaded = false;
      if (typeof loadContentFilter === 'function') loadContentFilter();
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

/* ── BAD WORDS TABS ── */
window.bwShowTab = function (tab, btn) {
  document.querySelectorAll('.bw-tab-btn').forEach(function (b) {
    b.style.background = 'var(--bg3)';
    b.style.color = 'var(--text)';
    b.style.border = '1px solid var(--border)';
  });
  btn.style.background = 'var(--blue)';
  btn.style.color = '#fff';
  btn.style.border = 'none';

  var wordsList = document.getElementById('bw-list');
  var phrasesList = document.getElementById('bw-phrases-list');
  var phraseAdd = document.getElementById('bw-add-phrase');

  if (tab === 'words') {
    if (wordsList) wordsList.style.display = 'block';
    if (phrasesList) phrasesList.style.display = 'none';
    if (phraseAdd) phraseAdd.style.display = 'none';
  } else {
    if (wordsList) wordsList.style.display = 'none';
    if (phrasesList) { phrasesList.style.display = 'block'; loadBadPhrasesList(); }
    if (phraseAdd) phraseAdd.style.display = 'block';
  }
};

function loadBadPhrasesList() {
  var el = document.getElementById('bw-phrases-list');
  if (!el || el.dataset.loaded) return;
  el.innerHTML = '<div class="spinner-sm"></div>';
  api.get('/admin/bad-words', true)
    .then(function (res) {
      var phrases = res.phrases || [];
      el.dataset.loaded = '1';
      if (!phrases.length) {
        el.innerHTML = '<div style="text-align:center;padding:1.25rem;color:var(--muted);font-size:.82rem">No phrases blocked yet</div>';
        return;
      }
      el.innerHTML =
        '<div style="display:flex;flex-direction:column;gap:.35rem">' +
          phrases.map(function (p) {
            return '<div style="display:flex;align-items:center;justify-content:space-between;background:rgba(220,38,38,.07);border:1px solid rgba(220,38,38,.2);border-radius:8px;padding:.35rem .65rem">' +
              '<span style="font-size:.82rem;font-weight:600;color:#DC2626">"' + escHtml(p.phrase) + '"</span>' +
              '<button onclick="removeBadPhrase(\'' + p.id + '\')" style="background:none;border:none;cursor:pointer;color:#DC2626;padding:0;font-size:.85rem">✕</button>' +
            '</div>';
          }).join('') +
        '</div>';
    })
    .catch(function () { el.innerHTML = '<div style="color:#DC2626;font-size:.82rem">Could not load</div>'; });
}

window.addBadPhrase = function () {
  var inp = document.getElementById('bw-phrase-inp');
  if (!inp) return;
  var phrase = inp.value.trim().toLowerCase();
  if (!phrase) return;
  if (phrase.split(/\s+/).length < 2) { toast('A phrase needs at least 2 words'); return; }
  inp.value = '';
  api.post('/admin/bad-words', { phrase: phrase })
    .then(function () {
      toast('✅ Phrase added!');
      var el = document.getElementById('bw-phrases-list');
      if (el) { el.dataset.loaded = ''; loadBadPhrasesList(); }
      FILTER_loaded = false;
      if (typeof loadContentFilter === 'function') loadContentFilter();
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.removeBadPhrase = function (id) {
  api.del('/admin/bad-words?id=' + encodeURIComponent(id) + '&type=phrase')
    .then(function () {
      toast('Phrase removed');
      var el = document.getElementById('bw-phrases-list');
      if (el) { el.dataset.loaded = ''; loadBadPhrasesList(); }
      FILTER_loaded = false;
      if (typeof loadContentFilter === 'function') loadContentFilter();
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

// ══════════════════════════════════
// TELEGRAM BRIDGE PANEL
// ══════════════════════════════════
function buildTelegramPanel(content) {
  content.innerHTML =
    '<div class="admin-panel">' +

      // ── Private bot → email (standalone, not YID PLUS) ──
      '<div class="admin-card">' +
        '<div class="admin-card-title">📧 Private bot → email</div>' +
        '<div style="font-size:.75rem;color:var(--muted);margin-bottom:.6rem">A separate, private Telegram bot (nothing to do with YID PLUS). Anything you post to it — video, photo, file or text — is emailed to the people you list below.</div>' +
        '<div style="background:var(--bg3);border-radius:10px;padding:.7rem;margin-bottom:.7rem;font-size:.72rem;color:var(--muted);line-height:1.5">' +
          '<strong style="color:var(--text)">One-time setup:</strong><br>' +
          '1. In Telegram, message <strong>@BotFather</strong> → <em>/newbot</em> → follow the steps → it gives you a <strong>token</strong>.<br>' +
          '2. In Cloudflare → your project → Settings → Variables, add:<br>' +
          '&nbsp;&nbsp;• <code>PRIVATE_BOT_TOKEN</code> = that token<br>' +
          '&nbsp;&nbsp;• <code>PRIVATE_BOT_WEBHOOK_SECRET</code> = any secret you choose<br>' +
          '3. Come back here and press <strong>Connect bot</strong>.' +
        '</div>' +
        '<div id="pbot-status" style="font-size:.75rem;background:var(--bg3);border-radius:8px;padding:.6rem;margin-bottom:.6rem">Checking…</div>' +
        '<button class="save-pill" style="width:100%;margin-bottom:.8rem" onclick="pbotConnect(this)">🔌 Connect bot</button>' +

        '<label style="display:flex;align-items:center;gap:.5rem;font-size:.85rem;margin-bottom:.6rem;cursor:pointer"><input type="checkbox" id="bmail-enabled" style="width:18px;height:18px"> Turn on email forwarding</label>' +
        '<label style="font-size:.75rem;color:var(--muted)">Send to these email addresses — one per line:</label>' +
        '<textarea id="bmail-recipients" rows="3" placeholder="me@example.com" style="width:100%;box-sizing:border-box;padding:.6rem;border:1px solid var(--border);border-radius:10px;background:var(--bg);color:var(--text);font-family:inherit;font-size:.85rem;margin:.3rem 0 .6rem"></textarea>' +
        '<div id="bmail-status" style="font-size:.78rem;margin-bottom:.5rem"></div>' +
        '<button class="save-pill" style="width:100%" onclick="bmailSave(this)">Save recipients</button>' +
      '</div>' +

      // ── Channel session (MTProto userbot) re-login ──
      '<div class="admin-card">' +
        '<div class="admin-card-title">📡 Channel Session (login)</div>' +
        '<div style="font-size:.75rem;color:var(--muted);margin-bottom:.6rem">This powers the <strong>Telegram channels feed and videos</strong>. If new posts stopped coming in, the session expired — log in again here. You\'ll need the worker\'s admin secret (Cloudflare → the worker → Settings → Variables → <code>WORKER_ADMIN_SECRET</code>).</div>' +
        '<div id="tg-sess-status" style="font-size:.78rem;background:var(--bg3);border-radius:8px;padding:.6rem;margin-bottom:.6rem">Enter the secret and press Check.</div>' +
        '<input id="tg-sess-secret" type="password" placeholder="Worker admin secret" style="width:100%;padding:.7rem .9rem;margin-bottom:.5rem;border:1px solid var(--border);border-radius:10px;background:var(--bg);color:var(--text);font-family:inherit;box-sizing:border-box">' +
        '<button class="save-pill" style="width:100%;margin-bottom:.5rem;background:var(--bg3);color:var(--text);border:1px solid var(--border)" onclick="tgSessCheck(this)">Check session status</button>' +

        '<div style="border-top:1px solid var(--border);margin:.6rem 0;padding-top:.6rem"></div>' +
        '<div style="font-size:.72rem;color:var(--muted);margin-bottom:.35rem">Step 1 — your Telegram phone (with country code):</div>' +
        '<input id="tg-sess-phone" type="tel" placeholder="+1XXXXXXXXXX" style="width:100%;padding:.7rem .9rem;margin-bottom:.5rem;border:1px solid var(--border);border-radius:10px;background:var(--bg);color:var(--text);font-family:inherit;box-sizing:border-box">' +
        '<button class="save-pill" style="width:100%;margin-bottom:.6rem" onclick="tgSessLogin(this)">Send me a code</button>' +

        '<div style="font-size:.72rem;color:var(--muted);margin-bottom:.35rem">Step 2 — the code Telegram texts you:</div>' +
        '<input id="tg-sess-code" type="text" inputmode="numeric" placeholder="12345" style="width:100%;padding:.7rem .9rem;margin-bottom:.5rem;border:1px solid var(--border);border-radius:10px;background:var(--bg);color:var(--text);font-family:inherit;box-sizing:border-box">' +
        '<button class="save-pill" style="width:100%;margin-bottom:.6rem" onclick="tgSessCode(this)">Confirm code</button>' +

        '<div style="font-size:.72rem;color:var(--muted);margin-bottom:.35rem">Step 3 — only if you have two-step verification:</div>' +
        '<input id="tg-sess-pw" type="password" placeholder="Two-step password" style="width:100%;padding:.7rem .9rem;margin-bottom:.5rem;border:1px solid var(--border);border-radius:10px;background:var(--bg);color:var(--text);font-family:inherit;box-sizing:border-box">' +
        '<button class="save-pill" style="width:100%" onclick="tgSessPassword(this)">Submit password</button>' +
      '</div>' +

      '<div class="admin-card">' +
        '<div class="admin-card-title">🔌 Bot Connection</div>' +
        '<div style="font-size:.75rem;color:var(--muted);margin-bottom:.6rem">The bot only receives messages once it\'s <strong>connected</strong> here. Do this first — without it, nothing comes through.</div>' +
        '<div id="tg-webhook-status" style="font-size:.75rem;background:var(--bg3);border-radius:8px;padding:.6rem;margin-bottom:.6rem">Checking…</div>' +
        '<div style="display:flex;gap:.5rem">' +
          '<button class="save-pill" style="flex:1" onclick="tgConnectBot(this)">🔌 Connect bot</button>' +
          '<button class="save-pill" style="flex:1;background:var(--bg3);color:var(--text);border:1px solid var(--border)" onclick="tgDisconnectBot(this)">Disconnect</button>' +
        '</div>' +
        '<div style="font-size:.68rem;color:var(--muted);margin-top:.5rem">Tip: to use "Get Updates" below (to find a Chat ID), Disconnect first — Telegram won\'t allow both at once. Reconnect when done.</div>' +
      '</div>' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">📤 Publishing Bot</div>' +
        '<div style="font-size:.75rem;color:var(--muted);margin-bottom:.6rem">A personal bot: anyone links their account (once, by email + code), then sends it a photo/video/text and picks where to post — channel, short, status, or a group — all under <strong>their own name</strong>. Needs a <strong>second</strong> bot token saved in Cloudflare as <code>TELEGRAM_POST_BOT_TOKEN</code>.</div>' +
        '<div id="tg-post-status" style="font-size:.75rem;background:var(--bg3);border-radius:8px;padding:.6rem;margin-bottom:.6rem">Checking…</div>' +
        '<div style="display:flex;gap:.5rem">' +
          '<button class="save-pill" style="flex:1" onclick="tgPostConnect(this)">📤 Connect publishing bot</button>' +
          '<button class="save-pill" style="flex:1;background:var(--bg3);color:var(--text);border:1px solid var(--border)" onclick="tgPostDisconnect(this)">Disconnect</button>' +
        '</div>' +
      '</div>' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">🤖 Telegram Bridge</div>' +
        '<div style="font-size:.75rem;color:var(--muted);margin-bottom:.75rem">' +
          'Link a Telegram group to a YID PLUS room. Every message sent in the Telegram group will automatically appear in the linked YID PLUS room.' +
        '</div>' +
        '<div style="background:var(--bg3);border-radius:10px;padding:.75rem;margin-bottom:1rem;font-size:.75rem;color:var(--muted)">' +
          '<strong style="color:var(--text)">Setup:</strong><br>' +
          '1. Add <strong>@yidplus_bot</strong> to your Telegram group as admin<br>' +
          '2. Find your Group Chat ID (see below)<br>' +
          '3. Link it to a YID PLUS room below' +
        '</div>' +

        '<div style="font-size:.8rem;font-weight:700;margin-bottom:.5rem">Link New Group</div>' +
        '<input class="field" id="tg-chat-id" placeholder="Telegram Chat ID (e.g. -1001234567890)" style="margin-bottom:.5rem">' +
        '<input class="field" id="tg-room-id" placeholder="YID PLUS Room ID" style="margin-bottom:.5rem">' +
        '<input class="field" id="tg-label" placeholder="Label (e.g. Main Group)" style="margin-bottom:.75rem">' +
        '<button class="save-pill" onclick="addTelegramBridge()">Link Group</button>' +
      '</div>' +

      '<div class="admin-card">' +
        '<div class="admin-card-title">🔍 Find Group ID</div>' +
        '<div style="font-size:.75rem;color:var(--muted);margin-bottom:.75rem">Add @yidplus_bot to your group and send a message, then click below to see the Chat ID.</div>' +
        '<button class="save-pill" style="background:var(--bg3);color:var(--text);border:1px solid var(--border)" onclick="getTelegramUpdates()">Get Updates (find Chat ID)</button>' +
        '<div id="tg-updates-result" style="margin-top:.75rem;font-size:.72rem;font-family:monospace;background:var(--bg3);border-radius:8px;padding:.5rem;display:none;word-break:break-all"></div>' +
      '</div>' +

      '<div class="admin-card">' +
        '<div class="admin-card-title">🔗 Active Bridges</div>' +
        '<div id="tg-bridges-list"><div style="text-align:center;padding:1rem"><div class="spinner"></div></div></div>' +
      '</div>' +
    '</div>';

  loadTelegramBridges();
  tgWebhookStatus();
  tgPostStatus();
  bmailLoad();
  pbotLoad();
}

window.tgPostStatus = function () {
  var el = document.getElementById('tg-post-status');
  if (!el) return;
  api.get('/telegram/post-bot-setup', true)
    .then(function (r) {
      if (r.connected) {
        var warn = r.last_error_message ? '<div style="color:#D32F2F;margin-top:.35rem">⚠ ' + escHtml(r.last_error_message) + '</div>' : '';
        el.innerHTML = '<div style="color:#16A34A;font-weight:700">✅ Connected</div>' +
          '<div style="color:var(--muted);margin-top:.25rem;word-break:break-all">' + escHtml(r.url || '') + '</div>' + warn;
      } else {
        el.innerHTML = '<div style="color:#B45309;font-weight:700">⚠ Not connected</div><div style="color:var(--muted);margin-top:.25rem">Save TELEGRAM_POST_BOT_TOKEN in Cloudflare, then tap Connect.</div>';
      }
    })
    .catch(function (err) { el.innerHTML = '<div style="color:#D32F2F">' + escHtml(err.message || 'Could not check') + '</div>'; });
};

window.tgPostConnect = function (btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }
  api.post('/telegram/post-bot-setup', {})
    .then(function () { toast('📤 Publishing bot connected!'); tgPostStatus(); })
    .catch(function (err) { toast('❌ ' + (err.message || 'Failed')); })
    .then(function () { if (btn) { btn.disabled = false; btn.textContent = '📤 Connect publishing bot'; } });
};

window.tgPostDisconnect = function (btn) {
  ypConfirm('Disconnect the publishing bot?', { danger: true }).then(function (ok) {
    if (!ok) return;
    if (btn) btn.disabled = true;
    api.del('/telegram/post-bot-setup')
      .then(function () { toast('Disconnected'); tgPostStatus(); })
      .catch(function (err) { toast('❌ ' + (err.message || 'Failed')); })
      .then(function () { if (btn) btn.disabled = false; });
  });
};

window.tgWebhookStatus = function () {
  var el = document.getElementById('tg-webhook-status');
  if (!el) return;
  api.get('/telegram/set-webhook', true)
    .then(function (r) {
      if (r.connected) {
        var warn = r.last_error_message ? '<div style="color:#D32F2F;margin-top:.35rem">⚠ Last error: ' + escHtml(r.last_error_message) + '</div>' : '';
        el.innerHTML = '<div style="color:#16A34A;font-weight:700">✅ Connected</div>' +
          '<div style="color:var(--muted);margin-top:.25rem;word-break:break-all">' + escHtml(r.url || '') + '</div>' +
          (r.pending_update_count ? '<div style="color:var(--muted);margin-top:.25rem">' + r.pending_update_count + ' pending</div>' : '') + warn;
      } else {
        el.innerHTML = '<div style="color:#B45309;font-weight:700">⚠ Not connected</div><div style="color:var(--muted);margin-top:.25rem">Tap "Connect bot" to start receiving Telegram messages.</div>';
      }
    })
    .catch(function (err) { el.innerHTML = '<div style="color:#D32F2F">' + escHtml(err.message || 'Could not check status') + '</div>'; });
};

window.tgConnectBot = function (btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }
  api.post('/telegram/set-webhook', {})
    .then(function () { toast('🔌 Bot connected!'); tgWebhookStatus(); })
    .catch(function (err) { toast('❌ ' + (err.message || 'Failed')); })
    .then(function () { if (btn) { btn.disabled = false; btn.textContent = '🔌 Connect bot'; } });
};

window.tgDisconnectBot = function (btn) {
  ypConfirm('Disconnect the bot? Telegram messages will stop mirroring until you reconnect.', { danger: true }).then(function (ok) {
    if (!ok) return;
    if (btn) btn.disabled = true;
    api.del('/telegram/set-webhook')
      .then(function () { toast('Disconnected'); tgWebhookStatus(); })
      .catch(function (err) { toast('❌ ' + (err.message || 'Failed')); })
      .then(function () { if (btn) btn.disabled = false; });
  });
};

window.loadTelegramBridges = function () {
  api.get('/admin/telegram-bridges', true)
    .then(function (res) {
      var el = document.getElementById('tg-bridges-list');
      if (!el) return;
      var bridges = res.bridges || [];
      if (!bridges.length) {
        el.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--muted);font-size:.8rem">No bridges yet</div>';
        return;
      }
      el.innerHTML = bridges.map(function (b) {
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:.6rem 0;border-bottom:1px solid var(--border)">' +
          '<div>' +
            '<div style="font-size:.82rem;font-weight:700">' + escHtml(b.label || b.telegram_chat_id) + '</div>' +
            '<div style="font-size:.68rem;color:var(--muted)">Chat: <code>' + b.telegram_chat_id + '</code> → ' + escHtml(b.room_name || b.room_id) + '</div>' +
            '<div style="font-size:.65rem;color:' + (b.active ? 'var(--green)' : 'var(--muted)') + '">' + (b.active ? '● Active' : '○ Inactive') + '</div>' +
          '</div>' +
          '<button onclick="removeTelegramBridge(\'' + b.id + '\')" style="background:none;border:1px solid var(--border);border-radius:8px;padding:.3rem .6rem;color:var(--red);cursor:pointer;font-size:.72rem">Remove</button>' +
        '</div>';
      }).join('');
    })
    .catch(function () {});
};

window.addTelegramBridge = function () {
  var chatId  = (document.getElementById('tg-chat-id').value || '').trim();
  var roomId  = (document.getElementById('tg-room-id').value || '').trim();
  var label   = (document.getElementById('tg-label').value || '').trim();
  if (!chatId || !roomId) { toast('⚠ Enter Chat ID and Room ID'); return; }
  api.post('/admin/telegram-bridges', { telegram_chat_id: chatId, room_id: roomId, label: label })
    .then(function () {
      toast('✅ Bridge added!');
      document.getElementById('tg-chat-id').value = '';
      document.getElementById('tg-room-id').value = '';
      document.getElementById('tg-label').value = '';
      loadTelegramBridges();
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.removeTelegramBridge = function (id) {
  ypConfirm('Remove this bridge?', { danger: true }).then(function (ok) {
    if (!ok) return;
    api.del('/admin/telegram-bridges?id=' + encodeURIComponent(id))
      .then(function () { toast('Removed'); loadTelegramBridges(); })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
};

window.getTelegramUpdates = function () {
  var el = document.getElementById('tg-updates-result');
  if (el) { el.style.display = 'block'; el.textContent = 'Loading...'; }
  fetch('/api/telegram/get-updates')
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (!el) return;
      var chats = (res.updates || [])
        .map(function (u) {
          var chat = (u.message || u.channel_post || {}).chat;
          return chat ? (chat.title || chat.username || 'Unknown') + ': ' + chat.id : null;
        })
        .filter(Boolean);
      el.textContent = chats.length ? chats.join('\n') : 'No recent messages found.\nSend a message in your Telegram group first.';
    })
    .catch(function () { if (el) el.textContent = 'Error fetching updates'; });
};

/* ══════════════════════════════════
   ACCESS CONTROL  (owner only)
══════════════════════════════════ */
function buildAccessControlPanel(content) {
  content.innerHTML =
    '<div class="admin-panel" id="ac-panel">' +
      '<div class="admin-card" style="text-align:center;padding:2rem"><div class="spinner"></div></div>' +
    '</div>';
  _loadAccessControl();
}

function _loadAccessControl() {
  api.get('/admin/access-control').then(function (res) {
    var panel = document.getElementById('ac-panel');
    if (!panel) return;
    var locked = !!res.locked;
    var list = res.allowlist || [];

    var rows = list.length ? list.map(function (a) {
      return '<div style="display:flex;align-items:center;gap:.6rem;padding:.6rem 0;border-bottom:.5px solid var(--border)">' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:.85rem;font-weight:700;direction:ltr;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtmlA(a.email) + '</div>' +
            '<div style="font-size:.68rem;color:var(--muted)">' + (a.nickname ? '@' + escHtmlA(a.nickname) : 'no account yet') + (a.note ? ' · ' + escHtmlA(a.note) : '') + '</div>' +
          '</div>' +
          '<button onclick="acRemoveAllow(\'' + escAttrA(a.email) + '\',this)" style="padding:.35rem .7rem;background:none;border:1px solid #E5989B;border-radius:8px;font-size:.72rem;font-weight:700;color:#D32F2F;cursor:pointer;font-family:inherit">Remove</button>' +
        '</div>';
    }).join('') : '<div style="padding:1rem;text-align:center;color:var(--muted);font-size:.8rem">No one on the allow-list yet.</div>';

    panel.innerHTML =
      // ── Lockdown toggle ──
      '<div class="admin-card">' +
        '<div class="admin-card-title">🔒 Sign-in lock</div>' +
        '<div style="display:flex;align-items:center;gap:.75rem">' +
          '<div style="flex:1">' +
            '<div style="font-size:.9rem;font-weight:700">' + (locked ? 'Sign-in is LOCKED' : 'Sign-in is open') + '</div>' +
            '<div style="font-size:.74rem;color:var(--muted);margin-top:.2rem">When locked, nobody can sign in or register — even existing accounts — except you and the people on the allow-list below.</div>' +
          '</div>' +
          '<button onclick="acToggleLock(' + (locked ? 'false' : 'true') + ')" style="padding:.55rem 1.1rem;border:none;border-radius:10px;font-weight:800;font-size:.8rem;cursor:pointer;font-family:inherit;color:#fff;background:' + (locked ? '#2E7D32' : '#C62828') + '">' +
            (locked ? 'Unlock' : 'Lock now') +
          '</button>' +
        '</div>' +
      '</div>' +

      // ── Allow a person (existing email) ──
      '<div class="admin-card">' +
        '<div class="admin-card-title">✅ Allow someone in</div>' +
        '<div style="font-size:.74rem;color:var(--muted);margin-bottom:.6rem">Add an email so that person can sign in even while sign-in is locked.</div>' +
        '<div style="display:flex;gap:.5rem">' +
          '<input id="ac-allow-email" type="email" placeholder="email@example.com" style="flex:1;padding:.6rem .8rem;border:1px solid var(--border);border-radius:10px;background:var(--bg3);color:var(--text);font-family:inherit;font-size:.85rem;direction:ltr">' +
          '<button onclick="acAddAllow()" style="padding:.6rem 1rem;border:none;border-radius:10px;background:var(--gold);color:#fff;font-weight:800;font-size:.8rem;cursor:pointer;font-family:inherit">Add</button>' +
        '</div>' +
      '</div>' +

      // ── Create a new account directly ──
      '<div class="admin-card">' +
        '<div class="admin-card-title">➕ Create an account</div>' +
        '<div style="font-size:.74rem;color:var(--muted);margin-bottom:.6rem">Make an account for someone without opening public sign-up. They\'ll be able to sign in right away (auto allow-listed).</div>' +
        '<input id="ac-new-email" type="email" placeholder="email@example.com" style="width:100%;padding:.6rem .8rem;border:1px solid var(--border);border-radius:10px;background:var(--bg3);color:var(--text);font-family:inherit;font-size:.85rem;direction:ltr;margin-bottom:.5rem;box-sizing:border-box">' +
        '<input id="ac-new-nick" type="text" placeholder="Nickname" style="width:100%;padding:.6rem .8rem;border:1px solid var(--border);border-radius:10px;background:var(--bg3);color:var(--text);font-family:inherit;font-size:.85rem;margin-bottom:.5rem;box-sizing:border-box">' +
        '<input id="ac-new-pass" type="text" placeholder="Temporary password (min 6)" style="width:100%;padding:.6rem .8rem;border:1px solid var(--border);border-radius:10px;background:var(--bg3);color:var(--text);font-family:inherit;font-size:.85rem;margin-bottom:.6rem;box-sizing:border-box">' +
        '<button onclick="acCreateAccount()" style="width:100%;padding:.65rem;border:none;border-radius:10px;background:#1F6F5C;color:#fff;font-weight:800;font-size:.82rem;cursor:pointer;font-family:inherit">Create account</button>' +
      '</div>' +

      // ── Allow-list ──
      '<div class="admin-card">' +
        '<div class="admin-card-title">🗝️ Allow-list (' + list.length + ')</div>' +
        rows +
      '</div>';
  }).catch(function (err) {
    var panel = document.getElementById('ac-panel');
    if (panel) panel.innerHTML = '<div class="admin-card" style="color:var(--red)">Could not load: ' + escHtmlA(err.message) + '</div>';
  });
}

window.acToggleLock = function (lock) {
  function _go() {
    api.put('/admin/access-control', { locked: lock })
      .then(function () { toast(lock ? '🔒 Sign-in locked' : '🔓 Sign-in open'); _loadAccessControl(); })
      .catch(function (err) { toast('❌ ' + err.message); });
  }
  if (lock) ypConfirm('Lock sign-in for EVERYONE except you and the allow-list?', { danger: true }).then(function (ok) { if (ok) _go(); });
  else _go();
};

window.acAddAllow = function () {
  var el = document.getElementById('ac-allow-email');
  var email = (el.value || '').trim();
  if (!email) { toast('Enter an email'); return; }
  api.post('/admin/access-control', { action: 'allow', email: email })
    .then(function () { toast('✅ Allowed ' + email); el.value = ''; _loadAccessControl(); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.acRemoveAllow = function (email, btn) {
  ypConfirm('Remove ' + email + ' from the allow-list?', { danger: true }).then(function (ok) {
    if (!ok) return;
    api.del('/admin/access-control?email=' + encodeURIComponent(email))
      .then(function () { toast('Removed'); _loadAccessControl(); })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
};

window.acCreateAccount = function () {
  var email = (document.getElementById('ac-new-email').value || '').trim();
  var nick  = (document.getElementById('ac-new-nick').value || '').trim();
  var pass  = (document.getElementById('ac-new-pass').value || '').trim();
  if (!email || !nick || !pass) { toast('Fill in all fields'); return; }
  api.post('/admin/access-control', { action: 'create_account', email: email, nickname: nick, password: pass })
    .then(function () { toast('✅ Account created for @' + nick); _loadAccessControl(); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

// Used from the Users panel — kick a user out; they must sign in again.
window.acForceLogout = function (userId, nick) {
  ypConfirm('Kick @' + nick + ' out? They\'ll have to sign in again.', { danger: true }).then(function (ok) {
    if (!ok) return;
    api.post('/admin/access-control', { action: 'force_logout', user_id: userId })
      .then(function () { toast('👢 @' + nick + ' was signed out'); })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
};

function escHtmlA(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttrA(s) { return String(s == null ? '' : s).replace(/'/g,"\\'").replace(/"/g,'&quot;'); }

// Ban a device/IP straight from the 360° user view — closes the door on a
// blocked user returning from the same device with a fresh account.
window.adminBanDevice = function (ip, fingerprint, btn) {
  if (!ip && !fingerprint) { toast('No device info'); return; }
  ypConfirm('Ban this device/IP? Nobody will be able to sign in or register from it.', { danger: true }).then(function (ok) {
    if (!ok) return;
    api.post('/admin/device-bans', { ip: ip || null, fingerprint: fingerprint || null, reason: 'Banned from user 360 view' })
      .then(function () {
        toast('🚫 Device banned');
        if (btn) { btn.outerHTML = '<span style="font-size:.68rem;font-weight:700;color:#D32F2F">🚫 Banned</span>'; }
      })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
};

/* ══════════════════════════════════
   NOW — live dashboard
══════════════════════════════════ */
function buildNowPanel(content) {
  content.innerHTML = '<div class="admin-panel" id="now-panel"><div class="admin-card" style="text-align:center;padding:2rem"><div class="spinner"></div></div></div>';
  clearInterval(window._nowTimer);
  _loadNow();
  window._nowTimer = setInterval(function () {
    if (!document.getElementById('now-panel')) { clearInterval(window._nowTimer); return; }
    _loadNow();
  }, 20000);
}

function _loadNow() {
  api.get('/admin/insights').then(function (res) {
    var p = document.getElementById('now-panel');
    if (!p) return;

    var stat = function (n, label, color) {
      return '<div style="flex:1;text-align:center;padding:.5rem"><div style="font-size:1.5rem;font-weight:800;color:' + (color || 'var(--text)') + '">' + fmtN(n) + '</div><div style="font-size:.68rem;color:var(--muted)">' + label + '</div></div>';
    };

    // Growth mini bar-chart
    var g = res.growth || [];
    var max = Math.max(1, Math.max.apply(null, g.map(function (d) { return d.count; })));
    var bars = g.map(function (d) {
      var h = Math.round((d.count / max) * 60);
      var dd = d.day.slice(8) + '/' + d.day.slice(5, 7);
      return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px" title="' + dd + ': ' + d.count + '">' +
          '<div style="font-size:.6rem;color:var(--muted)">' + (d.count || '') + '</div>' +
          '<div style="width:70%;height:' + Math.max(h, 2) + 'px;background:linear-gradient(180deg,#2B8A73,#14503F);border-radius:3px 3px 0 0"></div>' +
          '<div style="font-size:.55rem;color:var(--muted2)">' + d.day.slice(8) + '</div>' +
        '</div>';
    }).join('');

    // Duplicate account clusters
    var dups = res.duplicates || [];
    var dupHtml = dups.length ? dups.map(function (d) {
      return '<div style="padding:.55rem 0;border-bottom:.5px solid var(--border)">' +
          '<div style="font-size:.72rem;color:var(--muted);margin-bottom:.25rem">' + (d.type === 'IP' ? '🌐 ' : '📱 ') + escHtmlA(d.key) + ' · ' + d.count + ' accounts</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:.35rem">' +
            d.users.map(function (u) {
              return '<button onclick="openUserDetailModal(\'' + u.id + '\')" style="padding:.25rem .6rem;background:var(--bg3);border:1px solid var(--border);border-radius:999px;font-size:.72rem;font-weight:700;color:var(--text);cursor:pointer;font-family:inherit">@' + escHtmlA(u.nickname) + '</button>';
            }).join('') +
          '</div>' +
        '</div>';
    }).join('') : '<div style="font-size:.78rem;color:var(--muted);padding:.5rem 0">No shared devices/IPs detected 👍</div>';

    p.innerHTML =
      '<div class="admin-card"><div class="admin-card-title">🟢 Right now</div>' +
        '<div style="display:flex">' +
          stat(res.online_now, 'Online', '#16A34A') +
          stat(res.active_sessions, 'Sessions') +
          stat(res.total_users, 'Total users') +
        '</div>' +
        (function () {
          var list = res.online_users || [];
          if (!list.length) return '<div style="font-size:.72rem;color:var(--muted);text-align:center;margin-top:.6rem">Nobody is active in the last minute.</div>';
          return '<div style="display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.75rem;padding-top:.75rem;border-top:.5px solid var(--border)">' +
            list.map(function (u) {
              return '<button onclick="openUserDetailModal(\'' + u.id + '\')" style="display:flex;align-items:center;gap:.35rem;padding:.3rem .6rem .3rem .35rem;background:var(--bg3);border:1px solid var(--border);border-radius:999px;cursor:pointer;font-family:inherit">' +
                (u.photo_url
                  ? '<span style="width:22px;height:22px;border-radius:50%;background-image:url(' + u.photo_url + ');background-size:cover;flex-shrink:0"></span>'
                  : '<span style="width:22px;height:22px;border-radius:50%;background:#16A34A;color:#fff;display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:700;flex-shrink:0">' + (u.nickname || 'U').slice(0,1).toUpperCase() + '</span>') +
                '<span style="font-size:.75rem;font-weight:600;color:var(--text)">@' + escHtmlA(u.nickname) + '</span>' +
              '</button>';
            }).join('') +
          '</div>';
        })() +
      '</div>' +
      '<div class="admin-card"><div class="admin-card-title">📅 Today</div>' +
        '<div style="display:flex">' +
          stat(res.today.users, 'New users', '#185FA5') +
          stat(res.today.messages, 'Messages') +
          stat(res.today.shorts, 'Shorts') +
        '</div>' +
      '</div>' +
      '<div class="admin-card"><div class="admin-card-title">📈 New users (14 days)</div>' +
        '<div style="display:flex;align-items:flex-end;gap:2px;height:90px;padding-top:.5rem">' + bars + '</div>' +
      '</div>' +
      '<div class="admin-card"><div class="admin-card-title">👥 Possible duplicate accounts</div>' +
        '<div style="font-size:.68rem;color:var(--muted);margin-bottom:.4rem">Accounts sharing the same IP or device. Tap a name to inspect.</div>' +
        dupHtml +
      '</div>';
  }).catch(function (err) {
    var p = document.getElementById('now-panel');
    if (p) p.innerHTML = '<div class="admin-card" style="color:var(--red)">Could not load: ' + escHtmlA(err.message) + '</div>';
  });
}

/* ══════════════════════════════════
   FEATURES — global on/off toggles
══════════════════════════════════ */
var FEATURE_FLAGS = [
  { key:'feat_shorts',  label:'Shorts',      desc:'The Shorts tab and video feed',          icon:'🎬' },
  { key:'feat_music',   label:'Music',       desc:'The Music tab and player',               icon:'🎵' },
  { key:'feat_status',  label:'Status',      desc:'Status / stories posting and viewing',   icon:'⭐' },
  { key:'feat_channels',label:'Channels',    desc:'The Channels / explore tab',             icon:'📡' },
  { key:'feat_guest',   label:'Guest mode',  desc:'Let people browse without an account',   icon:'👤' },
];

function buildFeaturesPanel(content) {
  content.innerHTML = '<div class="admin-panel" id="features-panel"><div class="admin-card" style="text-align:center;padding:2rem"><div class="spinner"></div></div></div>';
  api.get('/settings').then(function (res) {
    var s = res.settings || {};
    var p = document.getElementById('features-panel');
    if (!p) return;
    var rows = FEATURE_FLAGS.map(function (f) {
      // Default ON unless explicitly set to 'off'
      var on = s[f.key] !== 'off';
      var allow = s[f.key + '_allow'] || '';
      return '<div style="padding:.85rem 0;border-bottom:.5px solid var(--border)">' +
          '<div style="display:flex;align-items:center;gap:.75rem">' +
            '<div style="font-size:1.4rem">' + f.icon + '</div>' +
            '<div style="flex:1"><div style="font-size:.9rem;font-weight:700">' + f.label + '</div>' +
            '<div style="font-size:.72rem;color:var(--muted)">' + f.desc + '</div></div>' +
            '<button id="ff-' + f.key + '" onclick="toggleFeature(\'' + f.key + '\',' + (on ? 'false' : 'true') + ',this)" ' +
              'style="width:52px;height:30px;border-radius:999px;border:none;cursor:pointer;position:relative;transition:background .15s;background:' + (on ? '#16A34A' : '#9AA0A6') + '">' +
              '<span style="position:absolute;top:3px;left:' + (on ? '25px' : '3px') + ';width:24px;height:24px;border-radius:50%;background:#fff;transition:left .15s"></span>' +
            '</button>' +
          '</div>' +
          // Exception list — only meaningful while the feature is OFF.
          '<div style="margin-top:.55rem;' + (on ? 'display:none' : '') + '" id="ffx-' + f.key + '">' +
            '<div style="font-size:.68rem;color:var(--muted);margin-bottom:.3rem">👁 Who can still see it (nicknames or emails, comma-separated). Leave empty = nobody.</div>' +
            '<div style="display:flex;gap:.4rem">' +
              '<input id="ffa-' + f.key + '" value="' + escHtmlA(allow) + '" placeholder="e.g. Ahron, moshe@mail.com" ' +
                'style="flex:1;padding:.5rem;border:1px solid var(--border);border-radius:10px;background:var(--bg3);color:var(--text);font-family:inherit;font-size:.8rem">' +
              '<button onclick="saveFeatureAllow(\'' + f.key + '\')" style="padding:.5rem .9rem;border:none;border-radius:10px;background:#1F6F5C;color:#fff;font-weight:700;font-size:.78rem;cursor:pointer;font-family:inherit">Save</button>' +
            '</div>' +
          '</div>' +
        '</div>';
    }).join('');
    p.innerHTML =
      '<div class="admin-card">' +
        '<div class="admin-card-title">🎛️ Feature toggles</div>' +
        '<div style="font-size:.72rem;color:var(--muted);margin-bottom:.5rem">Turn a section off for the whole app. Off = the tab disappears from the bottom nav for <b>everyone</b> — including you and the admins — and its page is blocked. Turn it back on anytime. While it\'s off you can list specific people who may still see it.</div>' +
        rows +
      '</div>' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">🛡️ Auto-moderation</div>' +
        '<div style="font-size:.72rem;color:var(--muted);margin-bottom:.6rem">Automatically hide a message once this many <b>different</b> people report it. Hiding is reversible — admins still see it. Set 0 to turn off.</div>' +
        '<div style="display:flex;gap:.5rem;align-items:center">' +
          '<span style="font-size:.82rem">Hide after</span>' +
          '<input id="automod-threshold" type="number" min="0" value="' + (parseInt(s.automod_threshold, 10) || 0) + '" style="width:70px;padding:.5rem;border:1px solid var(--border);border-radius:10px;background:var(--bg3);color:var(--text);font-family:inherit;font-size:.9rem;text-align:center">' +
          '<span style="font-size:.82rem">reports</span>' +
          '<button onclick="saveAutomod()" style="margin-left:auto;padding:.5rem 1rem;border:none;border-radius:10px;background:#1F6F5C;color:#fff;font-weight:700;font-size:.8rem;cursor:pointer;font-family:inherit">Save</button>' +
        '</div>' +
      '</div>' +
      '<div class="admin-card">' +
        '<div class="admin-card-title">⚡ Performance</div>' +
        '<div style="font-size:.72rem;color:var(--muted);margin-bottom:.6rem">Adds database indexes so the app stays fast as it grows to thousands of users. Safe to run anytime — it only adds what\'s missing.</div>' +
        '<div id="opt-status" style="font-size:.75rem;color:var(--muted);margin-bottom:.6rem"></div>' +
        '<button onclick="runOptimize(this)" style="width:100%;padding:.65rem;border:none;border-radius:10px;background:#185FA5;color:#fff;font-weight:800;font-size:.82rem;cursor:pointer;font-family:inherit">⚡ Optimize database</button>' +
      '</div>';

    // Show current index count
    api.get('/admin/optimize').then(function (r) {
      var st = document.getElementById('opt-status');
      if (st) st.textContent = '📊 ' + ((r.indexes || []).length) + ' performance indexes currently active.';
    }).catch(function () {});
  }).catch(function (err) {
    var p = document.getElementById('features-panel');
    if (p) p.innerHTML = '<div class="admin-card" style="color:var(--red)">Could not load: ' + escHtmlA(err.message) + '</div>';
  });
}

window.saveFeatureAllow = function (key) {
  var el = document.getElementById('ffa-' + key);
  if (!el) return;
  // Tidy the list: trim, drop blanks, de-duplicate.
  var seen = {}, list = [];
  el.value.split(',').forEach(function (n) {
    var v = n.trim();
    if (!v || seen[v.toLowerCase()]) return;
    seen[v.toLowerCase()] = 1;
    list.push(v);
  });
  var val = list.join(', ');
  api.put('/settings', { key: key + '_allow', value: val })
    .then(function () {
      if (STATE.settings) STATE.settings[key + '_allow'] = val;
      el.value = val;
      toast(list.length ? '👁 ' + list.length + ' can still see it' : 'Nobody can see it while off');
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.toggleFeature = function (key, turnOn, btn) {
  api.put('/settings', { key: key, value: turnOn ? 'on' : 'off' })
    .then(function () {
      toast(turnOn ? '✅ Enabled' : '🚫 Disabled');
      // The value has to go into STATE.settings too. saveSetting() does this;
      // a direct put doesn't — and the rebuild below draws from STATE.settings,
      // so the toggle would flip straight back to where it was. It saved fine;
      // the panel just redrew from a copy that never heard about it.
      if (STATE.settings) STATE.settings[key] = turnOn ? 'on' : 'off';
      buildFeaturesPanel(document.getElementById('admin-content'));
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.saveAutomod = function () {
  var v = Math.max(0, parseInt(document.getElementById('automod-threshold').value, 10) || 0);
  api.put('/settings', { key: 'automod_threshold', value: String(v) })
    .then(function () {
      if (STATE.settings) STATE.settings.automod_threshold = String(v);
      toast(v > 0 ? '🛡️ Auto-hide after ' + v + ' reports' : 'Auto-moderation off');
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.runOptimize = function (btn) {
  if (btn) { btn.disabled = true; btn.textContent = '⚡ Optimizing…'; }
  api.post('/admin/optimize', {})
    .then(function (r) {
      toast('⚡ ' + r.created + ' indexes ready');
      var st = document.getElementById('opt-status');
      if (st) st.textContent = '✅ ' + r.created + ' indexes active' + (r.skipped ? ' (' + r.skipped + ' skipped — columns not present)' : '') + '. The app is now optimized for scale.';
      if (btn) { btn.disabled = false; btn.textContent = '⚡ Optimize database'; }
    })
    .catch(function (err) {
      toast('❌ ' + err.message);
      if (btn) { btn.disabled = false; btn.textContent = '⚡ Optimize database'; }
    });
};

/* ══════════════════════════════════
   INVITE CODES  (owner only)
══════════════════════════════════ */
function buildInviteCodesPanel(content) {
  content.innerHTML = '<div class="admin-panel" id="inv-panel"><div class="admin-card" style="text-align:center;padding:2rem"><div class="spinner"></div></div></div>';
  _loadInvites();
}
function _loadInvites() {
  api.get('/admin/invite-codes').then(function (res) {
    var p = document.getElementById('inv-panel');
    if (!p) return;
    var codes = res.codes || [];
    var rows = codes.length ? codes.map(function (c) {
      var expired = c.expires_at && new Date(c.expires_at) < new Date();
      var dead = expired || (c.uses_left != null && c.uses_left <= 0);
      return '<div style="display:flex;align-items:center;gap:.6rem;padding:.6rem 0;border-bottom:.5px solid var(--border);opacity:' + (dead ? '.5' : '1') + '">' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:1rem;font-weight:800;letter-spacing:.08em;font-family:monospace">' + escHtmlA(c.code) + '</div>' +
            '<div style="font-size:.68rem;color:var(--muted)">' +
              (c.used_count || 0) + '/' + (c.max_uses || 1) + ' used' +
              (c.expires_at ? ' · ' + (expired ? 'expired' : 'expires ' + c.expires_at.slice(0,10)) : ' · no expiry') +
              (c.note ? ' · ' + escHtmlA(c.note) : '') +
            '</div>' +
          '</div>' +
          '<button onclick="copyInvite(\'' + escAttrA(c.code) + '\')" style="padding:.35rem .6rem;background:var(--bg3);border:1px solid var(--border);border-radius:8px;font-size:.72rem;font-weight:700;color:var(--text);cursor:pointer;font-family:inherit">Copy link</button>' +
          '<button onclick="revokeInvite(\'' + escAttrA(c.code) + '\')" style="padding:.35rem .6rem;background:none;border:1px solid #E5989B;border-radius:8px;font-size:.72rem;font-weight:700;color:#D32F2F;cursor:pointer;font-family:inherit">✕</button>' +
        '</div>';
    }).join('') : '<div style="font-size:.8rem;color:var(--muted);padding:.5rem 0">No invite codes yet.</div>';

    p.innerHTML =
      '<div class="admin-card">' +
        '<div class="admin-card-title">🎟️ Generate an invite</div>' +
        '<div style="font-size:.72rem;color:var(--muted);margin-bottom:.6rem">A code lets someone sign up even while sign-in is locked. Share the code or the copied link.</div>' +
        '<div style="display:flex;gap:.5rem;margin-bottom:.5rem">' +
          '<input id="inv-uses" type="number" min="1" value="1" placeholder="Uses" style="width:80px;padding:.55rem;border:1px solid var(--border);border-radius:10px;background:var(--bg3);color:var(--text);font-family:inherit;font-size:.85rem">' +
          '<input id="inv-days" type="number" min="0" value="30" placeholder="Days (0=never)" style="flex:1;padding:.55rem;border:1px solid var(--border);border-radius:10px;background:var(--bg3);color:var(--text);font-family:inherit;font-size:.85rem">' +
        '</div>' +
        '<input id="inv-note" type="text" placeholder="Note (optional)" style="width:100%;padding:.55rem;border:1px solid var(--border);border-radius:10px;background:var(--bg3);color:var(--text);font-family:inherit;font-size:.85rem;margin-bottom:.6rem;box-sizing:border-box">' +
        '<button onclick="genInvite()" style="width:100%;padding:.65rem;border:none;border-radius:10px;background:#1F6F5C;color:#fff;font-weight:800;font-size:.82rem;cursor:pointer;font-family:inherit">Generate code</button>' +
      '</div>' +
      '<div class="admin-card"><div class="admin-card-title">🎫 Active codes (' + codes.length + ')</div>' + rows + '</div>';
  }).catch(function (err) {
    var p = document.getElementById('inv-panel');
    if (p) p.innerHTML = '<div class="admin-card" style="color:var(--red)">Could not load: ' + escHtmlA(err.message) + '</div>';
  });
}
window.genInvite = function () {
  var uses = parseInt(document.getElementById('inv-uses').value, 10) || 1;
  var days = parseInt(document.getElementById('inv-days').value, 10) || 0;
  var note = document.getElementById('inv-note').value || '';
  api.post('/admin/invite-codes', { max_uses: uses, expires_days: days, note: note })
    .then(function (res) { toast('🎟️ Code: ' + res.code); _loadInvites(); })
    .catch(function (err) { toast('❌ ' + err.message); });
};
window.copyInvite = function (code) {
  var link = location.origin + '/?invite=' + code;
  if (navigator.clipboard) navigator.clipboard.writeText(link);
  toast('📋 Copied: ' + link);
};
window.revokeInvite = function (code) {
  ypConfirm('Revoke code ' + code + '?', { danger: true }).then(function (ok) {
    if (!ok) return;
    api.del('/admin/invite-codes?code=' + encodeURIComponent(code))
      .then(function () { toast('Revoked'); _loadInvites(); })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
};

/* ══════════════════════════════════
   VERIFY REQUESTS
══════════════════════════════════ */
function buildVerifyRequestsPanel(content) {
  content.innerHTML = '<div class="admin-panel" id="vr-panel"><div class="admin-card" style="text-align:center;padding:2rem"><div class="spinner"></div></div></div>';
  _loadVerifyRequests();
}
function _loadVerifyRequests() {
  api.get('/verify-request').then(function (res) {
    var p = document.getElementById('vr-panel');
    if (!p) return;
    var reqs = res.requests || [];
    var rows = reqs.length ? reqs.map(function (r) {
      return '<div style="display:flex;align-items:center;gap:.65rem;padding:.7rem 0;border-bottom:.5px solid var(--border)">' +
          (r.photo_url
            ? '<div style="width:42px;height:42px;border-radius:50%;background-image:url(' + r.photo_url + ');background-size:cover;flex-shrink:0"></div>'
            : '<div style="width:42px;height:42px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0">' + (r.nickname||'U').slice(0,1).toUpperCase() + '</div>') +
          '<div style="flex:1;min-width:0" onclick="openUserDetailModal(\'' + r.user_id + '\')">' +
            '<div style="font-size:.88rem;font-weight:700;cursor:pointer">@' + escHtmlA(r.nickname) + '</div>' +
            (r.note ? '<div style="font-size:.7rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtmlA(r.note) + '</div>' : '') +
          '</div>' +
          '<button onclick="decideVerify(\'' + r.id + '\',\'approve\',this)" style="padding:.4rem .8rem;background:#16A34A;color:#fff;border:none;border-radius:8px;font-size:.74rem;font-weight:700;cursor:pointer;font-family:inherit">Approve</button>' +
          '<button onclick="decideVerify(\'' + r.id + '\',\'deny\',this)" style="padding:.4rem .7rem;background:none;border:1px solid var(--border);border-radius:8px;font-size:.74rem;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit">Deny</button>' +
        '</div>';
    }).join('') : '<div style="font-size:.82rem;color:var(--muted);padding:.5rem 0;text-align:center">No pending requests 👍</div>';

    p.innerHTML = '<div class="admin-card"><div class="admin-card-title">✅ Verification requests (' + reqs.length + ')</div>' + rows + '</div>';
  }).catch(function (err) {
    var p = document.getElementById('vr-panel');
    if (p) p.innerHTML = '<div class="admin-card" style="color:var(--red)">Could not load: ' + escHtmlA(err.message) + '</div>';
  });
}
window.decideVerify = function (id, action, btn) {
  api.put('/verify-request', { id: id, action: action })
    .then(function () {
      toast(action === 'approve' ? '✅ Verified' : 'Denied');
      var row = btn.closest('div[style*="border-bottom"]');
      if (row && row.parentElement) row.parentElement.removeChild(row);
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

// Owner-only: zero out all view counts.
window.resetAllViews = function () {
  if (!confirm('Reset ALL short and post view counts to 0? This cannot be undone.')) return;
  var el = document.getElementById('reset-views-status');
  if (el) { el.style.color = 'var(--muted)'; el.textContent = 'Resetting…'; }
  api.post('/admin/reset-views', {})
    .then(function (res) {
      if (res && res.ok) {
        if (el) { el.style.color = '#16A34A'; el.textContent = '✓ Done — ' + (res.shorts_reset || 0) + ' shorts, ' + (res.posts_reset || 0) + ' posts reset to 0.'; }
      } else {
        if (el) { el.style.color = '#DC2626'; el.textContent = (res && res.error) || 'Failed'; }
      }
    })
    .catch(function (e) {
      if (el) { el.style.color = '#DC2626'; el.textContent = 'Error: ' + (e && e.message ? e.message : 'failed'); }
    });
};

// ── Statuses moderation (see & remove anyone's status) ──
function buildStatusesModPanel(content) {
  content.innerHTML = '<div class="admin-panel"><div style="text-align:center;color:var(--muted);padding:2rem;font-size:.85rem">Loading statuses…</div></div>';
  api.get('/admin/statuses').then(function (res) {
    var list = (res && res.statuses) || [];
    if (!list.length) {
      content.innerHTML = '<div class="admin-panel"><div class="admin-card"><div class="admin-card-title">📸 Statuses</div><div style="color:var(--muted);font-size:.85rem;text-align:center;padding:1.5rem">No active statuses right now.</div></div></div>';
      return;
    }
    var cards = list.map(function (s) {
      var nick = escHtmlA(s.nickname || 'User');
      var when = s.created_at ? timeAgo(s.created_at) : '';
      var preview;
      if (s.type === 'text' || !s.media_url) {
        preview = '<div style="flex:1;min-width:0;padding:.5rem .7rem;background:' + (s.bg || '#1a0a2e') + ';color:' + (s.color || '#fff') + ';border-radius:10px;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" dir="auto">' + escHtmlA(s.text || '(text)') + '</div>';
      } else if (s.type === 'video') {
        preview = '<div style="flex:1;display:flex;align-items:center;gap:.4rem;color:var(--muted);font-size:.82rem"><span style="font-size:1.2rem">🎬</span> Video status' + (s.text ? ' — ' + escHtmlA(s.text) : '') + '</div>';
      } else {
        preview = '<img src="' + s.media_url + '" style="width:46px;height:46px;border-radius:10px;object-fit:cover;flex-shrink:0"><div style="flex:1;min-width:0;font-size:.82rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtmlA(s.text || 'Photo status') + '</div>';
      }
      var priv = s.privacy && s.privacy !== 'public' ? ' · 🔒 ' + escHtmlA(s.privacy) : '';
      return '<div class="admin-card" style="display:flex;flex-direction:column;gap:.55rem">' +
          '<div style="display:flex;align-items:center;gap:.5rem">' +
            '<div style="font-weight:700;font-size:.88rem">@' + nick + (s.verified ? ' ✔️' : '') + '</div>' +
            '<div style="font-size:.72rem;color:var(--muted)">' + when + ' · 👁 ' + fmtN(s.views || 0) + priv + '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:.6rem">' + preview + '</div>' +
          '<button class="save-pill" style="background:#DC2626" onclick="adminDeleteStatus(\'' + s.id + '\',\'' + nick + '\')">🗑 Delete for everyone</button>' +
        '</div>';
    }).join('');
    content.innerHTML = '<div class="admin-panel">' +
      '<div style="font-size:.78rem;color:var(--muted);padding:0 .25rem .5rem">' + list.length + ' active status' + (list.length === 1 ? '' : 'es') + ' (last 24h). Deleting removes it for everyone, including the person who posted it.</div>' +
      cards + '</div>';
  }).catch(function (e) {
    content.innerHTML = '<div class="admin-panel"><div class="admin-card" style="color:#DC2626">Failed to load: ' + escHtmlA((e && e.message) || 'error') + '</div></div>';
  });
}

window.adminDeleteStatus = function (id, nick) {
  if (!confirm('Delete @' + nick + "'s status for everyone? This cannot be undone.")) return;
  api.put('/statuses', { action: 'delete', id: id }).then(function (res) {
    if (res && res.ok) {
      toast('🗑 Status deleted.');
      buildStatusesModPanel(document.getElementById('admin-content'));
    } else {
      toast((res && res.error) || 'Failed');
    }
  }).catch(function () { toast('Failed to delete'); });
};

// ── Telegram channel session (re-login) handlers ──
function _tgSessSecret() { var el = document.getElementById('tg-sess-secret'); return el ? el.value.trim() : ''; }
function _tgSessSay(msg, ok) {
  var el = document.getElementById('tg-sess-status');
  if (el) { el.style.color = ok === true ? '#16A34A' : ok === false ? '#DC2626' : 'var(--text)'; el.innerHTML = msg; }
}
function _tgSessCall(step, extra, btn) {
  var secret = _tgSessSecret();
  if (!secret) { _tgSessSay('Enter the worker admin secret first.', false); return Promise.resolve(); }
  var payload = Object.assign({ step: step, secret: secret }, extra || {});
  var label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Working…'; }
  return api.post('/admin/tg-login', payload).then(function (res) {
    if (btn) { btn.disabled = false; btn.textContent = label; }
    var r = res && res.result;
    if (r && r.logged_in) {
      _tgSessSay('✅ Logged in as ' + (r.as || r.user || 'the account') + '. New posts should start flowing again shortly.', true);
    } else if (r && r.sent) {
      _tgSessSay('✅ Code sent! Check your <strong>Telegram app</strong> (a message from "Telegram") — it usually is NOT an SMS. Enter it in Step 2.', true);
    } else if (r && r.needs_password) {
      _tgSessSay('🔒 Two-step is on — enter your password in Step 3.', true);
    } else if (r && r.ok) {
      _tgSessSay('✅ ' + (r.message || r.next || 'Done — continue to the next step.'), true);
    } else {
      // Surface the entire worker response so we can see exactly what's wrong.
      var dbg = '';
      try { dbg = JSON.stringify(res && res.result ? res.result : res); } catch (e) { dbg = String(res); }
      _tgSessSay('⚠️ Worker said: <code style="font-size:.7rem;word-break:break-all">' + escHtmlA(dbg) + '</code>', false);
    }
    return res;
  }).catch(function (e) {
    if (btn) { btn.disabled = false; btn.textContent = label; }
    _tgSessSay('⚠️ ' + ((e && e.message) || 'Request failed'), false);
  });
}
window.tgSessCheck    = function (btn) { _tgSessSay('Checking…'); _tgSessCall('status', {}, btn); };
window.tgSessLogin    = function (btn) { var p = document.getElementById('tg-sess-phone'); _tgSessCall('login', { phone: p ? p.value.trim() : '' }, btn); };
window.tgSessCode     = function (btn) { var c = document.getElementById('tg-sess-code'); _tgSessCall('code', { code: c ? c.value.trim() : '' }, btn); };
window.tgSessPassword = function (btn) { var w = document.getElementById('tg-sess-pw'); _tgSessCall('password', { password: w ? w.value : '' }, btn); };

// ── Bot → email forwarding config ──
(function () {
  var _origBuildTg = window.buildTelegramPanel;
})();
window.bmailLoad = function () {
  api.get('/admin/bot-email').then(function (res) {
    if (!res || !res.ok) return;
    var en = document.getElementById('bmail-enabled');
    var rc = document.getElementById('bmail-recipients');
    if (en) en.checked = !!res.enabled;
    if (rc) rc.value = (res.recipients || []).join('\n');
  }).catch(function () {});
};
window.bmailSave = function (btn) {
  var en = (document.getElementById('bmail-enabled') || {}).checked ? true : false;
  var rc = (document.getElementById('bmail-recipients') || {}).value || '';
  var st = document.getElementById('bmail-status');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  api.post('/admin/bot-email', { enabled: en, recipients: rc }).then(function (res) {
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    if (res && res.ok) {
      if (st) { st.style.color = '#16A34A'; st.textContent = '✓ Saved — ' + (res.recipients || []).length + ' recipient(s).'; }
      var rcEl = document.getElementById('bmail-recipients'); if (rcEl) rcEl.value = (res.recipients || []).join('\n');
    } else if (st) { st.style.color = '#DC2626'; st.textContent = (res && res.error) || 'Failed'; }
  }).catch(function (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    if (st) { st.style.color = '#DC2626'; st.textContent = (e && e.message) || 'Failed'; }
  });
};

// ── Private bot connect / status ──
window.pbotLoad = function () {
  var st = document.getElementById('pbot-status');
  api.get('/admin/private-bot-setup').then(function (res) {
    if (!st) return;
    if (!res || !res.ok) { st.style.color = '#DC2626'; st.textContent = (res && res.error) || 'Could not check.'; return; }
    if (!res.has_token) { st.style.color = 'var(--muted)'; st.innerHTML = '⚠️ No <code>PRIVATE_BOT_TOKEN</code> set in Cloudflare yet — do the setup steps above.'; return; }
    if (!res.has_secret) { st.style.color = 'var(--muted)'; st.innerHTML = '⚠️ No <code>PRIVATE_BOT_WEBHOOK_SECRET</code> set in Cloudflare yet.'; return; }
    if (res.connected) { st.style.color = '#16A34A'; st.innerHTML = '✅ Connected' + (res.bot ? ' — ' + res.bot : '') + '. Post to your bot and it emails the recipients below.'; }
    else { st.style.color = 'var(--muted)'; st.innerHTML = 'Bot ' + (res.bot || '') + ' found, but not connected yet — press Connect bot.'; }
  }).catch(function () { if (st) { st.style.color = '#DC2626'; st.textContent = 'Could not check.'; } });
};
window.pbotConnect = function (btn) {
  var st = document.getElementById('pbot-status');
  if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }
  api.post('/admin/private-bot-setup', {}).then(function (res) {
    if (btn) { btn.disabled = false; btn.textContent = '🔌 Connect bot'; }
    if (res && res.ok) { if (st) { st.style.color = '#16A34A'; st.innerHTML = '✅ Connected! Post to your bot to test.'; } }
    else if (st) { st.style.color = '#DC2626'; st.textContent = (res && res.error) || 'Failed'; }
  }).catch(function (e) {
    if (btn) { btn.disabled = false; btn.textContent = '🔌 Connect bot'; }
    if (st) { st.style.color = '#DC2626'; st.textContent = (e && e.message) || 'Failed'; }
  });
};
