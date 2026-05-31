// js/app.js — FILE 2 OF 6
// Global state, router, utilities, role checks, settings
// NO PAGE_KEY variable — uses 'yp_page' string directly everywhere

window.STATE = { user:null, screen:'auth', prevScreen:'home', settings:{} };
window.APP   = window.STATE; // alias

// ── ROUTER ──────────────────────────────────────────────

  window.navTo = function(id) {
    // 🚀 אויב דער באַנוצער קליקט אויף אַן אנדערן קאַנאַל, פֿיר אים אַריבער צונעם ריכטיגן פֿייל!
    if (id === 'chats' || id === 'chat') { window.location.href = "yidplus-chat.html"; return; }
    if (id === 'music') { window.location.href = "yidplus-music.html"; return; }
    if (id === 'shorts') { window.location.href = "yidplus-shorts.html"; return; }
    if (id === 'home' || id === 'dashboard') { window.location.href = "yidplus-dashboard.html"; return; }

    
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

// ── TOAST ────────────────────────────────────────────────
window.toast = function(msg, ms) {
  var el = document.getElementById('app-toast');
  if (!el) return;
  el.textContent = msg; el.classList.add('show');
  clearTimeout(el._t); el._t = setTimeout(function(){ el.classList.remove('show'); }, ms||2400);
};

// ── BUTTON LOADING ───────────────────────────────────────
window.setLoad = function(prefix, on) {
  var b=document.getElementById(prefix+'-btn'),
      t=document.getElementById(prefix+'-txt'),
      d=document.getElementById(prefix+'-dots');
  if(b) b.disabled=on;
  if(t) t.style.display=on?'none':'inline';
  if(d) d.style.display=on?'flex':'none';
};

// ── UTILITIES ────────────────────────────────────────────
window.validEmail = function(e){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); };
window.fmtN       = function(n){ return n>=1e6?(n/1e6).toFixed(1).replace(/\.0$/,'')+'M':n>=1e3?(n/1e3).toFixed(1).replace(/\.0$/,'')+'K':String(n); };
window.nowTime    = function(){ return new Date().toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit',hour12:false}); };
window.escHtml    = function(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
window.timeAgo    = function(iso){ var d=Math.floor((Date.now()-new Date(iso))/1000); return d<60?d+'s ago':d<3600?Math.floor(d/60)+'m ago':d<86400?Math.floor(d/3600)+'h ago':Math.floor(d/86400)+'d ago'; };

// ── ROLE CHECKS ──────────────────────────────────────────
window.isOwner      = function(){ return !!(STATE.user && STATE.user.email===OWNER_EMAIL); };
window.isSuperAdmin = function(){ return !!(STATE.user && (STATE.user.role==='admin_super'||isOwner())); };
window.isAnyAdmin   = function(){ return !!(STATE.user && (STATE.user.role==='admin_super'||STATE.user.role==='admin_limited'||isOwner())); };
window.userCan      = function(a){
  if(!STATE.user) return false;
  if(a==='delete_content') return isAnyAdmin();
  if(a==='view_pii')       return isSuperAdmin();
  if(a==='manage_users')   return isSuperAdmin();
  if(a==='broadcast')      return isSuperAdmin();
  if(a==='promote_users')  return isOwner();
  if(a==='edit_settings')  return isSuperAdmin();
  return false;
};

// ── APPLY ROLE-BASED UI ──────────────────────────────────
window.applyRoleUI = function() {
  if (!STATE.user) return;
  document.querySelectorAll('[data-role="admin"]').forEach(function(el){ el.style.display=isAnyAdmin()?'':'none'; });
  document.querySelectorAll('[data-role="super"]').forEach(function(el){ el.style.display=isSuperAdmin()?'':'none'; });
  document.querySelectorAll('[data-role="owner"]').forEach(function(el){ el.style.display=isOwner()?'':'none'; });
  var al=document.getElementById('admin-gate-link'); if(al) al.style.display=isAnyAdmin()?'flex':'none';
  document.querySelectorAll('.user-nickname-display').forEach(function(el){ el.textContent='@'+(STATE.user.nickname||STATE.user.email.split('@')[0]); });
  // Update settings screen
  var sn=document.getElementById('settings-nick'); if(sn) sn.textContent='@'+(STATE.user.nickname||STATE.user.email.split('@')[0]);
  var se=document.getElementById('settings-email'); if(se) se.textContent=STATE.user.email||'';
};

// ── APP SETTINGS (Supabase 'settings' table) ─────────────
window.loadAppSettings = function() {
  return sb.from(T.settings).select('key,value').then(function(res){
    if(res.error||!res.data) return;
    res.data.forEach(function(row){ STATE.settings[row.key]=row.value; });
    applyAppSettings();
  });
};
window.applyAppSettings = function() {
  var s=STATE.settings;
  if(s.app_title){ document.querySelectorAll('.app-title-display').forEach(function(el){el.textContent=s.app_title;}); document.title=s.app_title; }
  if(s.primary_color) document.documentElement.style.setProperty('--gold',s.primary_color);
  if(s.gold_light)    document.documentElement.style.setProperty('--gold-l',s.gold_light);
  ['home','shorts','music','chats','settings'].forEach(function(k){
    if(s['nav_'+k]) document.querySelectorAll('[data-nav-label="'+k+'"]').forEach(function(el){el.textContent=s['nav_'+k];});
  });
};
window.saveSetting = function(key, value) {
  STATE.settings[key]=value;
  sb.from(T.settings).upsert({key:key,value:value},{onConflict:'key'}).then(function(res){
    if(res.error) toast('❌ Save failed: '+res.error.message);
    else { applyAppSettings(); toast('✅ Setting saved!'); }
  });
};

// ── NIGHT THEME ──────────────────────────────────────────
window.applyNightTheme = function(){
  var h=new Date().getHours(), auto=STATE.settings.auto_night!=='false';
  if(auto) document.body.classList.toggle('night',h>=19||h<7);
};
applyNightTheme(); setInterval(applyNightTheme,60000);

// ── CHANNEL NAV ──────────────────────────────────────────
window.openChannel = function(nick){ STATE.prevScreen=STATE.screen; if(typeof init_channel==='function')init_channel(nick); else navTo('channel'); };

// ── CLOSE MENUS ON OUTSIDE CLICK ─────────────────────────
document.addEventListener('click',function(e){
  var m=document.getElementById('ctx-menu'); if(m&&!m.contains(e.target)) m.classList.remove('open');
  var a=document.getElementById('attach-sheet'); if(a&&!a.contains(e.target)) a.classList.remove('open');
});

console.log('[YID PLUS] app.js loaded ✓');
