// js/app.js
// NO type="module" — pure global vanilla JS
// PAGE_KEY lives HERE only — auth.js uses window.PAGE_KEY
'use strict';

window.APP      = { user: null, screen: 'auth', prevScreen: 'home' };
window.PAGE_KEY = 'yp_page';

window.navTo = function(id) {
  var prev = APP.screen;
  APP.prevScreen = prev;
  APP.screen     = id;
  if (id !== 'auth') localStorage.setItem(window.PAGE_KEY, id);
  document.querySelectorAll('.screen').forEach(function(s) {
    s.classList.remove('active', 'prev');
  });
  var prevEl = document.getElementById('screen-' + prev);
  var nextEl = document.getElementById('screen-' + id);
  if (prevEl) {
    prevEl.classList.add('prev');
    setTimeout(function() { prevEl.classList.remove('prev'); }, 350);
  }
  if (nextEl) nextEl.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(function(b) {
    b.classList.toggle('active', b.dataset.nav === id);
  });
  var fn = window['init_' + id];
  if (typeof fn === 'function') fn();
};

window.toast = function(msg) {
  var t = document.getElementById('app-toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(function() { t.classList.remove('show'); }, 2400);
};

window.setLoad = function(id, on) {
  var b = document.getElementById(id + '-btn');
  var t = document.getElementById(id + '-txt');
  var d = document.getElementById(id + '-dots');
  if (b) b.disabled = on;
  if (t) t.style.display = on ? 'none'  : 'inline';
  if (d) d.style.display = on ? 'flex'  : 'none';
};

window.fmtN = function(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
};
window.validEmail = function(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); };
window.delay      = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };
window.nowTime    = function() { return new Date().toLocaleTimeString('en', {hour:'2-digit',minute:'2-digit',hour12:false}); };

window.userCan = function(action) {
  if (!APP.user) return false;
  var r = APP.user.role;
  if (action === 'delete_content') return r==='admin_limited'||r==='admin_super'||APP.user.isOwner;
  if (action === 'view_pii')       return r==='admin_super'||APP.user.isOwner;
  if (action === 'manage_users')   return r==='admin_super'||APP.user.isOwner;
  if (action === 'broadcast')      return r==='admin_super'||APP.user.isOwner;
  if (action === 'promote_users')  return APP.user.isOwner;
  return false;
};

window.applyRoleUI = function() {
  if (!APP.user) return;
  document.querySelectorAll('[data-role]').forEach(function(el) {
    el.style.display = userCan(el.dataset.role) ? '' : 'none';
  });
};

window.openChannel = function(nick) {
  APP.prevScreen = APP.screen;
  if (typeof init_channel === 'function') init_channel(nick);
  navTo('channel');
};

function checkNight() {
  var h = new Date().getHours();
  document.body.classList.toggle('night', h >= 19 || h < 7);
}
checkNight();
setInterval(checkNight, 60000);

document.addEventListener('click', function(e) {
  var m = document.getElementById('ctx-menu');
  if (m && !m.contains(e.target)) m.classList.remove('open');
  var a = document.getElementById('attach-sheet');
  if (a && !a.contains(e.target)) a.classList.remove('open');
});
