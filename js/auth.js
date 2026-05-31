// ================================================
// js/auth.js  —  Supabase Authentication
// Uses: window.sb, window.APP, window.T, window.ROLES,
//       window.OWNER_EMAIL, window.navTo, window.setLoad,
//       window.validEmail, window.applyRoleUI, window.toast
// Zero local var/let/const that conflict with other files
// ================================================

// Prefix all local vars with AUTH_ to avoid any conflict
var AUTH_remMe = !!localStorage.getItem('yp_remember');

// ── SESSION OBSERVER ────────────────────────────
// Fires automatically when user signs in or out
sb.auth.onAuthStateChange(function (event, session) {
  if (event === 'SIGNED_IN' && session) {
    AUTH_loadProfile(session.user).then(function () {
      var page = localStorage.getItem('yp_page') || 'home';
      navTo(page);
      applyRoleUI();
      if (typeof init_home === 'function' && page === 'home') {
        init_home();
      }
    });
  } else if (event === 'SIGNED_OUT') {
    APP.user = null;
    navTo('auth');
  }
});

// ── LOAD PROFILE FROM SUPABASE ───────────────────
function AUTH_loadProfile(authUser) {
  return sb
    .from(T.users)
    .select('*')
    .eq('id', authUser.id)
    .single()
    .then(function (res) {
      if (res.data) {
        APP.user = {
          id:       res.data.id,
          email:    res.data.email,
          nickname: res.data.nickname || authUser.email.split('@')[0],
          role:     res.data.role     || ROLES.member,
          isOwner:  res.data.email    === OWNER_EMAIL,
          verified: res.data.verified || false,
          photo:    res.data.photo_url || null,
          phone:    res.data.phone     || null,
        };
      } else {
        // First login — create profile automatically
        return AUTH_createProfile(authUser);
      }
    });
}

function AUTH_createProfile(authUser) {
  var role = authUser.email === OWNER_EMAIL ? 'admin_super' : ROLES.member;
  var nick = authUser.email.split('@')[0];

  return sb.from(T.users).insert({
    id:       authUser.id,
    email:    authUser.email,
    nickname: nick,
    role:     role,
    verified: false,
    online:   true,
  }).select().single().then(function (res) {
    if (res.data) {
      APP.user = Object.assign({}, res.data, {
        isOwner: res.data.email === OWNER_EMAIL,
      });
      // Auto-create personal channel
      sb.from(T.channels).insert({
        owner_id:    authUser.id,
        nickname:    nick,
        followers:   0,
        following:   0,
        total_views: 0,
        verified:    false,
        bio:         '',
      });
    }
  });
}

// ── MESSAGE HELPERS ──────────────────────────────
function AUTH_showMsg(type, text) {
  var el = document.getElementById('auth-msg');
  if (!el) return;
  el.className = 'auth-msg ' + type;
  el.innerHTML = (type === 'err' ? '⚠ ' : '✓ ') + text;
}
function AUTH_clearMsg() {
  var el = document.getElementById('auth-msg');
  if (el) el.className = 'auth-msg';
}

// ── AUTH TAB SWITCHER ────────────────────────────
window.authTab = function (tab) {
  var loginEl = document.getElementById('auth-login');
  var regEl   = document.getElementById('auth-register');
  if (loginEl) loginEl.style.display = (tab === 'login')    ? 'block' : 'none';
  if (regEl)   regEl.style.display   = (tab === 'register') ? 'block' : 'none';

  document.querySelectorAll('.auth-tab').forEach(function (btn, i) {
    btn.classList.toggle('active',
      (i === 0 && tab === 'login') || (i === 1 && tab === 'register')
    );
  });
  AUTH_clearMsg();
};

// ── REMEMBER ME ──────────────────────────────────
window.toggleRemember = function () {
  AUTH_remMe = !AUTH_remMe;
  var tog = document.getElementById('rem-tog');
  if (tog) tog.classList.toggle('on', AUTH_remMe);
};

// ── LOGIN ────────────────────────────────────────
window.doLogin = function () {
  var email = (document.getElementById('l-email').value || '').trim();
  var pass  =  document.getElementById('l-pass').value  || '';
  AUTH_clearMsg();

  if (!email || !pass)     return AUTH_showMsg('err', 'Please fill in all fields.');
  if (!validEmail(email))  return AUTH_showMsg('err', 'Enter a valid email address.');

  setLoad('l', true);

  sb.auth.signInWithPassword({ email: email, password: pass })
    .then(function (res) {
      setLoad('l', false);
      if (res.error) {
        var msg = res.error.message.indexOf('Invalid') !== -1
          ? 'Wrong email or password.'
          : res.error.message;
        return AUTH_showMsg('err', msg);
      }
      if (AUTH_remMe) localStorage.setItem('yp_remember', email);
      else            localStorage.removeItem('yp_remember');

      AUTH_showMsg('ok', APP.user && APP.user.isOwner 
        ? 'Welcome back, Owner! 👑' 
        : 'Signed in! Loading your feed...'
      );

      // 🚀 קאָנעקט די סיסטעם גלייך צום Dashboard פֿייל!
      setTimeout(function() {
        window.location.href = "yidplus-dashboard.html";
      }, 1000); // עס וואַרט איין סעקונדע כדי דער באַנוצער זאָל קענען זען די "Signed in" מעסעדזש
    })
    .catch(function (err) {
      setLoad('l', false);
      AUTH_showMsg('err', err.message || 'Login failed.');
    });
};

// ── REGISTER ─────────────────────────────────────
window.doRegister = function () {
  var email = (document.getElementById('r-email').value  || '').trim();
  var nick  = (document.getElementById('r-nick').value   || '').trim();
  var phone = (document.getElementById('r-phone').value  || '').trim();
  var pass  =  document.getElementById('r-pass').value   || '';
  var pass2 =  document.getElementById('r-pass2').value  || '';
  AUTH_clearMsg();

  if (!email || !nick || !pass || !pass2)
    return AUTH_showMsg('err', 'Please fill in all required fields.');
  if (!validEmail(email))
    return AUTH_showMsg('err', 'Enter a valid email address.');
  if (nick.length < 3)
    return AUTH_showMsg('err', 'Nickname must be at least 3 characters.');
  if (pass.length < 6)
    return AUTH_showMsg('err', 'Password must be at least 6 characters.');
  if (pass !== pass2)
    return AUTH_showMsg('err', 'Passwords do not match.');

  setLoad('r', true);

  sb.auth.signUp({ email: email, password: pass })
    .then(function (res) {
      setLoad('r', false);
      if (res.error) {
        var msg = res.error.message.indexOf('already') !== -1
          ? 'This email is already registered.'
          : res.error.message;
        return AUTH_showMsg('err', msg);
      }

      var userId = res.data.user.id;
      var role   = email === OWNER_EMAIL ? 'admin_super' : ROLES.member;

      // Write profile to Supabase
      sb.from(T.users).insert({
        id:       userId,
        email:    email,
        nickname: nick,
        phone:    phone,
        role:     role,
        verified: false,
        online:   true,
      }).then(function () {
        sb.from(T.channels).insert({
          owner_id:    userId,
          nickname:    nick,
          followers:   0,
          following:   0,
          total_views: 0,
          verified:    false,
          bio:         '',
        });
}).then(function() {
   // דאָס פֿירט דעם באַנוצער צום הויפּט בלאַט נאָך 1 סעקונדע //
setTimeout(function() {
  window.location.href = "yidplus-dashboard.html";
  applyRoleUI();
}, 1000);
});
   AUTH_showMsg('ok', 'Account created! Your channel is being set up...');
    })
    .catch(function (err) {
      setLoad('r', false);
      AUTH_showMsg('err', err.message || 'Registration failed.');
    });
};

// ── LOGOUT ───────────────────────────────────────
window.doLogout = function () {
  if (!confirm('Sign out of YID PLUS?')) return;
  if (APP.user && APP.user.id) {
    sb.from(T.users).update({ online: false }).eq('id', APP.user.id);
  }
  sb.auth.signOut().then(function () {
    localStorage.removeItem('yp_page');
    toast('👋 Signed out successfully.');
  });
};

// ── RESTORE SESSION + EMAIL ON PAGE LOAD ─────────
document.addEventListener('DOMContentLoaded', function () {
  // Restore saved email
  var savedEmail = localStorage.getItem('yp_remember');
  if (savedEmail) {
    var emailInput = document.getElementById('l-email');
    if (emailInput) {
      emailInput.value = savedEmail;
      AUTH_remMe = true;
    }
    var remTog = document.getElementById('rem-tog');
    if (remTog) remTog.classList.add('on');
  }

  // Allow Enter key to submit login
  var passInput = document.getElementById('l-pass');
  if (passInput) {
    passInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') window.doLogin();
    });
  }

  // Check for existing Supabase session
  sb.auth.getSession().then(function (res) {
    if (res.data && res.data.session) {
      AUTH_loadProfile(res.data.session.user).then(function () {
        var page = localStorage.getItem('yp_page') || 'home';
        navTo(page);
        applyRoleUI();
      });
    } else {
      navTo('auth');
    }
  });
});
