(function(){
var apply=window._applyFeatureFlags;
window._applyFeatureFlags=function(s){apply(s);document.documentElement.classList.add("yp-features-ready");};
Object.assign(PWA,{
  _dismissedRecently: function () {
    try {
      var t = parseInt(localStorage.getItem('yp_install_dismissed') || '0', 10);
      return !!t;
    } catch (e) { return false; }
  },

  initInstallPrompt: function () {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      window.PWA._deferredPrompt = e;
      window.PWA._queueBanner('android');
    });
    window.addEventListener('appinstalled', function () {
      window.PWA._hideBanner();
      try { localStorage.setItem('yp_install_dismissed', String(Date.now())); } catch (e) {}
      toast('✅ YID PLUS installed!');
    });
    // iOS gets a delayed hint banner (no native prompt exists there).
    if (PWA.isIOS() && !PWA.isStandalone() && !PWA._dismissedRecently()) {
      PWA._queueBanner('ios');
    }
  },

  // Suggest installation only after meaningful browsing, never over media/chat.
  _queueBanner: function (mode) {
    var visits = 0;
    try { visits = Number(sessionStorage.getItem('yp_browse_pages') || 0) + 1; sessionStorage.setItem('yp_browse_pages', String(visits)); } catch (e) {}
    if (visits < 2) return;
    setTimeout(function () {
      if (!document.hidden && !/chat|shorts|music|admin/.test(location.pathname) && /^(home|explore|profile)$/.test(STATE.screen)) PWA._showBanner(mode);
    }, 60000);
  },

  _buildBanner: function () {
    if (document.getElementById('pwa-install-banner')) return;
    var el = document.createElement('div');
    el.id = 'pwa-install-banner';
    el.className = 'pwa-install-banner';
    el.innerHTML =
      '<img src="/images/icon-192.png" alt="" class="pwa-ib-icon">' +
      '<div class="pwa-ib-body">' +
        '<div class="pwa-ib-title">YID PLUS</div>' +
        '<div class="pwa-ib-sub" id="pwa-ib-sub"></div>' +
      '</div>' +
      '<button class="pwa-ib-cta" id="pwa-ib-cta">Install</button>' +
      '<button class="pwa-ib-close" id="pwa-ib-close" aria-label="Close">✕</button>';
    var host = document.querySelector('.screen.active .scroll-area') || document.body;
    host.insertBefore(el, host.firstChild);
    document.getElementById('pwa-ib-close').onclick = function () { PWA._dismissBanner(); };
    document.getElementById('pwa-ib-cta').onclick = function () { PWA.install(); };
  },

  _showBanner: function (mode, manual) {
    if (PWA.isStandalone() || (!manual && PWA._dismissedRecently())) return;
    PWA._buildBanner();
    var el  = document.getElementById('pwa-install-banner');
    var host = document.querySelector('.screen.active .scroll-area') || document.body;
    host.insertBefore(el, host.firstChild);
    if (manual && host.scrollTo) host.scrollTo({top:0,behavior:'smooth'});
    var sub = document.getElementById('pwa-ib-sub');
    var cta = document.getElementById('pwa-ib-cta');
    if (mode === 'ios') {
      sub.innerHTML = 'To install: tap Share, then “Add to Home Screen”.';
      cta.style.display = 'none';
    } else {
      sub.textContent = 'Install the app for a faster, full-screen experience.';
      cta.style.display = '';
    }
    // next frame so the CSS transition runs
    requestAnimationFrame(function () { el.classList.add('show'); });
  },

  _hideBanner: function () {
    var el = document.getElementById('pwa-install-banner');
    if (el) el.classList.remove('show');
  },

  _dismissBanner: function () {
    PWA._hideBanner();
    try { localStorage.setItem('yp_install_dismissed', String(Date.now())); } catch (e) {}
  },

  install: function () {
    var prompt = window.PWA._deferredPrompt;
    if (!prompt) {
      if (PWA.isIOS()) { PWA._showBanner('ios', true); toast('Tap Share → “Add to Home Screen”'); }
      else toast('Open your browser menu → “Install app”');
      return;
    }
    prompt.prompt();
    prompt.userChoice.then(function (result) {
      if (result.outcome === 'accepted') toast('Installing YID PLUS...');
      window.PWA._deferredPrompt = null;
      PWA._hideBanner();
    });
  },
});
window._showGuestLoginPopup = function (msg) {
  var existing = document.getElementById('guest-login-popup');
  if (existing) { existing.remove(); return; }

  var overlay = document.createElement('div');
  overlay.id = 'guest-login-popup';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:1.5rem';
  overlay.innerHTML =
    '<div style="background:var(--surface);border-radius:20px;padding:2rem 1.5rem;width:100%;max-width:340px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.3)">' +
      '<img src="/images/logo.png?v=6" alt="YID PLUS" style="height:42px;width:auto;object-fit:contain;margin-bottom:.9rem" onerror="this.style.display=\'none\'">' +
      '<div style="font-size:.85rem;color:var(--muted);margin-bottom:1.25rem;line-height:1.5">' +
        escHtml(typeof msg === 'string' && msg ? msg : 'Sign in to interact with the YID PLUS community') +
      '</div>' +
      '<button onclick="_guestGoSignIn()" style="width:100%;padding:.75rem;background:linear-gradient(135deg,#1F6F5C,#2B8A73);color:#fff;border:none;border-radius:14px;font-size:.95rem;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:.5rem;display:flex;align-items:center;justify-content:center;gap:.5rem">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>' +
        'Sign In' +
      '</button>' +
      '<button onclick="this.closest(\'div[style*=fixed]\').remove()" style="width:100%;padding:.6rem;background:var(--bg3);border:none;border-radius:14px;font-size:.88rem;cursor:pointer;font-family:inherit;color:var(--muted)">Continue Browsing</button>' +
    '</div>';

  overlay.addEventListener('click', function(e){ if(e.target===overlay) overlay.remove(); });
  document.body.appendChild(overlay);
};
})();
