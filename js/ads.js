// ads.js — fullscreen ad overlay system
// Each ad has its own independent timer — never shows on page load,
// only after the scheduled interval has elapsed.
(function () {

var AD_STATE  = {};   // { [adId]: { lastShown: 0 } } — persisted in localStorage
var AD_LIST   = [];
var AD_TIMERS = {};

// Load persisted state
try {
  var stored = JSON.parse(localStorage.getItem('yp_ad_state') || '{}');
  AD_STATE = stored;
} catch(e) { AD_STATE = {}; }

function _saveState() {
  try { localStorage.setItem('yp_ad_state', JSON.stringify(AD_STATE)); } catch(e) {}
}

// ── Init ──────────────────────────────────────────────────────────────────────
window.initAds = function (currentPage) {
  if (!currentPage) currentPage = 'all';
  _buildOverlay();

  api.get('/ads')
    .then(function (res) {
      AD_LIST = (res.ads || []).filter(function (a) {
        if (!a || !a.id) return false;
        var pages = (a.pages || 'all').split(',').map(function(p){return p.trim();});
        return pages.includes('all') || pages.includes(currentPage);
      });

      AD_LIST.forEach(function (ad) {
        if (!AD_STATE[ad.id]) AD_STATE[ad.id] = { lastShown: 0 };
        _scheduleAd(ad);
      });
    })
    .catch(function () {});
};

function _scheduleAd(ad) {
  clearTimeout(AD_TIMERS[ad.id]);

  var intervalMs = Math.max(1, (ad.interval_minutes || 60)) * 60 * 1000;
  var lastShown  = AD_STATE[ad.id] ? AD_STATE[ad.id].lastShown : 0;
  var now        = Date.now();
  var elapsed    = now - lastShown;

  // Never show immediately on page load — always wait the full interval
  var delay = Math.max(intervalMs - elapsed, intervalMs);
  // But cap the first-ever delay so it actually shows within one interval
  if (!lastShown) delay = intervalMs;

  AD_TIMERS[ad.id] = setTimeout(function () {
    _showAd(ad);
  }, delay);
}

function _showAd(ad) {
  AD_STATE[ad.id] = { lastShown: Date.now() };
  _saveState();

  var ov = document.getElementById('ad-fullscreen-overlay');
  if (!ov) return;

  // Build content
  var body = document.getElementById('ad-body');
  body.innerHTML = '';

  if (ad.media_url && ad.is_video) {
    var vid = document.createElement('video');
    vid.src = ad.media_url;
    vid.autoplay = true;
    vid.muted = false;
    vid.playsInline = true;
    vid.controls = false;
    vid.style.cssText = 'max-width:100%;max-height:52vh;border-radius:12px;display:block;margin:0 auto';
    body.appendChild(vid);
  } else if (ad.media_url) {
    var img = document.createElement('img');
    img.src = ad.media_url;
    img.style.cssText = 'max-width:100%;max-height:52vh;border-radius:12px;display:block;margin:0 auto;object-fit:contain';
    body.appendChild(img);
  }

  // Link or email button
  var linkUrl   = ad.link_url   || '';
  var emailUrl  = ad.email_url  || '';
  if (linkUrl || emailUrl) {
    var btn = document.createElement('a');
    btn.href   = emailUrl ? ('mailto:' + emailUrl) : linkUrl;
    if (!emailUrl) { btn.target = '_blank'; btn.rel = 'noopener'; }
    btn.style.cssText = 'display:block;margin:1.1rem auto 0;text-align:center;background:#fff;color:#111;padding:.7rem 2rem;border-radius:24px;font-weight:700;font-size:.9rem;text-decoration:none;max-width:240px';
    btn.textContent = emailUrl ? ('Email: ' + emailUrl) : 'Learn More →';
    body.appendChild(btn);
  }

  // Countdown + skip
  var countdown = Math.max(1, ad.countdown_seconds || 5);
  var skipEl    = document.getElementById('ad-skip-btn');
  var countEl   = document.getElementById('ad-countdown');
  skipEl.style.display  = 'none';
  countEl.textContent   = countdown;
  countEl.style.display = 'flex';

  var remaining = countdown;
  var ticker = setInterval(function () {
    remaining--;
    if (remaining <= 0) {
      clearInterval(ticker);
      countEl.style.display = 'none';
      skipEl.style.display  = 'block';
    } else {
      countEl.textContent = remaining;
    }
  }, 1000);

  ov._ticker = ticker;
  ov.style.display = 'flex';

  // Schedule the next show of this ad
  var nextMs = (ad.interval_minutes || 60) * 60 * 1000;
  AD_TIMERS[ad.id] = setTimeout(function () { _showAd(ad); }, nextMs);
}

window.closeAdOverlay = function () {
  var ov = document.getElementById('ad-fullscreen-overlay');
  if (!ov) return;
  if (ov._ticker) clearInterval(ov._ticker);
  ov.style.display = 'none';
  var body = document.getElementById('ad-body');
  if (body) body.innerHTML = '';
};

// ── Build overlay DOM once ────────────────────────────────────────────────────
function _buildOverlay() {
  if (document.getElementById('ad-fullscreen-overlay')) return;

  var ov = document.createElement('div');
  ov.id = 'ad-fullscreen-overlay';
  ov.style.cssText = [
    'display:none',
    'position:fixed',
    'inset:0',
    'z-index:9999',
    'background:rgba(0,0,0,.93)',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'padding:1.5rem 1rem',
    'pointer-events:all',
    'touch-action:none',
  ].join(';');

  ov.innerHTML =
    '<div id="ad-body" style="width:100%;max-width:480px;text-align:center"></div>' +
    '<div style="margin-top:1.5rem;display:flex;align-items:center;justify-content:center;gap:1rem">' +
      '<div id="ad-countdown" style="min-width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.12);color:#fff;font-size:.95rem;font-weight:700;display:flex;align-items:center;justify-content:center"></div>' +
      '<button id="ad-skip-btn" onclick="closeAdOverlay()" style="display:none;background:rgba(255,255,255,.18);color:#fff;border:1px solid rgba(255,255,255,.35);border-radius:20px;padding:.5rem 1.4rem;font-size:.88rem;cursor:pointer;font-weight:700">Skip →</button>' +
    '</div>';

  document.body.appendChild(ov);
}

}());
