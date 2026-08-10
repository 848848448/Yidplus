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
  if (typeof renderVerifyBanner === 'function') renderVerifyBanner();
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
window.doLogin = function (totpCode) {
  var email = (document.getElementById('l-email').value || '').trim();
  var pass  =  document.getElementById('l-pass').value  || '';
  AUTH_clearMsg();

  if (!email || !pass)     return AUTH_showMsg('err', 'Please fill in all fields.');
  if (!validEmail(email))  return AUTH_showMsg('err', 'Enter a valid email address.');

  setLoad('l', true);

  AUTH.login(email, pass, totpCode)
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
        setTimeout(hideSplash, 5000);
      }, 600);
    })
    .catch(function (err) {
      setLoad('l', false);
      // Account has two-factor on — ask for the 6-digit code and retry.
      if (err && err.data && err.data.need_2fa) {
        var code = prompt('🔐 Two-factor authentication\n\nEnter the 6-digit code from your authenticator app:');
        if (code && code.replace(/\D/g, '').length === 6) { window.doLogin(code.replace(/\D/g, '')); }
        else AUTH_showMsg('err', 'A 6-digit code is required to sign in.');
        return;
      }
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
    invite_code: (new URLSearchParams(location.search).get('invite') || '').trim(),
  })
    .then(function () {
      setLoad('r', false);
      AUTH_showMsg('ok', 'Account created! Your channel is being set up...');
      showSplash();
      setTimeout(function () {
        AUTH_goHome();
        setTimeout(hideSplash, 5000);
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
  _confirmWithPassword({
    title: 'Sign out',
    message: 'Enter your password to sign out.',
    actionText: 'Sign out',
    danger: false,
    onOk: function () {
      AUTH.logout().then(function () {
        localStorage.removeItem('yp_page');
        toast('👋 Signed out successfully.');
        navTo('auth');
      }).catch(function (err) {
        toast('❌ ' + err.message);
      });
    }
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

// If someone opens an invite link (?invite=CODE), jump straight to the Register
// tab and show that the invite was applied.
document.addEventListener('DOMContentLoaded', function () {
  try {
    var code = new URLSearchParams(location.search).get('invite');
    if (!code) return;
    setTimeout(function () {
      if (typeof authTab === 'function') authTab('register');
      var hint = document.getElementById('invite-hint');
      if (hint) hint.style.display = 'block';
    }, 400);
  } catch (e) {}
});

/* ── Soft "verify your email" reminder banner ──────────────────────────
   Shown at the top of the home screen when the account hasn't confirmed its
   email (and the requirement is on). Never blocks anything — dismissible for
   the session, with a one-tap Resend. */
window.renderVerifyBanner = function () {
  try {
    var show = STATE.user && STATE.user.unverified &&
               sessionStorage.getItem('yp_verify_dismissed') !== '1';
    var existing = document.getElementById('verify-banner');
    if (!show) { if (existing) existing.remove(); return; }
    if (existing) return;

    var home = document.getElementById('screen-home');
    if (!home) return;
    var b = document.createElement('div');
    b.id = 'verify-banner';
    b.style.cssText = 'display:flex;align-items:center;gap:.55rem;background:#FFF4E5;color:#7A4E00;' +
      'border-bottom:1px solid #F0C88A;padding:.6rem .85rem;font-size:.8rem;line-height:1.35';
    b.innerHTML =
      '<span style="font-size:1rem">📧</span>' +
      '<span style="flex:1">Please verify your email to secure your account.</span>' +
      '<button id="vb-resend" style="background:#1F6F5C;color:#fff;border:none;border-radius:14px;padding:.32rem .75rem;font-size:.72rem;font-weight:600;cursor:pointer;flex-shrink:0">Resend</button>' +
      '<button onclick="dismissVerifyBanner()" aria-label="Dismiss" style="background:none;border:none;color:inherit;font-size:1.15rem;line-height:1;cursor:pointer;padding:0 .15rem;flex-shrink:0">&times;</button>';
    home.insertBefore(b, home.firstChild);

    document.getElementById('vb-resend').onclick = function () {
      var btn = this; btn.disabled = true; btn.textContent = 'Sending…';
      api.post('/auth/send-verification', {})
        .then(function () { toast('📧 Verification email sent — check your inbox.'); })
        .catch(function (e) { toast('❌ ' + (e.message || 'Could not send')); })
        .then(function () { var el = document.getElementById('vb-resend'); if (el) { el.disabled = false; el.textContent = 'Resend'; } });
    };
  } catch (e) { /* a reminder banner must never break the app */ }
};

window.dismissVerifyBanner = function () {
  try { sessionStorage.setItem('yp_verify_dismissed', '1'); } catch (e) {}
  var b = document.getElementById('verify-banner');
  if (b) b.remove();
};
