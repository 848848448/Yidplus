// js/app.js — Router + Shared Utilities
'use strict';

window.APP = { user: null, screen: 'auth', prevScreen: 'home' };
const PAGE_KEY = 'yp_page';

// ── ROUTER ──
window.navTo = function(id) {
  const prev = APP.screen;
  APP.prevScreen = prev;
  APP.screen     = id;
  if (id !== 'auth') localStorage.setItem(PAGE_KEY, id);
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active', 'prev'));
  const prevEl = document.getElementById('screen-' + prev);
  const nextEl = document.getElementById('screen-' + id);
  if (prevEl) { prevEl.classList.add('prev'); setTimeout(() => prevEl.classList.remove('prev'), 350); }
  if (nextEl) nextEl.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.nav === id));
  const fn = window['init_' + id];
  if (typeof fn === 'function') fn();
};

// ── TOAST ──
window.toast = function(msg) {
  const t = document.getElementById('app-toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2400);
};

// ── BUTTON LOADING ──
window.setLoad = function(id, on) {
  const b = document.getElementById(id + '-btn');
  const t = document.getElementById(id + '-txt');
  const d = document.getElementById(id + '-dots');
  if (b) b.disabled = on;
  if (t) t.style.display = on ? 'none'  : 'inline';
  if (d) d.style.display = on ? 'flex'  : 'none';
};

// ── UTILS ──
window.fmtN       = n => n>=1e6?(n/1e6).toFixed(1).replace(/\.0$/,'')+'M':n>=1e3?(n/1e3).toFixed(1).replace(/\.0$/,'')+'K':String(n);
window.validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
window.delay      = ms => new Promise(r => setTimeout(r, ms));
window.nowTime    = () => new Date().toLocaleTimeString('en', {hour:'2-digit',minute:'2-digit',hour12:false});

// ── RBAC ──
window.userCan = function(action) {
  if (!APP.user) return false;
  const r = APP.user.role;
  if (action === 'delete_content') return ['admin_limited','admin_super'].includes(r) || APP.user.isOwner;
  if (action === 'view_pii')       return r === 'admin_super' || APP.user.isOwner;
  if (action === 'manage_users')   return r === 'admin_super' || APP.user.isOwner;
  if (action === 'broadcast')      return r === 'admin_super' || APP.user.isOwner;
  if (action === 'promote_users')  return APP.user.isOwner;
  return false;
};

window.applyRoleUI = function() {
  if (!APP.user) return;
  document.querySelectorAll('[data-role]').forEach(el => {
    el.style.display = userCan(el.dataset.role) ? '' : 'none';
  });
};

// ── NIGHT THEME ──
function checkNight() {
  document.body.classList.toggle('night', new Date().getHours() >= 19 || new Date().getHours() < 7);
}
checkNight();
setInterval(checkNight, 60000);

// ── CLOSE MENUS ON OUTSIDE CLICK ──
document.addEventListener('click', e => {
  const m = document.getElementById('ctx-menu');
  if (m && !m.contains(e.target)) m.classList.remove('open');
  const a = document.getElementById('attach-sheet');
  if (a && !a.contains(e.target)) a.classList.remove('open');
});
