// ============================================================
// js/app.js
// Router, shared utilities, page state persistence
// ============================================================

'use strict';

window.APP = { user: null, screen: 'auth', prevScreen: 'home' };
const PAGE_KEY = 'yp_page';

// ── ROUTER ──
window.navTo = function(id) {
  const prev = APP.screen;
  APP.prevScreen = prev;
  APP.screen     = id;

  // Persist current page so refresh restores it
  if (id !== 'auth') localStorage.setItem(PAGE_KEY, id);

  // Animate screens
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active', 'prev');
  });
  const prevEl = document.getElementById('screen-' + prev);
  const nextEl = document.getElementById('screen-' + id);
  if (prevEl) { prevEl.classList.add('prev'); setTimeout(() => prevEl.classList.remove('prev'), 350); }
  if (nextEl) nextEl.classList.add('active');

  // Update bottom nav
  document.querySelectorAll('.nav-item').forEach(b =>
    b.classList.toggle('active', b.dataset.nav === id)
  );

  // Run screen init function if it exists
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

// ── BUTTON LOADING STATE ──
window.setLoad = function(id, on) {
  const b = document.getElementById(id + '-btn');
  const t = document.getElementById(id + '-txt');
  const d = document.getElementById(id + '-dots');
  if (b) b.disabled = on;
  if (t) t.style.display = on ? 'none'  : 'inline';
  if (d) d.style.display = on ? 'flex'  : 'none';
};

// ── UTILS ──
window.fmtN = function(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
};
window.validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
window.delay      = ms => new Promise(r => setTimeout(r, ms));
window.nowTime    = () => new Date().toLocaleTimeString('en', { hour:'2-digit', minute:'2-digit', hour12:false });

// ── RBAC UI HELPER ──
// Call after login to show/hide elements based on role
window.applyRoleUI = function() {
  if (!APP.user) return;
  // Elements that need admin_super
  document.querySelectorAll('[data-role="admin_super"]').forEach(el => {
    el.style.display = userCan('manage_users') ? '' : 'none';
  });
  // Elements that need delete permission
  document.querySelectorAll('[data-role="delete_content"]').forEach(el => {
    el.style.display = userCan('delete_content') ? '' : 'none';
  });
  // Owner-only elements
  document.querySelectorAll('[data-role="owner"]').forEach(el => {
    el.style.display = APP.user.isOwner ? '' : 'none';
  });
};

// ── NIGHT THEME ──
function checkNight() {
  const h = new Date().getHours();
  document.body.classList.toggle('night', h >= 19 || h < 7);
}
checkNight();
setInterval(checkNight, 60000);

// ── CLOSE MENUS ON OUTSIDE CLICK ──
document.addEventListener('click', e => {
  const m = document.getElementById('ctx-menu');
  if (m && !m.contains(e.target)) m.classList.remove('open');
  const a = document.getElementById('attach-sheet');
  if (a && !a.contains(e.target) && !e.target.closest('[onclick*="toggleAttach"]')) {
    a.classList.remove('open');
  }
});
