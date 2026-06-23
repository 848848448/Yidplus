// ads.js — fullscreen ad overlay system
// Each ad has its own independent timer/schedule
// Loaded on every page via <script src="js/ads.js">

(function () {

var AD_STATE = {};   // { [adId]: { lastShown: timestamp } }
var AD_LIST  = [];
var AD_TIMERS = {};  // { [adId]: timerHandle }
var _overlayEl = null;

// ── Init ──────────────────────────────────────────────────────────────────────
window.initAds = function (currentPage) {
  if (!currentPage) currentPage = 'all';
  _buildOverlay();
  api.get('/ads')
    .then(function (res) {
      AD_LIST = (res.ads || []).filter(function (a) {
        return a.pages === 'all' || a.pages === currentPage ||
               (a.pages || '').split(',').map(function(p){return p.trim();}).includes(currentPage);
      });
      AD_LIST.forEach(function (ad) {
        AD_STATE[ad.id] = AD_STATE[ad.id] || { lastShown: 0 };
        _scheduleAd(ad);
      });
    })
    .catch(function () {});
};

function _scheduleAd(ad) {
  clearTimeout(AD_TIMERS[ad.id]);
  var intervalMs  = (ad.interval_minutes || 60) * 60 * 1000;
  var lastShown   = AD_STATE[ad.id].lastShown || 0;
  var now         = Date.now();
  var elapsed     = now - lastShown;
  var delay       = Math.max(0, intervalMs - elapsed);

  // First time — show after 3 seconds so page can load
  if (!lastShown) delay = 3000;

  AD_TIMERS[ad.id] = setTimeout(function () {
    _showAd(ad);
  }, delay);
}

function _showAd(ad) {
  AD_STATE[ad.id].lastShown = Date.now();

  var ov = document.getElementById('ad-fullscreen-overlay');
  if (!ov) return;

  // Fill content
  var body = document.getElementById('ad-body');
  body.innerHTML = '';

  if (ad.media_url && ad.is_video) {
    var vid = document.createElement('video');
    vid.src = ad.media_url;
    vid.autoplay = true;
    vid.loop = false;
    vid.muted = false;
    vid.playsInline = true;
    vid.style.cssText = 'max-width:100%;max-height:55vh;border-radius:12px;display:block;margin:0 auto';
    body.appendChild(vid);
  } else if (ad.media_url) {
    var img = document.createElement('img');
    img.src = ad.media_url;
    img.style.cssText = 'max-width:100%;max-height:55vh;border-radius:12px;display:block;margin:0 auto;object-fit:contain';
    body.appendChild(img);
  }

  // Link / email
  var link = ad.link_url || ad.email_url;
  if (link) {
    var btn = document.createElement('a');
    btn.href = ad.email_url ? ('mailto:' + ad.email_url) : ad.link_url;
    btn.target = '_blank';
    btn.rel = 'noopener';
    btn.style.cssText = 'display:block;margin:1rem auto 0;text-align:center;background:var(--blue);color:#fff;padding:.75rem 2rem;border-radius:24px;font-weight:700;font-size:.95rem;text-decoration:none;max-width:220px';
    btn.textContent = ad.email_url ? 'Contact Us' : 'Learn More';
    body.appendChild(btn);
  }

  // Countdown
  var countdown = ad.countdown_seconds || 5;
  var skipEl    = document.getElementById('ad-skip-btn');
  var countEl   = document.getElementById('ad-countdown');
  skipEl.style.display = 'none';
  countEl.textContent  = countdown;

  var remaining = countdown;
  var ticker = setInterval(function () {
    remaining--;
    if (remaining <= 0) {
      clearInterval(ticker);
      countEl.textContent = '';
      skipEl.style.display = 'block';
    } else {
      countEl.textContent = remaining;
    }
  }, 1000);

  ov.dataset.ticker = ticker; // store so we can clear on manual close
  ov.style.display  = 'flex';

  // Re-schedule NEXT show of this ad
  var intervalMs = (ad.interval_minutes || 60) * 60 * 1000;
  AD_TIMERS[ad.id] = setTimeout(function () { _showAd(ad); }, intervalMs);
}

window.closeAdOverlay = function () {
  var ov = document.getElementById('ad-fullscreen-overlay');
  if (!ov) return;
  clearInterval(parseInt(ov.dataset.ticker || '0'));
  ov.style.display = 'none';
  document.getElementById('ad-body').innerHTML = '';
};

// ── Build overlay DOM (once) ──────────────────────────────────────────────────
function _buildOverlay() {
  if (document.getElementById('ad-fullscreen-overlay')) return;
  var ov = document.createElement('div');
  ov.id = 'ad-fullscreen-overlay';
  ov.style.cssText = [
    'display:none',
    'position:fixed',
    'inset:0',
    'z-index:9999',
    'background:rgba(0,0,0,.92)',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'padding:1.5rem',
    'pointer-events:all',
  ].join(';');

  ov.innerHTML =
    '<div id="ad-body" style="width:100%;max-width:480px"></div>' +
    '<div style="margin-top:1.5rem;display:flex;align-items:center;gap:1rem">' +
      '<div id="ad-countdown" style="min-width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,.12);color:#fff;font-size:.9rem;font-weight:700;display:flex;align-items:center;justify-content:center"></div>' +
      '<button id="ad-skip-btn" onclick="closeAdOverlay()" style="display:none;background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:20px;padding:.45rem 1.25rem;font-size:.85rem;cursor:pointer;font-weight:600">Skip →</button>' +
    '</div>';

  document.body.appendChild(ov);
}

}());
