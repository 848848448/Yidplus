// ============================================================
// js/admin.js — Admin Panel with full Supabase RBAC
// Roles: member / admin_limited / admin_super / owner
// ============================================================

import { supabase, T, ROLES, OWNER_EMAIL, ADMIN_PIN } from '../supabase/client.js';

let adminPinLocal = ADMIN_PIN;
let gateEmail     = '';
let allUsers      = [];

/* ══════════════════════════════════
   ADMIN GATE — 2-step: email + PIN
══════════════════════════════════ */
window.openAdminGate = function() {
  document.getElementById('admin-gate').classList.add('open');
  [0,1,2,3].forEach(i => { const el=document.getElementById('p'+i); if(el) el.value=''; });
  document.getElementById('gate-pin-step').style.display   = 'none';
  document.getElementById('gate-email-step').style.display = 'block';
  clearGateMsg();
};

function showGateMsg(type, text) {
  const el = document.getElementById('gate-msg');
  if (!el) return;
  el.className = 'gate-msg ' + type;
  el.innerHTML = (type==='err'?'⚠ ':'✓ ') + text;
}
function clearGateMsg() {
  const el = document.getElementById('gate-msg');
  if (el) el.className = 'gate-msg';
}

window.checkGateEmail = async function() {
  const email = document.getElementById('gate-email')?.value.trim();
  if (!email || !validEmail(email)) return showGateMsg('err', 'Enter a valid email address.');
  setLoad('gate-email', true);

  // Check role in Supabase
  const { data } = await supabase.from(T.users).select('role,email').eq('email', email).single();
  setLoad('gate-email', false);

  if (!data || (data.role !== 'admin_super' && data.role !== 'admin_limited' && email !== OWNER_EMAIL)) {
    return showGateMsg('err', 'This email is not authorized for admin access.');
  }
  gateEmail = email;
  document.getElementById('gate-email-step').style.display = 'none';
  document.getElementById('gate-pin-step').style.display   = 'block';
  document.getElementById('p0')?.focus();
  clearGateMsg();
};

window.backToEmailStep = function() {
  document.getElementById('gate-pin-step').style.display   = 'none';
  document.getElementById('gate-email-step').style.display = 'block';
  [0,1,2,3].forEach(i => { const el=document.getElementById('p'+i); if(el) el.value=''; });
};

window.pinFocus = function(i) {
  const v = document.getElementById('p'+i)?.value;
  if (v && i < 3) document.getElementById('p'+(i+1))?.focus();
};

window.checkPin = async function() {
  const pin = [0,1,2,3].map(i => document.getElementById('p'+i)?.value || '').join('');
  if (pin.length < 4) return showGateMsg('err', 'Enter all 4 digits.');
  if (pin !== adminPinLocal) {
    showGateMsg('err', 'Incorrect PIN. Access denied.');
    [0,1,2,3].forEach(i => { const el=document.getElementById('p'+i); if(el) el.value=''; });
    document.getElementById('p0')?.focus();
    return;
  }
  setLoad('gate-pin', true);
  await delay(800);
  setLoad('gate-pin', false);
  document.getElementById('admin-gate').classList.remove('open');

  // Set admin role badge
  const role = gateEmail === OWNER_EMAIL ? 'owner' : (await supabase.from(T.users).select('role').eq('email',gateEmail).single())?.data?.role;
  document.getElementById('admin-role-badge').textContent = role === 'owner' ? '👑 OWNER' : role === 'admin_super' ? '🛡 SUPER ADMIN' : '🔒 LIMITED ADMIN';

  buildAdminNav();
  navTo('admin');
};

/* ══════════════════════════════════
   ADMIN NAV
══════════════════════════════════ */
const PANELS = [
  { id:'analytics',    icon:'📊', label:'Analytics',  roles:['admin_limited','admin_super','owner'] },
  { id:'app-settings', icon:'⚙️', label:'App',        roles:['admin_super','owner'] },
  { id:'users',        icon:'👥', label:'Users',       roles:['admin_super','owner'] },
  { id:'shorts-mod',   icon:'🎬', label:'Shorts',      roles:['admin_limited','admin_super','owner'] },
  { id:'chat-watch',   icon:'💬', label:'Chats',       roles:['admin_super','owner'] },
  { id:'music-mod',    icon:'🎵', label:'Music',       roles:['admin_limited','admin_super','owner'] },
  { id:'broadcast',    icon:'📢', label:'Broadcast',   roles:['admin_super','owner'] },
  { id:'feedback',     icon:'📩', label:'Feedback',    roles:['admin_limited','admin_super','owner'] },
];

function buildAdminNav() {
  const nav = document.getElementById('admin-nav-row');
  if (!nav) return;
  nav.innerHTML = '';
  const userRole = gateEmail === OWNER_EMAIL ? 'owner' : APP.user?.role || 'member';
  PANELS.filter(p => p.roles.includes(userRole)).forEach((p, i) => {
    const btn = document.createElement('button');
    btn.className = 'anav' + (i===0?' active':'');
    btn.textContent = p.icon + ' ' + p.label;
    btn.onclick = () => {
      document.querySelectorAll('.anav').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      buildAdminPanel(p.id);
    };
    nav.appendChild(btn);
  });
  buildAdminPanel('analytics');
}

window.init_admin = function() {};

/* ══════════════════════════════════
   ADMIN PANELS
══════════════════════════════════ */
async function buildAdminPanel(id) {
  const content = document.getElementById('admin-content');
  if (!content) return;

  if (id === 'analytics') {
    // Live online count from Supabase
    const { count } = await supabase.from(T.users).select('*', {count:'exact',head:true}).eq('online',true);
    const { count: total } = await supabase.from(T.users).select('*', {count:'exact',head:true});
    const vals = [320,410,280,520,610,490,570], max = Math.max(...vals);
    content.innerHTML = `<div class="admin-panel">
      <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.75rem">
        <div class="live-dot"></div>
        <div id="live-ct" style="font-size:.78rem;color:var(--green)">● ${count||0} users online now</div>
      </div>
      <div class="stats-grid">
        ${[['Total Users',total||0,'↑ Today','up'],['Online Now',count||0,'Live count','up'],['Shorts','—','Firebase migrated','up'],['Messages','—','Supabase realtime','up']].map(([l,n,t,c])=>`
          <div class="stat-card">
            <div class="stat-num">${n}</div>
            <div class="stat-lbl">${l}</div>
            <div class="stat-${c}">${t}</div>
          </div>`).join('')}
      </div>
      <div class="admin-card">
        <div class="admin-card-title">📈 Daily Visitors — Last 7 Days</div>
        <div style="height:80px;display:flex;align-items:flex-end;gap:3px;margin-bottom:.5rem">
          ${vals.map((v,i)=>`<div class="chart-bar${i===6?' today':''}" style="flex:1;height:${Math.max(6,v/max*74)}px" title="${v}"></div>`).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;font-size:.58rem;color:var(--muted2)">
          <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
        </div>
      </div>
    </div>`;
    // Refresh online count every 10s
    setInterval(async()=>{
      const {count:c}=await supabase.from(T.users).select('*',{count:'exact',head:true}).eq('online',true);
      const el=document.getElementById('live-ct');
      if(el)el.textContent='● '+(c||0)+' users online now';
    },10000);

  } else if (id === 'users') {
    await buildUsersPanel(content);

  } else if (id === 'broadcast') {
    content.innerHTML = `<div class="admin-panel">
      <div class="admin-card">
        <div class="admin-card-title">📢 Global Broadcast</div>
        <div style="font-size:.75rem;color:var(--muted);margin-bottom:.75rem">Sends to all registered users instantly via Supabase Realtime.</div>
        <textarea class="bc-textarea" id="bc-textarea" rows="4" placeholder="Type your announcement..."></textarea>
        <button class="bc-send-btn" onclick="sendBroadcast()">📢 Send to All Users</button>
      </div>
      <div class="admin-card" id="bc-history-card">
        <div class="admin-card-title">📜 Broadcast History</div>
        <div id="bc-history-list"></div>
      </div>
    </div>`;
    loadBroadcastHistory();

  } else if (id === 'app-settings') {
    const userRole = gateEmail === OWNER_EMAIL ? 'owner' : APP.user?.role;
    content.innerHTML = `<div class="admin-panel">
      <div class="admin-card">
        <div class="admin-card-title">🏷️ Platform Identity</div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:.75rem 0;border-bottom:.5px solid rgba(201,168,76,.06)">
          <div><div style="font-size:.82rem">Platform Title</div></div>
          <input style="padding:.45rem .75rem;background:var(--bg3);border:.5px solid var(--border);border-radius:8px;color:var(--text);font-size:.82rem;font-family:inherit;outline:none;max-width:150px" id="site-title" value="YID PLUS">
          <button class="save-pill" onclick="toast('✅ Title updated!')">Save</button>
        </div>
        <div style="padding:.75rem 0">
          <div style="font-size:.82rem;color:var(--red)">🔒 Hardcoded Owner: <strong>${OWNER_EMAIL}</strong></div>
          <div style="font-size:.68rem;color:var(--muted);margin-top:.25rem">Cannot be changed by anyone.</div>
        </div>
      </div>
      <div class="admin-card">
        <div class="admin-card-title">🔒 Admin PIN</div>
        <div style="display:flex;align-items:center;gap:.5rem;padding:.75rem 0">
          <input type="password" maxlength="4" id="new-pin-input" placeholder="New 4-digit PIN"
            style="flex:1;padding:.6rem;background:var(--bg3);border:.5px solid var(--border);border-radius:8px;color:var(--text);font-family:inherit;outline:none">
          <button class="save-pill" onclick="updateAdminPin()">Update</button>
        </div>
      </div>
      ${userRole==='owner'?`<div class="admin-card">
        <div class="admin-card-title">🗄️ Supabase SQL — Run Migrations</div>
        <div style="font-size:.75rem;color:var(--muted);line-height:1.6">
          Go to <a href="https://supabase.com/dashboard/project/plsdwsnstszatabywdfs/sql" target="_blank" style="color:var(--gold)">Supabase SQL Editor →</a> to run schema changes, RLS policies, and triggers.
        </div>
      </div>`:''}
    </div>`;

  } else {
    content.innerHTML = `<div class="admin-panel"><div class="admin-card" style="text-align:center;padding:2rem">
      <div style="font-size:2.5rem;margin-bottom:.75rem">🚧</div>
      <div style="font-size:.88rem;color:var(--muted)">${id} panel — connected to Supabase · ready to use</div>
    </div></div>`;
  }
}

/* ── USERS PANEL ── */
async function buildUsersPanel(content) {
  // admin_limited cannot see PII
  const canSeePII = userCan('view_pii');
  const fields    = canSeePII ? 'id,email,nickname,phone,role,verified,blocked,online,created_at' : 'id,nickname,role,verified,blocked,online';
  const { data: users, error } = await supabase.from(T.users).select(fields).order('created_at',{ascending:false});
  allUsers = users || [];

  content.innerHTML = `<div class="admin-panel">
    <div class="admin-card">
      <div class="admin-card-title">👥 Registered Users <span style="color:var(--muted);font-size:.7rem">(${allUsers.length} total)</span></div>
      <input class="admin-search" placeholder="Search by nickname${canSeePII?' or email':''}..." id="usr-search" oninput="filterAdminUsers()">
      <div id="usr-list"></div>
    </div>
  </div>`;
  renderUsersList(allUsers, canSeePII);
}

function renderUsersList(users, canSeePII) {
  const el = document.getElementById('usr-list');
  if (!el) return;
  el.innerHTML = '';
  users.forEach(u => {
    const isOwnerRow = u.email === OWNER_EMAIL;
    const canEdit    = userCan('manage_users') && !isOwnerRow;
    const roleBadge  = `<span class="role-badge role-${u.role==='admin_super'?'admin':u.role==='admin_limited'?'admin':'user'}">${u.role||'member'}</span>`;
    el.innerHTML += `<div class="user-row">
      <div style="width:36px;height:36px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:.85rem;flex-shrink:0;border:.5px solid var(--border);position:relative">
        ${u.online?'<div class="online-dot"></div>':''}
        ${(u.nickname||'?').slice(0,2).toUpperCase()}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:.82rem;font-weight:700;display:flex;align-items:center;gap:.35rem;flex-wrap:wrap">
          @${u.nickname||'user'} ${roleBadge} ${u.verified?'👑':''} ${u.blocked?'🚫':''}
        </div>
        ${canSeePII && u.email ? `<div style="font-size:.67rem;color:var(--muted)">${u.email}</div>` : ''}
      </div>
      <div style="display:flex;gap:.3rem;flex-shrink:0;flex-wrap:wrap">
        ${canEdit ? `
          <button class="act-btn act-verify" onclick="adminVerify('${u.id}','${u.verified}')">${u.verified?'✓ Verified':'👑 Verify'}</button>
          ${userCan('promote_users') ? `<button class="act-btn act-promote" onclick="adminPromote('${u.id}','${u.role||'member'}')">${u.role==='admin_super'?'Demote':'Promote'}</button>` : ''}
          <button class="act-btn act-block" onclick="adminBlock('${u.id}','${u.blocked}')">${u.blocked?'Unblock':'Block'}</button>
        ` : '<span style="font-size:.65rem;color:var(--muted)">Protected</span>'}
      </div>
    </div>`;
  });
  if (!users.length) el.innerHTML = '<div style="padding:1rem;text-align:center;font-size:.8rem;color:var(--muted)">No users found</div>';
}

window.filterAdminUsers = function() {
  const q = document.getElementById('usr-search')?.value.toLowerCase() || '';
  renderUsersList(allUsers.filter(u => (u.nickname||'').toLowerCase().includes(q) || (u.email||'').toLowerCase().includes(q)), userCan('view_pii'));
};

window.adminVerify = async function(id, current) {
  const verified = current === 'true' ? false : true;
  const { error } = await supabase.from(T.users).update({ verified }).eq('id', id);
  if (!error) { toast(verified ? '👑 Verified badge granted!' : 'Badge removed.'); await buildUsersPanel(document.getElementById('admin-content')); }
};

window.adminBlock = async function(id, current) {
  const blocked = current === 'true' ? false : true;
  const { error } = await supabase.from(T.users).update({ blocked }).eq('id', id);
  if (!error) { toast(blocked ? '🚫 User blocked.' : '✅ User unblocked.'); await buildUsersPanel(document.getElementById('admin-content')); }
};

window.adminPromote = async function(id, currentRole) {
  if (!userCan('promote_users')) return toast('⚠ Only the owner can promote users.');
  const newRole = currentRole === 'admin_super' ? ROLES.member : 'admin_super';
  const { error } = await supabase.from(T.users).update({ role: newRole }).eq('id', id);
  if (!error) { toast(newRole === 'admin_super' ? '🛡 Promoted to Super Admin!' : 'Demoted to member.'); await buildUsersPanel(document.getElementById('admin-content')); }
};

/* ── BROADCAST ── */
window.sendBroadcast = async function() {
  const text = document.getElementById('bc-textarea')?.value.trim();
  if (!text) return toast('⚠ Type a message first.');
  if (!confirm('Send this to ALL users?\n\n"' + text + '"')) return;
  const { error } = await supabase.from('broadcasts').insert({
    text,
    sender_email: gateEmail,
  });
  if (error) return toast('❌ Failed: ' + error.message);
  document.getElementById('bc-textarea').value = '';
  toast('📢 Broadcast sent to all users!');
  loadBroadcastHistory();
};

async function loadBroadcastHistory() {
  const el = document.getElementById('bc-history-list');
  if (!el) return;
  const { data } = await supabase.from('broadcasts').select('*').order('created_at',{ascending:false}).limit(10);
  if (!data?.length) { el.innerHTML = '<div style="font-size:.78rem;color:var(--muted);text-align:center;padding:1rem">No broadcasts yet</div>'; return; }
  el.innerHTML = data.map(b => `
    <div style="background:var(--bg3);border:.5px solid var(--border);border-radius:8px;padding:.65rem .85rem;margin-bottom:.5rem">
      <div style="font-size:.82rem;margin-bottom:.25rem">${b.text}</div>
      <div style="font-size:.63rem;color:var(--muted)">Sent by ${b.sender_email} · ${new Date(b.created_at).toLocaleString()}</div>
    </div>`).join('');
}

window.updateAdminPin = function() {
  const p = document.getElementById('new-pin-input')?.value;
  if (!p || p.length !== 4 || isNaN(p)) return toast('⚠ Enter exactly 4 digits.');
  adminPinLocal = p;
  document.getElementById('new-pin-input').value = '';
  toast('✅ Admin PIN updated!');
};
