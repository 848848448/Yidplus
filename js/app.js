// js/app.js — Global State + Router + Utilities
// Loads after supabase/client.js

window.STATE = { user:null, screen:'auth', prevScreen:'home', settings:{}, initialized:false };
window.APP   = window.STATE; // alias

// ── ROUTER ──
window.navTo = function(id) {
  var prev = STATE.screen;
  STATE.prevScreen = prev;
  STATE.screen     = id;
  if (id !== 'auth') localStorage.setItem('yp_page', id);
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active','prev'); });
  var p = document.getElementById('screen-'+prev);
  var n = document.getElementById('screen-'+id);
  if (p){ p.classList.add('prev'); setTimeout(function(){ p.classList.remove('prev'); }, 350); }
  if (n) n.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(function(b){ b.classList.toggle('active', b.dataset.nav===id); });
  var fn = window['init_'+id];
  if (typeof fn === 'function') fn();
};

// ── TOAST ──
window.toast = function(msg, ms) {
  var el = document.getElementById('app-toast');
  if (!el) return;
  el.textContent = msg; el.classList.add('show');
  clearTimeout(el._t); el._t = setTimeout(function(){ el.classList.remove('show'); }, ms||2400);
};

// ── BUTTON LOADER ──
window.setLoad = function(prefix, on) {
  var b=document.getElementById(prefix+'-btn'), t=document.getElementById(prefix+'-txt'), d=document.getElementById(prefix+'-dots');
  if(b) b.disabled=on; if(t) t.style.display=on?'none':'inline'; if(d) d.style.display=on?'flex':'none';
};

// ── UTILS ──
window.validEmail = function(e){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); };
window.fmtN = function(n){ return n>=1e6?(n/1e6).toFixed(1).replace(/\.0$/,'')+'M':n>=1e3?(n/1e3).toFixed(1).replace(/\.0$/,'')+'K':String(n); };
window.nowTime = function(){ return new Date().toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit',hour12:false}); };

// ── ROLE CHECKS ──
window.isOwner      = function(){ return !!(STATE.user && STATE.user.email === OWNER_EMAIL); };
window.isSuperAdmin = function(){ return !!(STATE.user && (STATE.user.role==='admin_super' || isOwner())); };
window.isAnyAdmin   = function(){ return !!(STATE.user && (STATE.user.role==='admin_super'||STATE.user.role==='admin_limited'||isOwner())); };
window.userCan = function(action) {
  if (!STATE.user) return false;
  if (action==='delete_content') return isAnyAdmin();
  if (action==='view_pii')       return isSuperAdmin();
  if (action==='manage_users')   return isSuperAdmin();
  if (action==='broadcast')      return isSuperAdmin();
  if (action==='promote_users')  return isOwner();
  if (action==='edit_settings')  return isSuperAdmin();
  return false;
};

// ── APPLY ROLE UI ──
window.applyRoleUI = function() {
  if (!STATE.user) return;
  document.querySelectorAll('[data-role="admin"]').forEach(function(el){ el.style.display=isAnyAdmin()?'':'none'; });
  document.querySelectorAll('[data-role="super"]').forEach(function(el){ el.style.display=isSuperAdmin()?'':'none'; });
  document.querySelectorAll('[data-role="owner"]').forEach(function(el){ el.style.display=isOwner()?'':'none'; });
  var al=document.getElementById('admin-gate-link'); if(al) al.style.display=isAnyAdmin()?'flex':'none';
  document.querySelectorAll('.user-nickname-display').forEach(function(el){ el.textContent='@'+(STATE.user.nickname||STATE.user.email.split('@')[0]); });
};

// ── APP SETTINGS (from Supabase 'settings' table) ──
window.loadAppSettings = function() {
  return sb.from('settings').select('key,value').then(function(res) {
    if (res.error || !res.data) return;
    res.data.forEach(function(row){ STATE.settings[row.key] = row.value; });
    applyAppSettings();
  });
};
window.applyAppSettings = function() {
  var s = STATE.settings;
  if (s.app_title){
    document.querySelectorAll('.app-title-display').forEach(function(el){ el.textContent=s.app_title; });
    document.title = s.app_title;
  }
  if (s.primary_color) document.documentElement.style.setProperty('--gold', s.primary_color);
  if (s.gold_light)    document.documentElement.style.setProperty('--gold-l', s.gold_light);
  ['home','shorts','music','chats','settings'].forEach(function(k){
    if (s['nav_'+k]) document.querySelectorAll('[data-nav-label="'+k+'"]').forEach(function(el){ el.textContent=s['nav_'+k]; });
  });
};

// ── NIGHT THEME ──
window.applyNightTheme = function() {
  var h=new Date().getHours(), auto=STATE.settings.auto_night!=='false';
  if(auto) document.body.classList.toggle('night',h>=19||h<7);
};
applyNightTheme(); setInterval(applyNightTheme,60000);

// ── CHANNEL NAV ──
window.openChannel = function(nick) { STATE.prevScreen=STATE.screen; if(typeof init_channel==='function')init_channel(nick); else navTo('channel'); };

// ── CLOSE MENUS ON OUTSIDE CLICK ──
document.addEventListener('click',function(e){
  var m=document.getElementById('ctx-menu'); if(m&&!m.contains(e.target)) m.classList.remove('open');
  var a=document.getElementById('attach-sheet'); if(a&&!a.contains(e.target)) a.classList.remove('open');
});

console.log('YID PLUS: app.js loaded ✓');
