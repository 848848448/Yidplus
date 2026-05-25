// js/app.js — Router + Shared Utilities
'use strict';
window.APP = { user: null, screen: 'auth', prevScreen: 'home' };

window.navTo = function(id) {
  const prev = APP.screen;
  APP.prevScreen = prev;
  APP.screen = id;
  document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); s.classList.remove('prev'); });
  const prevEl = document.getElementById('screen-' + prev);
  const nextEl = document.getElementById('screen-' + id);
  if (prevEl) { prevEl.classList.add('prev'); setTimeout(() => prevEl.classList.remove('prev'), 350); }
  if (nextEl) nextEl.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.nav === id));
  const fn = window['init_' + id];
  if (typeof fn === 'function') fn();
};

window.toast = function(msg) {
  const t = document.getElementById('app-toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2400);
};

window.setLoad = function(id, on) {
  const b = document.getElementById(id + '-btn');
  const t = document.getElementById(id + '-txt');
  const d = document.getElementById(id + '-dots');
  if (b) b.disabled = on;
  if (t) t.style.display = on ? 'none' : 'inline';
  if (d) d.style.display = on ? 'flex' : 'none';
};

window.fmtN = function(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
};

window.validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
window.delay      = ms => new Promise(r => setTimeout(r, ms));
window.nowTime    = () => new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false });

// Night theme
function checkNight() {
  const h = new Date().getHours();
  document.body.classList.toggle('night', h >= 19 || h < 7);
}
checkNight();
setInterval(checkNight, 60000);

// Close context menu on outside click
document.addEventListener('click', e => {
  const m = document.getElementById('ctx-menu');
  if (m && !m.contains(e.target)) m.classList.remove('open');
});
