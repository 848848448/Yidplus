// ================================================
// js/app.js  —  Router + Global Utilities
// No PAGE_KEY variable — uses the string 'yp_page' directly
// No imports/exports — pure window globals
// ================================================

window.APP = {
  user:       null,
  screen:     'auth',
  prevScreen: 'home',
};

// ── ROUTER ──────────────────────────────────────
window.navTo = function (screenId) {
  var prev   = APP.screen;
  APP.prevScreen = prev;
  APP.screen     = screenId;

  // Persist page so refresh restores it
  if (screenId !== 'auth') {
    localStorage.setItem('yp_page', screenId);
  }

  // Animate screens
  document.querySelectorAll('.screen').forEach(function (s) {
    s.classList.remove('active', 'prev');
  });

  var prevEl = document.getElementById('screen-' + prev);
  var nextEl = document.getElementById('screen-' + screenId);

  if (prevEl) {
    prevEl.classList.add('prev');
    setTimeout(function () { prevEl.classList.remove('prev'); }, 350);
  }
  if (nextEl) {
    nextEl.classList.add('active');
  }

  // Update bottom nav highlights
  document.querySelectorAll('.nav-item').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.nav === screenId);
  });

  // Call screen-specific init function if it exists
  var initFn = window['init_' + screenId];
  if (typeof initFn === 'function') {
    initFn();
  }
};

// ── TOAST ────────────────────────────────────────
window.toast = function (msg) {
  var el = document.getElementById('app-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(function () {
    el.classList.remove('show');
  }, 2400);
};

// ── BUTTON LOADING STATE ─────────────────────────
window.setLoad = function (prefix, on) {
  var btn  = document.getElementById(prefix + '-btn');
  var txt  = document.getElementById(prefix + '-txt');
  var dots = document.getElementById(prefix + '-dots');
  if (btn)  btn.disabled     = on;
  if (txt)  txt.style.display  = on ? 'none'  : 'inline';
  if (dots) dots.style.display = on ? 'flex'  : 'none';
};

// ── UTILITIES ────────────────────────────────────
window.validEmail = function (e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
};

window.fmtN = function (n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
};

window.nowTime = function () {
  return new Date().toLocaleTimeString('en', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
};

// ── ROLE-BASED ACCESS CONTROL ────────────────────
window.userCan = function (action) {
  if (!APP.user) return false;
  var role    = APP.user.role;
  var isOwner = APP.user.isOwner;

  switch (action) {
    case 'delete_content': return isOwner || role === 'admin_super' || role === 'admin_limited';
    case 'view_pii':       return isOwner || role === 'admin_super';
    case 'manage_users':   return isOwner || role === 'admin_super';
    case 'broadcast':      return isOwner || role === 'admin_super';
    case 'promote_users':  return isOwner;
    default:               return false;
  }
};

window.applyRoleUI = function () {
  if (!APP.user) return;
  document.querySelectorAll('[data-role]').forEach(function (el) {
    el.style.display = userCan(el.dataset.role) ? '' : 'none';
  });
};

// ── CHANNEL NAV ──────────────────────────────────
window.openChannel = function (nick) {
  APP.prevScreen = APP.screen;
  if (typeof init_channel === 'function') init_channel(nick);
  navTo('channel');
};

// ── NIGHT THEME ──────────────────────────────────
function applyNightTheme() {
  var h = new Date().getHours();
  document.body.classList.toggle('night', h >= 19 || h < 7);
}
applyNightTheme();
setInterval(applyNightTheme, 60000);

// ── CLOSE MENUS ON OUTSIDE CLICK ─────────────────
document.addEventListener('click', function (e) {
  var ctx    = document.getElementById('ctx-menu');
  var attach = document.getElementById('attach-sheet');
  if (ctx    && !ctx.contains(e.target))    ctx.classList.remove('open');
  if (attach && !attach.contains(e.target)) attach.classList.remove('open');
});
