// ================================================
// js/app.js  —  Cloudflare D1 mode
//
// IMPORTANT: All global state, router (navTo), toast,
// role checks, settings, and utilities now live in
// js/state.js (loaded BEFORE this file).
//
// This file is intentionally tiny. It exists only for:
//   1. Backwards-compat with old code that still calls
//      a few app.js-specific helper names.
//   2. The "close menus on outside click" listener.
//
// REMOVED on purpose (these broke the SPA / duplicated
// state.js and caused conflicts):
//   - window.STATE / window.APP redeclare
//   - window.navTo redeclare + the yidplus-*.html redirects
//   - window.toast / setLoad / fmtN / escHtml / etc. redeclare
//   - role check redeclares (isOwner, isAnyAdmin, etc.)
//   - loadAppSettings / saveSetting (Supabase) redeclare
//   - the setInterval() that rewrote nav button onclicks
//     to redirect to separate yidplus-*.html pages
// ================================================

// ── CLOSE CONTEXT MENUS / ATTACH SHEETS ON OUTSIDE CLICK ──
// (state.js already registers one of these; this is safe
//  to keep as a no-op duplicate guard in case state.js
//  hasn't loaded yet for some reason)
if (!window._APP_outsideClickBound) {
  window._APP_outsideClickBound = true;
  document.addEventListener('click', function (e) {
    var m = document.getElementById('ctx-menu');
    if (m && !m.contains(e.target)) m.classList.remove('open');
    var a = document.getElementById('attach-sheet');
    if (a && !a.contains(e.target) && !e.target.closest('.attach-wrap')) {
      a.classList.remove('open');
    }
  });
}

console.log('[YID PLUS] app.js loaded ✓ (Cloudflare D1 mode — thin shim, see state.js)');
