// ============================================================
// js/theme.js — Settings + Theme system for YID PLUS
// ============================================================

var THEME_KEY = 'yp_theme';

var THEME_PRESETS = [
  { name: 'Gold',        gold: '#B8860B', goldL: '#DAA520', bg: '#FFFFFF', bg2: '#F5F5F5', text: '#000000' },
  { name: 'Royal Blue',  gold: '#1565C0', goldL: '#42A5F5', bg: '#FFFFFF', bg2: '#F0F4FA', text: '#000000' },
  { name: 'Emerald',     gold: '#2E7D32', goldL: '#66BB6A', bg: '#FFFFFF', bg2: '#F0F8F0', text: '#000000' },
  { name: 'Crimson',     gold: '#C62828', goldL: '#EF5350', bg: '#FFFFFF', bg2: '#FAF0F0', text: '#000000' },
  { name: 'Violet',      gold: '#6A1B9A', goldL: '#AB47BC', bg: '#FFFFFF', bg2: '#F6F0FA', text: '#000000' },
  { name: 'Midnight',    gold: '#C9A84C', goldL: '#F0D080', bg: '#0A0A0F', bg2: '#13131A', text: '#F0EDE6' },
];

window.applyTheme = function (theme) {
  var root = document.documentElement.style;
  root.setProperty('--gold',   theme.gold);
  root.setProperty('--gold-l', theme.goldL);
  root.setProperty('--gold-d', theme.gold);
  root.setProperty('--bg',     theme.bg);
  root.setProperty('--bg2',    theme.bg2);
  root.setProperty('--text',   theme.text);
  root.setProperty('--bg3', THEME_shade(theme.bg2, theme.text, 0.06));
  root.setProperty('--bg4', THEME_shade(theme.bg2, theme.text, 0.12));
};

function THEME_shade(hex1, hex2, ratio) {
  var c1 = THEME_hexToRgb(hex1), c2 = THEME_hexToRgb(hex2);
  if (!c1 || !c2) return hex1;
  return 'rgb(' + Math.round(c1.r+(c2.r-c1.r)*ratio) + ',' + Math.round(c1.g+(c2.g-c1.g)*ratio) + ',' + Math.round(c1.b+(c2.b-c1.b)*ratio) + ')';
}

function THEME_hexToRgb(hex) {
  if (!hex) return null;
  hex = hex.replace('#','');
  if (hex.length===3) hex = hex.split('').map(function(c){return c+c;}).join('');
  var num = parseInt(hex,16);
  if (isNaN(num)) return null;
  return { r:(num>>16)&255, g:(num>>8)&255, b:num&255 };
}

window.saveTheme = function (theme) { localStorage.setItem(THEME_KEY, JSON.stringify(theme)); applyTheme(theme); };
window.loadTheme = function () {
  try { var raw = localStorage.getItem(THEME_KEY); if (raw) { var t = JSON.parse(raw); applyTheme(t); return t; } } catch(e){}
  return THEME_PRESETS[0];
};
window.resetTheme = function () {
  localStorage.removeItem(THEME_KEY);
  applyTheme(THEME_PRESETS[0]);
  buildSettingsPage();
  toast('Theme reset!');
};
window.THEME_pick = function (i) {
  saveTheme(THEME_PRESETS[i]);
  buildSettingsPage();
  toast(THEME_PRESETS[i].name + ' theme!');
};
window.THEME_custom = function () {
  var gold = (document.getElementById('theme-custom-gold') || {}).value || THEME_PRESETS[0].gold;
  var bg   = (document.getElementById('theme-custom-bg')   || {}).value || THEME_PRESETS[0].bg;
  var rgb  = THEME_hexToRgb(bg) || { r:255,g:255,b:255 };
  var isDark = (0.299*rgb.r + 0.587*rgb.g + 0.114*rgb.b)/255 < 0.5;
  saveTheme({ name:'Custom', gold:gold, goldL:gold, bg:bg, bg2:isDark?THEME_shade(bg,'#ffffff',0.06):THEME_shade(bg,'#000000',0.04), text:isDark?'#F0EDE6':'#000000' });
};

// ── DARK MODE ──
window.toggleDarkMode = function (el) {
  var isDark = document.documentElement.classList.toggle('dark-mode');
  try { localStorage.setItem('yp_dark_mode', isDark ? '1' : '0'); } catch(e){}
  if (el) el.classList.toggle('on', isDark);
  var sw = document.getElementById('darkmode-toggle-sw');
  if (sw) sw.classList.toggle('on', isDark);
  toast(isDark ? '🌙 Dark mode' : '☀️ Light mode');
};

// ── MAIN SETTINGS PAGE BUILDER ──
var SETTINGS_DATA = null;

window.buildSettingsPage = function () {
  var host = document.getElementById('theme-picker-host');
  var body = document.getElementById('settings-body');
  if (!host) return;

  // Load profile data first
  api.get('/profile').then(function (res) {
    SETTINGS_DATA = res;
    var p = res.profile || {};
    var stats = res.stats || {};
    var sessions = res.sessions || [];

    // Update profile header
    var nickEl = document.getElementById('settings-nick');
    var emailEl = document.getElementById('settings-email');
    var avatarEl = document.getElementById('settings-avatar');
    if (nickEl) nickEl.textContent = '@' + (p.nickname || 'User');
    if (emailEl) emailEl.textContent = p.email || '';
    if (avatarEl) {
      if (p.photo_url) {
        avatarEl.style.backgroundImage = 'url(' + p.photo_url + ')';
        avatarEl.style.backgroundSize = 'cover';
        avatarEl.style.backgroundPosition = 'center';
        avatarEl.innerHTML = '<div class="avatar-edit-btn" onclick="triggerAvatarUpload()"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></div>';
      } else {
        avatarEl.innerHTML = '<div style="font-size:2rem;color:var(--muted)">' + (p.nickname||'U').slice(0,1).toUpperCase() + '</div><div class="avatar-edit-btn" onclick="triggerAvatarUpload()"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></div>';
      }
    }

    var current = (function() { try { return JSON.parse(localStorage.getItem(THEME_KEY)||'null'); } catch(e){return null;} })();
    var swatches = THEME_PRESETS.map(function(t,i) {
      var isActive = current ? (current.gold===t.gold && current.bg===t.bg) : (i===0);
      return '<div class="theme-swatch' + (isActive?' active':'') + '" style="background:' + t.gold + '" title="' + t.name + '" onclick="THEME_pick(' + i + ')"></div>';
    }).join('');
    var isDarkNow = document.documentElement.classList.contains('dark-mode');

    host.innerHTML = _section('Appearance', [
      _row(_svg_sun(), 'Dark Mode', '<div class="toggle-sw' + (isDarkNow?' on':'') + '" id="darkmode-toggle-sw" onclick="toggleDarkMode(this)"></div>'),
      _row(_svg_text(), 'Text Size', '<div style="display:flex;gap:.35rem">' +
        ['S','M','L'].map(function(s,i){return '<button class="cs-font-btn' + (i===1?' active':'') + '" onclick="setChatFont(\'' + ['sm','md','lg'][i] + '\',this)">' + s + '</button>';}).join('') +
      '</div>'),
    ]) +
    _section('Color Theme', [
      '<div class="theme-swatch-row">' + swatches + '</div>',
      _row('', 'Accent color', '<input type="color" id="theme-custom-gold" value="' + ((current&&current.gold)||THEME_PRESETS[0].gold) + '" oninput="THEME_custom()">'),
      _row('', 'Background', '<input type="color" id="theme-custom-bg" value="' + ((current&&current.bg)||THEME_PRESETS[0].bg) + '" oninput="THEME_custom()">'),
      '<button class="theme-reset-btn" onclick="resetTheme()">Reset to Default</button>',
    ]) +
    _section('Stats', [
      _statRow('📹', 'Videos', stats.shorts || 0),
      _statRow('🎵', 'Music Tracks', stats.music || 0),
      _statRow('💬', 'Messages', stats.messages || 0),
      _statRow('👁️', 'Profile Views', stats.profile_views || 0),
      _statRow('👥', 'Followers', stats.followers || 0),
    ]) +
    _section('Profile', [
      _row(_svg_bio(), 'Bio', '<button class="settings-edit-btn" onclick="openEditField(\'bio\',\'Bio\',\'' + escHtml(p.bio||'') + '\')">Edit</button>'),
      _row(_svg_loc(), 'Location', '<button class="settings-edit-btn" onclick="openEditField(\'location\',\'Location\',\'' + escHtml(p.location||'') + '\')">Edit</button>'),
      _row(_svg_bday(), 'Birthday', '<button class="settings-edit-btn" onclick="openEditField(\'birthday\',\'Birthday\',\'' + escHtml(p.birthday||'') + '\',\'date\')">Edit</button>'),
      _row(_svg_web(), 'Website', '<button class="settings-edit-btn" onclick="openEditField(\'website\',\'Website\',\'' + escHtml(p.website||'') + '\',\'url\')">Edit</button>'),
      _row('📸', 'Instagram', '<button class="settings-edit-btn" onclick="openEditField(\'instagram\',\'Instagram\',\'' + escHtml(p.instagram||'') + '\')">Edit</button>'),
      _row('▶️', 'YouTube', '<button class="settings-edit-btn" onclick="openEditField(\'youtube\',\'YouTube\',\'' + escHtml(p.youtube||'') + '\',\'url\')">Edit</button>'),
      _row(_svg_key(), 'Change Password', '<button class="settings-edit-btn" onclick="openChangePassword()">Change</button>'),
    ]) +
    _section('Privacy', [
      _row('🔒', 'Private Account', _toggle('is_private', !!p.is_private) + '<div style="font-size:.68rem;color:var(--muted);margin-top:.2rem">When ON, people must request to follow you before seeing your posts and statuses.</div>'),
      _row('👥', 'Follow Requests', '<button class="settings-edit-btn" onclick="openFollowRequests()" id="follow-req-btn">View</button>'),
      _row(_svg_privacy(), 'Who can see my profile', _select('privacy_profile', p.privacy_profile||'public', ['public:Everyone','friends:Friends only','private:Only me'])),
      _row(_svg_msg(), 'Who can message me', _select('privacy_messages', p.privacy_messages||'everyone', ['everyone:Everyone','friends:Friends only','nobody:Nobody'])),
    ]) +
    _section('Notifications', [
      _row(_svg_notif(), 'New Messages', _toggle('notif_messages', p.notif_messages!==0)),
      _row('❤️', 'New Likes', _toggle('notif_likes', p.notif_likes!==0)),
      _row('👤', 'New Followers', _toggle('notif_followers', p.notif_followers!==0)),
      _row('📡', 'Channel Updates', _toggle('notif_channels', p.notif_channels!==0)),
    ]) +
    _section('Devices (' + sessions.length + ' active)', [
      sessions.slice(0,5).map(function(s,i) {
        var isThis = i === 0;
        return _row(_svg_device(), 'Session ' + (isThis ? '(This device)' : (i+1)), isThis
          ? '<span style="font-size:.7rem;color:var(--green)">Active</span>'
          : '<button class="settings-edit-btn" style="color:#E11D48" onclick="logoutSession(\'' + s.id + '\')">Logout</button>');
      }).join('') +
      (sessions.length > 1 ? '<button class="theme-reset-btn" style="color:#E11D48;border-color:#FFCDD2;margin-top:.5rem" onclick="logoutAllSessions()">Logout All Devices</button>' : ''),
    ]) +
    _section('Share Profile', [
      _row(_svg_share(), 'Share my profile', '<button class="settings-edit-btn" onclick="shareProfile()">Share</button>'),
      _row('🔗', 'Copy link', '<button class="settings-edit-btn" onclick="copyProfileLink()">Copy</button>'),
    ]) +
    _section('App', [
      _row(_svg_notif(), 'Push Notifications',
        '<div class="toggle-sw' + (typeof PWA !== 'undefined' && PWA.isPushEnabled() ? ' on' : '') + '" id="push-notif-toggle" onclick="togglePushNotifications(this)"></div>'),
      _row('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
        'Add to Home Screen', '<button class="settings-edit-btn" onclick="PWA.install()">Install</button>'),
    ]) +
    _section('More', [
      _row(_svg_admin(), 'Admin Panel', '›', 'onclick="goPage(\'/admin\')"'),
      _row(_svg_feedback(), 'Send Feedback', '›', 'onclick="openFeedbackModal()"'),
    ]) +
    '<div class="settings-danger-section">' +
      '<button class="settings-danger-btn" onclick="confirmDeleteAccount()">Delete Account</button>' +
    '</div>';

    if (body) body.innerHTML = '';

    _updateFollowReqBadge();

  }).catch(function () {
    // Fallback if not loaded
    if (host) host.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--muted);font-size:.85rem">Loading settings...</div>';
  });
};

// ── HELPERS ──
function _section(title, rows) {
  var content = Array.isArray(rows) ? rows.join('') : rows;
  return '<div class="settings-card">' +
    '<div class="settings-section-title">' + title + '</div>' +
    content +
  '</div>';
}

function _row(icon, label, control, extraAttrs) {
  return '<div class="settings-item-row" ' + (extraAttrs||'') + '>' +
    '<div style="display:flex;align-items:center;gap:.6rem;flex:1;min-width:0">' +
      (icon ? '<span style="color:var(--gold);flex-shrink:0;width:20px;text-align:center">' + icon + '</span>' : '') +
      '<span class="settings-item-label">' + label + '</span>' +
    '</div>' +
    '<div class="settings-item-control">' + control + '</div>' +
  '</div>';
}

function _statRow(icon, label, val) {
  return '<div class="settings-item-row">' +
    '<div style="display:flex;align-items:center;gap:.6rem;flex:1">' +
      '<span style="color:var(--gold);width:20px;text-align:center">' + icon + '</span>' +
      '<span class="settings-item-label">' + label + '</span>' +
    '</div>' +
    '<span style="font-size:.88rem;font-weight:700;color:var(--gold)">' + fmtN(val) + '</span>' +
  '</div>';
}

function _toggle(key, isOn) {
  return '<div class="toggle-sw' + (isOn?' on':'') + '" onclick="toggleSetting(\'' + key + '\',this)"></div>';
}

function _select(key, val, opts) {
  return '<select class="settings-select" onchange="saveSetting(\'' + key + '\',this.value)">' +
    opts.map(function(o) {
      var parts = o.split(':');
      return '<option value="' + parts[0] + '"' + (val===parts[0]?' selected':'') + '>' + parts[1] + '</option>';
    }).join('') +
  '</select>';
}

// SVG icons
function _svg_sun()      { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'; }
function _svg_text()     { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>'; }
function _svg_bio()      { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>'; }
function _svg_loc()      { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>'; }
function _svg_bday()     { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'; }
function _svg_web()      { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>'; }
function _svg_key()      { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>'; }
function _svg_privacy()  { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'; }
function _svg_msg()      { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'; }
function _svg_notif()    { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>'; }
function _svg_device()   { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>'; }
function _svg_share()    { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>'; }
function _svg_admin()    { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'; }
function _svg_feedback() { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'; }

// ── ACTIONS ──
window.toggleSetting = function (key, el) {
  el.classList.toggle('on');
  var val = el.classList.contains('on') ? 1 : 0;
  api.put('/profile', { [key]: val }).catch(function () { toast('Error saving'); });
};

window.saveSetting = function (key, value) {
  api.put('/profile', { [key]: value })
    .then(function () { toast('Saved!'); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.openEditField = function (key, label, current, type) {
  var modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;z-index:8000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:1.5rem';
  modal.innerHTML =
    '<div style="background:var(--surface);border-radius:16px;padding:1.25rem;width:100%;max-width:360px">' +
      '<div style="font-size:.9rem;font-weight:700;margin-bottom:.85rem">Edit ' + label + '</div>' +
      '<' + (type === 'date' || type === 'url' ? 'input type="' + (type||'text') + '"' : 'textarea rows="3" style="resize:none"') + ' id="edit-field-val" style="width:100%;box-sizing:border-box;padding:.6rem .75rem;background:var(--bg3);border:1.5px solid var(--border);border-radius:10px;color:var(--text);font-size:.88rem;font-family:inherit;outline:none;' + (type==='date'||type==='url'?'height:auto':'') + '">' +
      (type !== 'date' && type !== 'url' ? current : '') +
      (type !== 'date' && type !== 'url' ? '</textarea>' : '') +
      (type === 'date' ? '' : '') +
      '<div style="display:flex;gap:.5rem;margin-top:.75rem">' +
        '<button onclick="saveEditField(\'' + key + '\')" style="flex:1;padding:.6rem;background:var(--gold);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-family:inherit">Save</button>' +
        '<button onclick="this.closest(\'div[style*=fixed]\').remove()" style="flex:1;padding:.6rem;background:var(--bg3);border:none;border-radius:10px;cursor:pointer;font-family:inherit">Cancel</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
  modal.addEventListener('click', function(e){ if(e.target===modal) modal.remove(); });
  if (type === 'date') {
    var inp = document.getElementById('edit-field-val');
    if (inp) inp.value = current;
  }
};

window.saveEditField = function (key) {
  var val = (document.getElementById('edit-field-val') || {}).value || '';
  document.querySelector('div[style*="fixed"][style*="z-index:8000"]')?.remove();
  api.put('/profile', { [key]: val })
    .then(function () { toast('✅ Saved!'); buildSettingsPage(); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.openChangePassword = function () {
  openEditField('password', 'New Password', '', 'text');
};

window.triggerAvatarUpload = function () {
  var inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = function (e) {
    var file = e.target.files[0]; if (!file) return;
    var form = new FormData();
    form.append('photo', file);
    toast('Uploading...');
    api.post('/profile', form, true)
      .then(function () { toast('✅ Photo updated!'); buildSettingsPage(); })
      .catch(function (err) { toast('❌ ' + err.message); });
  };
  inp.click();
};

window.logoutSession = function (sessionId) {
  api.del('/auth/sessions?id=' + encodeURIComponent(sessionId))
    .then(function () { toast('Logged out!'); buildSettingsPage(); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.logoutAllSessions = function () {
  if (!confirm('Logout from all devices?')) return;
  api.del('/auth/sessions?all=1')
    .then(function () { toast('All sessions cleared!'); doLogout(); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.shareProfile = function () {
  var user = STATE.user;
  if (!user) return;
  var url = 'https://yidplus.com/@' + user.nickname;
  if (navigator.share) { navigator.share({ title: '@' + user.nickname + ' on YID PLUS', url: url }); }
  else { navigator.clipboard && navigator.clipboard.writeText(url); toast('Link copied!'); }
};

window.copyProfileLink = function () {
  var user = STATE.user;
  if (!user) return;
  var url = 'https://yidplus.com/@' + user.nickname;
  navigator.clipboard && navigator.clipboard.writeText(url);
  toast('✅ Link copied!');
};

window.confirmDeleteAccount = function () {
  if (!confirm('⚠️ Delete your account permanently? All data will be lost!')) return;
  if (!confirm('Are you 100% sure? This CANNOT be undone!')) return;
  api.del('/profile')
    .then(function () { toast('Account deleted'); doLogout(); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.togglePushNotifications = function (el) {
  if (typeof PWA === 'undefined') { toast('Not supported'); return; }
  if (PWA.isPushEnabled()) {
    PWA.disablePush();
    el.classList.remove('on');
  } else {
    PWA.requestPush().then(function () {
      if (PWA.isPushEnabled()) el.classList.add('on');
    });
  }
};

/* ══════════════════════════════════
   FOLLOW REQUESTS MODAL
══════════════════════════════════ */
window.openFollowRequests = function () {
  var modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;z-index:8000;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;justify-content:center';
  modal.innerHTML =
    '<div style="background:var(--surface);border-radius:20px 20px 0 0;width:100%;max-width:500px;max-height:75vh;display:flex;flex-direction:column">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:.85rem 1.1rem;border-bottom:1px solid var(--border)">' +
        '<div style="font-weight:700;font-size:.92rem">Follow Requests</div>' +
        '<button onclick="this.closest(\'div[style*=fixed]\').remove()" style="background:none;border:none;cursor:pointer;color:var(--muted)">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
      '</div>' +
      '<div id="follow-req-list" style="overflow-y:auto;flex:1;padding:.5rem 0"><div style="text-align:center;padding:1.5rem"><div class="spinner"></div></div></div>' +
    '</div>';
  document.body.appendChild(modal);
  modal.addEventListener('click', function(e){ if(e.target===modal) modal.remove(); });

  api.get('/follows?requests=1')
    .then(function (res) {
      var el = document.getElementById('follow-req-list');
      if (!el) return;
      var reqs = res.requests || [];
      if (!reqs.length) {
        el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--muted);font-size:.85rem">No pending requests</div>';
        return;
      }
      el.innerHTML = reqs.map(function (r) {
        var av = r.photo_url
          ? '<div style="width:44px;height:44px;border-radius:50%;background-image:url(' + r.photo_url + ');background-size:cover;flex-shrink:0"></div>'
          : '<div style="width:44px;height:44px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0">' + (r.nickname||'?').slice(0,1).toUpperCase() + '</div>';
        return '<div id="freq-' + r.id + '" style="display:flex;align-items:center;gap:.65rem;padding:.6rem 1rem">' +
          av +
          '<div style="flex:1;font-size:.85rem;font-weight:700">@' + escHtml(r.nickname||'User') + (r.verified?' ✅':'') + '</div>' +
          '<button onclick="acceptFollowRequest(\'' + r.id + '\')" style="padding:.4rem .9rem;background:var(--gold);color:#fff;border:none;border-radius:16px;font-size:.78rem;font-weight:700;cursor:pointer;font-family:inherit">Accept</button>' +
          '<button onclick="rejectFollowRequest(\'' + r.id + '\')" style="padding:.4rem .7rem;background:var(--bg3);border:1px solid var(--border);border-radius:16px;font-size:.78rem;cursor:pointer;font-family:inherit;margin-left:.3rem">✕</button>' +
        '</div>';
      }).join('');
    })
    .catch(function () {
      var el = document.getElementById('follow-req-list');
      if (el) el.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--muted)">Could not load requests</div>';
    });
};

window.acceptFollowRequest = function (requesterId) {
  api.post('/follows', { action: 'accept', requester_id: requesterId })
    .then(function () {
      toast('✅ Accepted');
      var el = document.getElementById('freq-' + requesterId);
      if (el) el.remove();
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.rejectFollowRequest = function (requesterId) {
  api.del('/follows?user_id=' + encodeURIComponent(requesterId) + '&request=1')
    .then(function () {
      toast('Rejected');
      var el = document.getElementById('freq-' + requesterId);
      if (el) el.remove();
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

// Update Follow Requests badge count on Settings load
window._updateFollowReqBadge = function () {
  api.get('/follows?requests=1', true)
    .then(function (res) {
      var count = (res.requests || []).length;
      var btn = document.getElementById('follow-req-btn');
      if (btn && count > 0) btn.textContent = 'View (' + count + ')';
    })
    .catch(function () {});
};
