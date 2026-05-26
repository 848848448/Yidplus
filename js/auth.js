// js/auth.js — Supabase Auth (Login, Register, Logout, Session Restore)
import { supabase, T, ROLES, OWNER_EMAIL } from '../supabase/client.js';

const PAGE_KEY = 'yp_page';
let remMe = !!localStorage.getItem('yp_remember');

// ── SESSION OBSERVER — keeps user logged in across refreshes ──
supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_IN' && session) {
    await loadUserProfile(session.user);
    const lastPage = localStorage.getItem(PAGE_KEY) || 'home';
    navTo(lastPage);
    applyRoleUI();
  } else if (event === 'SIGNED_OUT') {
    APP.user = null;
    navTo('auth');
  }
});

// ── LOAD PROFILE FROM users TABLE ──
async function loadUserProfile(authUser) {
  const { data } = await supabase
    .from(T.users)
    .select('*')
    .eq('id', authUser.id)
    .single();

  if (data) {
    APP.user = {
      id:       data.id,
      email:    data.email,
      nickname: data.nickname,
      role:     data.role || ROLES.member,
      isOwner:  data.email === OWNER_EMAIL,
      verified: data.verified,
      photo:    data.photo_url || null,
      phone:    data.phone || null,
    };
  } else {
    await createProfile(authUser);
  }
}

async function createProfile(authUser) {
  const role = authUser.email === OWNER_EMAIL ? 'admin_super' : ROLES.member;
  const nick = authUser.email.split('@')[0];
  const { data } = await supabase.from(T.users).insert({
    id: authUser.id, email: authUser.email,
    nickname: nick, role, verified: false, online: true,
  }).select().single();

  if (data) {
    APP.user = { ...data, isOwner: data.email === OWNER_EMAIL };
    await supabase.from(T.channels).insert({
      owner_id: authUser.id, nickname: nick,
      followers: 0, following: 0, total_views: 0,
      verified: false, bio: '',
    });
  }
}

// ── UI HELPERS ──
window.authTab = function(tab) {
  document.getElementById('auth-login').style.display    = tab === 'login'    ? 'block' : 'none';
  document.getElementById('auth-register').style.display = tab === 'register' ? 'block' : 'none';
  document.querySelectorAll('.auth-tab').forEach((t,i) =>
    t.classList.toggle('active', i===0 ? tab==='login' : tab==='register')
  );
  clearAuthMsg();
};

window.toggleRemember = function() {
  remMe = !remMe;
  document.getElementById('rem-tog')?.classList.toggle('on', remMe);
};

function showAuthMsg(type, text) {
  const el = document.getElementById('auth-msg');
  if (!el) return;
  el.className = 'auth-msg ' + type;
  el.innerHTML = (type === 'err' ? '⚠ ' : '✓ ') + text;
}
function clearAuthMsg() {
  const el = document.getElementById('auth-msg');
  if (el) el.className = 'auth-msg';
}

// ── LOGIN ──
window.doLogin = async function() {
  const email = document.getElementById('l-email').value.trim();
  const pass  = document.getElementById('l-pass').value;
  clearAuthMsg();
  if (!email || !pass)    return showAuthMsg('err', 'Please fill in all fields.');
  if (!validEmail(email)) return showAuthMsg('err', 'Enter a valid email address.');

  setLoad('l', true);
  const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
  setLoad('l', false);

  if (error) {
    return showAuthMsg('err',
      error.message.includes('Invalid') ? 'Wrong email or password.' : error.message
    );
  }
  if (remMe) localStorage.setItem('yp_remember', email);
  else       localStorage.removeItem('yp_remember');
  showAuthMsg('ok', APP.user?.isOwner ? 'Welcome back, Owner! 👑' : 'Signed in! Loading your feed...');
};

// ── REGISTER ──
window.doRegister = async function() {
  const email = document.getElementById('r-email').value.trim();
  const nick  = document.getElementById('r-nick').value.trim();
  const phone = document.getElementById('r-phone').value.trim();
  const pass  = document.getElementById('r-pass').value;
  const pass2 = document.getElementById('r-pass2').value;
  clearAuthMsg();

  if (!email||!nick||!pass||!pass2) return showAuthMsg('err', 'Please fill in all required fields.');
  if (!validEmail(email))           return showAuthMsg('err', 'Enter a valid email address.');
  if (nick.length < 3)              return showAuthMsg('err', 'Nickname must be at least 3 characters.');
  if (pass.length < 6)              return showAuthMsg('err', 'Password must be at least 6 characters.');
  if (pass !== pass2)               return showAuthMsg('err', 'Passwords do not match.');

  setLoad('r', true);
  const { data, error } = await supabase.auth.signUp({ email, password: pass });
  setLoad('r', false);

  if (error) {
    return showAuthMsg('err',
      error.message.includes('already') ? 'This email is already registered.' : error.message
    );
  }

  const role = email === OWNER_EMAIL ? 'admin_super' : ROLES.member;
  await supabase.from(T.users).insert({
    id: data.user.id, email, nickname: nick, phone,
    role, verified: false, online: true,
  });
  await supabase.from(T.channels).insert({
    owner_id: data.user.id, nickname: nick,
    followers: 0, following: 0, total_views: 0, verified: false, bio: '',
  });

  showAuthMsg('ok', 'Account created! Your channel is being set up...');
};

// ── LOGOUT ──
window.doLogout = async function() {
  if (!confirm('Sign out of YID PLUS?')) return;
  if (APP.user?.id) {
    await supabase.from(T.users).update({ online: false }).eq('id', APP.user.id);
  }
  await supabase.auth.signOut();
  localStorage.removeItem(PAGE_KEY);
  toast('👋 Signed out.');
};

// ── RESTORE SESSION ON PAGE LOAD ──
document.addEventListener('DOMContentLoaded', async () => {
  // Restore saved email
  const saved = localStorage.getItem('yp_remember');
  if (saved) {
    const el = document.getElementById('l-email');
    if (el) { el.value = saved; remMe = true; }
    document.getElementById('rem-tog')?.classList.add('on');
  }
  document.getElementById('l-pass')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });

  // Check for existing Supabase session
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    await loadUserProfile(session.user);
    const lastPage = localStorage.getItem(PAGE_KEY) || 'home';
    navTo(lastPage);
    applyRoleUI();
  } else {
    navTo('auth');
  }
});
