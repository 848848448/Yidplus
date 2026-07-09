// ================================================
// js/auth.js  —  Cloudflare D1 Authentication
// Uses: window.AUTH, window.api, window.STATE,
//       window.CONFIG, window.ROLES, window.navTo,
//       window.setLoad, window.validEmail,
//       window.applyRoleUI, window.toast
// All session/profile logic lives in AUTH (state.js).
// This file is just the UI glue for the auth screen.
// ================================================

var AUTH_remMe = !!localStorage.getItem('yp_remember');

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
window.requestPasswordReset = function () {
  var prefill = (document.getElementById('l-email') || {}).value || '';
  var email = prompt('Enter your account email and we\u2019ll send you a link to reset your password:', prefill.trim());
  if (email === null) return; // cancelled
  email = email.trim();
  if (!email) return toast('\u26A0 Please enter your email.');

  api.post('/auth/request-password-reset', { email: email })
    .then(function () {
      // Deliberately the same message whether or not the email is registered,
      // so this can't be used to discover which emails have accounts.
      toast('\uD83D\uDCE7 If that email has an account, a reset link is on its way. Check your inbox.');
    })
    .catch(function (err) { toast('\u274C ' + err.message); });
};

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

// ── AFTER SUCCESSFUL LOGIN/REGISTER ──────────────
function AUTH_goHome() {
  if (typeof _checkEmailVerifyAndContinue === 'function' && STATE.user) {
    _checkEmailVerifyAndContinue(STATE.user);
    return;
  }
  applyRoleUI();
  if (typeof loadAppSettings === 'function') loadAppSettings();
  var page = localStorage.getItem('yp_page');
  var INDEX_SCREENS = ['explore', 'settings', 'profile', 'channel'];
  if (page && INDEX_SCREENS.indexOf(page) !== -1) {
    navTo(page);
  } else {
    // Default landing = Chats (WhatsApp-style)
    goPage('/chat');
  }
}

// ── LOGIN ────────────────────────────────────────
window.doLogin = function () {
  var email = (document.getElementById('l-email').value || '').trim();
  var pass  =  document.getElementById('l-pass').value  || '';
  AUTH_clearMsg();

  if (!email || !pass)     return AUTH_showMsg('err', 'Please fill in all fields.');
  if (!validEmail(email))  return AUTH_showMsg('err', 'Enter a valid email address.');

  setLoad('l', true);

  AUTH.login(email, pass)
    .then(function (user) {
      setLoad('l', false);

      if (AUTH_remMe) localStorage.setItem('yp_remember', email);
      else            localStorage.removeItem('yp_remember');

      AUTH_showMsg('ok',
        (user && user.isOwner)
          ? 'Welcome back, Owner! 👑'
          : 'Signed in! Loading your feed...'
      );

      showSplash();
      setTimeout(function () {
        AUTH_goHome();
        setTimeout(hideSplash, 4400);
      }, 600);
    })
    .catch(function (err) {
      setLoad('l', false);
      var msg = (err.message || '').indexOf('Invalid') !== -1
        ? 'Wrong email or password.'
        : (err.message || 'Login failed.');
      AUTH_showMsg('err', msg);
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

  AUTH.register({
    email: email,
    password: pass,
    nickname: nick,
    phone: phone,
  })
    .then(function () {
      setLoad('r', false);
      AUTH_showMsg('ok', 'Account created! Your channel is being set up...');
      showSplash();
      setTimeout(function () {
        AUTH_goHome();
        setTimeout(hideSplash, 4400);
      }, 600);
    })
    .catch(function (err) {
      setLoad('r', false);
      var msg = (err.message || '').indexOf('already') !== -1
        ? 'This email is already registered.'
        : (err.message || 'Registration failed.');
      AUTH_showMsg('err', msg);
    });
};

// ── LOGOUT ───────────────────────────────────────
window.doLogout = function () {
  if (!confirm('Sign out of YID PLUS?')) return;
  AUTH.logout().then(function () {
    localStorage.removeItem('yp_page');
    toast('👋 Signed out successfully.');
    navTo('auth');
  }).catch(function (err) {
    toast('❌ ' + err.message);
  });
};

// ── RESTORE SAVED EMAIL ON PAGE LOAD ─────────────
document.addEventListener('DOMContentLoaded', function () {
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

  // NOTE: session restore (AUTH.restore()) + initial navTo()
  // is handled centrally in index.html's bottom script,
  // so we don't duplicate it here.
});

console.log('YID PLUS: auth.js loaded ✓ (Cloudflare D1 mode)');

// Real-time nickname availability check
var _nickCheckTimer = null;
window.checkNickAvail = function () {
  var inp  = document.getElementById('r-nick');
  var icon = document.getElementById('nick-avail-icon');
  if (!inp || !icon) return;
  var nick = inp.value.trim();
  clearTimeout(_nickCheckTimer);
  if (nick.length < 3) { icon.textContent = ''; return; }
  icon.textContent = '...';
  _nickCheckTimer = setTimeout(function () {
    api.get('/auth/check-nick?nick=' + encodeURIComponent(nick))
      .then(function (res) {
        icon.textContent = res.available ? '✅' : '❌';
        icon.title = res.available ? 'Available!' : 'Already taken';
      })
      .catch(function () { icon.textContent = ''; });
  }, 500);
};

// ── GOOGLE SIGN-IN ──
window.signInWithGoogle = function () {
  window.location.href = '/api/auth/google-login?return_to=' + encodeURIComponent('/');
};
