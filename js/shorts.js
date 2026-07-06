// ============================================================
// js/shorts.js — Shorts feed (Cloudflare D1 + R2)
// Uses: api, STATE, toast, escHtml, fmtN
// Screen: #screen-shorts (full-screen swipe video feed)
// ============================================================

var SHORTS_data = [];
var SHORTS_curIdx = 0;
var SHORTS_observer = null;
var SHORTS_soundOn = false;       // once unmuted (by any user gesture), stays on for the rest of the session
var SHORTS_pendingFile = null;    // video file waiting on the caption modal before upload

window.init_shorts = function () {
  var cont = document.getElementById('swipe-cont');
  if (window.FeatureBlock && cont) {
    FeatureBlock.guard('shorts', cont).then(function (blocked) {
      if (!blocked) loadShortsFeed();
    });
  } else {
    loadShortsFeed();
  }
};

function loadShortsFeed() {
  var cont = document.getElementById('swipe-cont');
  if (!cont) return;
  // Lock scroll to snap exactly one slide at a time
  cont.style.cssText = 'height:100vh;width:100%;overflow-y:scroll;scroll-snap-type:y mandatory;scrollbar-width:none;-webkit-overflow-scrolling:touch;overscroll-behavior:none';
  cont.innerHTML = '<div class="feed-state" style="height:100vh;color:#fff"><div class="spinner"></div><div>Loading shorts...</div></div>';

  api.get('/shorts')
    .then(function (res) {
      SHORTS_data = res.shorts || [];
      var sharedId = (window.location.hash || '').replace('#', '');
      if (sharedId && !SHORTS_data.some(function (s) { return s.id === sharedId; })) {
        // The shared short might be older than the top-50 feed — fetch it
        // directly and put it at the front so a shared link actually opens
        // the short that was shared, not just the generic feed top.
        return api.get('/shorts?id=' + encodeURIComponent(sharedId))
          .then(function (r2) {
            if (r2.shorts && r2.shorts.length) SHORTS_data.unshift(r2.shorts[0]);
          })
          .catch(function () {})
          .then(function () { renderShorts(); _scrollToSharedShort(sharedId); });
      }
      renderShorts();
      if (sharedId) _scrollToSharedShort(sharedId);
    })
    .catch(function (err) {
      cont.innerHTML = '<div class="feed-state" style="height:100vh;color:#fff">' +
        '<div style="font-size:2.5rem">⚠️</div><div>Could not load shorts</div>' +
        '<div style="font-size:.75rem;opacity:.7">' + escHtml(err.message) + '</div>' +
        '<button class="feed-retry" onclick="loadShortsFeed()">Try Again</button></div>';
    });
}
window.loadShortsFeed = loadShortsFeed;

function _scrollToSharedShort(id) {
  setTimeout(function () {
    var idx = SHORTS_data.findIndex(function (s) { return s.id === id; });
    if (idx < 0) return;
    var cont = document.getElementById('swipe-cont');
    var slide = cont && cont.children[idx];
    if (slide) slide.scrollIntoView({ block: 'start' });
  }, 100);
}

// ── Icon set (matches the modern SVG style used across the rest of the app) ──
var ICON_HEART_OUTLINE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
var ICON_HEART_FILLED  = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
var ICON_COMMENT       = '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
var ICON_SHARE         = '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>';
var ICON_TRASH         = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
var ICON_PLAY          = '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
var ICON_PAUSE         = '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
var ICON_EYE           = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
var ICON_PLUS          = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

function renderShorts() {
  var cont = document.getElementById('swipe-cont');
  if (!cont) return;

  if (!SHORTS_data.length) {
    cont.innerHTML = '<div class="feed-state" style="height:100vh;color:#fff">' +
      '<div style="font-size:2.5rem">🎬</div><div>No shorts yet</div>' +
      '<div style="font-size:.75rem;opacity:.7">Tap + to upload the first one!</div></div>';
    return;
  }

  cont.innerHTML = '';

  SHORTS_data.forEach(function (s, i) {
    var slide = document.createElement('div');
    slide.className = 'short-slide';
    slide.dataset.idx = i;

    var avatarHtml = s.photo_url
      ? '<div class="short-avatar" style="background-image:url(' + s.photo_url + ');background-size:cover;background-position:center"></div>'
      : '<div class="short-avatar">' + escHtml((s.nick || '?').slice(0, 1).toUpperCase()) + '</div>';

    var tagsHTML = '#YidPlus #JewishContent';
    var verifiedBadge = s.verified ? '<span style="font-size:.75rem">✅</span>' : '';
    var likedIcon = s.liked ? ICON_HEART_FILLED : ICON_HEART_OUTLINE;
    var likedClass = s.liked ? ' liked' : '';

    slide.innerHTML =
      '<video class="slide-video" src="' + s.media_url + '" playsinline preload="none" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000"></video>' +
      '<div class="slide-grad"></div>' +
      '<div class="center-flash" id="flash-' + i + '"></div>' +
      '<div class="scrub-wrap" id="scrub-' + i + '">' +
        '<div class="scrub-track" id="scrub-track-' + i + '">' +
          '<div class="scrub-fill" id="scrub-fill-' + i + '"></div>' +
          '<div class="scrub-handle" id="scrub-handle-' + i + '"></div>' +
        '</div>' +
      '</div>' +
      '<div class="slide-info">' +
        '<div class="short-channel" onclick="event.stopPropagation();openShortChannel(' + i + ')">' +
          avatarHtml +
          '<span class="short-nick">@' + escHtml(s.nick) + '</span>' + verifiedBadge +
        '</div>' +
        '<div class="short-caption">' + escHtml(s.caption || '') + '</div>' +
        '<div class="short-tags"><span class="short-tag">' + tagsHTML + '</span></div>' +
      '</div>' +
      '<div class="slide-actions">' +
        '<div class="action-avatar-wrap" onclick="event.stopPropagation();openShortChannel(' + i + ')">' +
          '<div class="action-avatar"' + (s.photo_url ? ' style="background-image:url(' + s.photo_url + ');background-size:cover;background-position:center"' : '') + '>' + (s.photo_url ? '' : escHtml((s.nick || '?').slice(0, 1).toUpperCase())) + '</div>' +
          '<div class="action-avatar-plus">' + ICON_PLUS + '</div>' +
        '</div>' +
        '<div class="s-action' + likedClass + '" id="like-' + i + '" onclick="toggleShortLike(' + i + ')">' +
          '<div class="s-icon" id="like-icon-' + i + '">' + likedIcon + '</div><div class="s-count" id="like-count-' + i + '">' + fmtN(s.likes) + '</div>' +
        '</div>' +
        '<div class="s-action" onclick="openComments(' + i + ')">' +
          '<div class="s-icon">' + ICON_COMMENT + '</div><div class="s-count">Chat</div>' +
        '</div>' +
        '<div class="s-action" onclick="shareShort(' + i + ')">' +
          '<div class="s-icon">' + ICON_SHARE + '</div><div class="s-count">Share</div>' +
        '</div>' +
        (canDeleteShort(s) ?
        '<div class="s-action" onclick="deleteShort(\'' + s.id + '\',' + i + ')">' +
          '<div class="s-icon">' + ICON_TRASH + '</div><div class="s-count">Del</div>' +
        '</div>' : '') +
        '<div class="view-count" id="views-' + i + '">' + ICON_EYE + '<span>' + fmtN(s.views || 0) + '</span></div>' +
      '</div>';

    var video = slide.querySelector('.slide-video');
    video.muted = !SHORTS_soundOn; // honor the session-wide sound preference
    video.loop  = true;

    _wireSlideInteractions(slide, video, i);

    cont.appendChild(slide);
  });

  setupShortsObserver();
}

// All tap / scrub / double-tap-like interaction logic for one slide.
function _wireSlideInteractions(slide, video, i) {
  var scrubWrap  = slide.querySelector('#scrub-' + i);
  var scrubTrack = slide.querySelector('#scrub-track-' + i);
  var scrubFill  = slide.querySelector('#scrub-fill-' + i);
  var scrubHandle = slide.querySelector('#scrub-handle-' + i);
  var flashEl    = slide.querySelector('#flash-' + i);
  var hideTimer  = null;
  var isScrubbing = false;

  function showScrub() {
    scrubWrap.classList.add('show');
    clearTimeout(hideTimer);
    if (!isScrubbing) {
      hideTimer = setTimeout(function () { scrubWrap.classList.remove('show'); }, 2500);
    }
  }

  function updateScrubFromTime() {
    if (!video.duration || isScrubbing) return;
    var pct = (video.currentTime / video.duration) * 100;
    scrubFill.style.width = pct + '%';
    scrubHandle.style.left = pct + '%';
  }

  video.addEventListener('timeupdate', function () {
    updateScrubFromTime();
    if (!isScrubbing) showScrub();
  });
  video.addEventListener('play', showScrub);

  function seekFromClientX(clientX) {
    var rect = scrubTrack.getBoundingClientRect();
    var pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    scrubFill.style.width = (pct * 100) + '%';
    scrubHandle.style.left = (pct * 100) + '%';
    if (video.duration) video.currentTime = pct * video.duration;
  }

  scrubTrack.addEventListener('touchstart', function (e) {
    isScrubbing = true;
    showScrub();
    seekFromClientX(e.touches[0].clientX);
  }, { passive: true });
  scrubTrack.addEventListener('touchmove', function (e) {
    if (!isScrubbing) return;
    seekFromClientX(e.touches[0].clientX);
  }, { passive: true });
  scrubTrack.addEventListener('touchend', function () {
    isScrubbing = false;
    showScrub();
  });
  scrubTrack.addEventListener('touchcancel', function () {
    isScrubbing = false;
    showScrub();
  });

  // Tap anywhere on the video (not on a button/action) toggles play/pause,
  // with a brief icon flash that fades on its own — never stays on screen.
  function flashIcon(svg) {
    flashEl.innerHTML = svg;
    flashEl.classList.add('show');
    setTimeout(function () { flashEl.classList.remove('show'); }, 500);
  }

  slide.addEventListener('click', function (e) {
    if (e.target.closest('.s-action') || e.target.closest('.short-channel') ||
        e.target.closest('.action-avatar-wrap') || e.target.closest('.scrub-wrap') ||
        e.target.tagName === 'BUTTON') return;

    if (video.paused) {
      video.play().catch(function () {});
      flashIcon(ICON_PLAY);
    } else {
      video.pause();
      flashIcon(ICON_PAUSE);
    }
  });

  // Double tap to like
  var lastTap = 0;
  slide.addEventListener('touchend', function (e) {
    if (e.target.closest('.scrub-wrap')) return;
    var now = Date.now();
    if (now - lastTap < 300) doubleTapLike(i, slide);
    lastTap = now;
  });
  slide.addEventListener('dblclick', function () { doubleTapLike(i, slide); });
}

function canDeleteShort(s) {
  if (!STATE.user) return false;
  return s.owner_id === STATE.user.id || isAnyAdmin();
}

function setupShortsObserver() {
  if (SHORTS_observer) SHORTS_observer.disconnect();

  // Prevent fast swipes from flying past multiple slides
  var cont = document.getElementById('swipe-cont');
  var _isScrolling = false;
  if (cont) {
    cont.addEventListener('touchstart', function () { _isScrolling = false; }, { passive: true });
    cont.addEventListener('scroll', function () {
      if (_isScrolling) return;
      _isScrolling = true;
      // After scroll snaps, disable scroll briefly to prevent chaining
      cont.style.overflow = 'hidden';
      setTimeout(function () { cont.style.overflow = ''; _isScrolling = false; }, 600);
    }, { passive: true });
  }

  SHORTS_observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var video = entry.target.querySelector('.slide-video');
      var idx = parseInt(entry.target.dataset.idx, 10);

      if (entry.isIntersecting && entry.intersectionRatio > 0.85) {
        SHORTS_curIdx = idx;
        // Preload this video immediately when it becomes active
        if (video.preload === 'none') video.preload = 'auto';

        // Track a view exactly once per short per page load.
        var s = SHORTS_data[idx];
        if (s && !s._viewed) {
          s._viewed = true;
          api.put('/shorts', { id: s.id, view: true })
            .then(function (res) {
              var el = document.getElementById('views-' + idx);
              if (el && typeof res.views === 'number') {
                el.querySelector('span').textContent = fmtN(res.views);
              }
            })
            .catch(function () {});
        }

        // Auto-advance + autoplay: the moment a slide becomes the active
        // one (via swipe), it starts playing on its own — no tap needed.
        video.currentTime = 0;
        video.muted = !SHORTS_soundOn;
        var playAttempt = video.play();
        if (playAttempt && playAttempt.catch) {
          playAttempt.catch(function () {
            // Browser blocked unmuted autoplay (no user gesture yet this
            // session) — fall back to muted so playback never stalls.
            video.muted = true;
            video.play().catch(function () {});
          });
        }
      } else {
        video.pause();
      }
    });
  }, { threshold: 0.85 });

  document.querySelectorAll('.short-slide').forEach(function (s) { SHORTS_observer.observe(s); });
}

// The first tap/interaction anywhere unlocks sound for the rest of the
// session (browsers block unmuted autoplay without a prior user gesture).
// There is no persistent mute toggle anymore — sound simply turns on
// permanently the moment the user interacts at all.
function _unlockSoundOnce() {
  if (SHORTS_soundOn) return;
  SHORTS_soundOn = true;
  document.querySelectorAll('.slide-video').forEach(function (v) { v.muted = false; });
  document.removeEventListener('touchstart', _unlockSoundOnce);
  document.removeEventListener('click', _unlockSoundOnce);
}
document.addEventListener('touchstart', _unlockSoundOnce, { passive: true });
document.addEventListener('click', _unlockSoundOnce);

// ── LIKE ──
function doubleTapLike(i, slide) {
  if (!SHORTS_data[i].liked) toggleShortLike(i);
  var burst = document.createElement('div');
  burst.className = 'heart-burst';
  burst.innerHTML = '<svg width="64" height="64" viewBox="0 0 24 24" fill="#ff3b5c"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
  slide.appendChild(burst);
  setTimeout(function () { burst.remove(); }, 900);
}

window.toggleShortLike = function (i) {
  if (!STATE.user) return toast('⚠ Please sign in first.');
  var s = SHORTS_data[i];
  var newLiked = !s.liked;

  api.put('/shorts', { id: s.id, like: newLiked })
    .then(function (res) {
      s.liked = newLiked;
      s.likes = res.likes;
      var el = document.getElementById('like-' + i);
      var icon = document.getElementById('like-icon-' + i);
      var count = document.getElementById('like-count-' + i);
      icon.innerHTML = newLiked ? ICON_HEART_FILLED : ICON_HEART_OUTLINE;
      el.classList.toggle('liked', newLiked);
      count.textContent = fmtN(s.likes);
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

// ── CHANNEL ──
window.openShortChannel = function (i) {
  var s = SHORTS_data[i];
  if (!s) return;
  // Try to open profile on dashboard if available
  if (typeof openUserProfile === 'function') {
    goPage('/');
    setTimeout(function () {
      if (typeof openUserProfile === 'function') openUserProfile(s.owner_id);
    }, 600);
  } else {
    goPage('/?channel=' + encodeURIComponent(s.owner_id));
  }
};

// ── SHARE ──
window.shareShort = function (i) {
  var s = SHORTS_data[i];
  var url = window.location.origin + '/shorts#' + s.id;
  if (navigator.share) {
    navigator.share({ title: 'YID PLUS', text: 'Check out this short!', url: url });
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(function () { toast('🔗 Link copied!'); });
  } else {
    toast('🔗 ' + url);
  }
};

// ── DELETE ──
window.deleteShort = function (id, i) {
  if (!confirm('Delete this short?')) return;
  api.del('/shorts?id=' + encodeURIComponent(id))
    .then(function () {
      SHORTS_data.splice(i, 1);
      renderShorts();
      toast('🗑 Deleted.');
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

// ============================================================
// COMMENTS DRAWER
// ============================================================
window.openComments = function (idx) {
  SHORTS_curIdx = idx;
  var s = SHORTS_data[idx];
  var list = document.getElementById('cmt-list');
  var countEl = document.getElementById('cmt-count');
  list.innerHTML = '<div class="feed-state" style="color:#fff"><div class="spinner"></div></div>';
  document.getElementById('cmt-drawer').classList.add('open');

  api.get('/shorts/comments?short_id=' + encodeURIComponent(s.id))
    .then(function (res) {
      var comments = res.comments || [];
      countEl.textContent = '(' + comments.length + ')';
      if (!comments.length) {
        list.innerHTML = '<div style="text-align:center;padding:2rem 1rem;color:rgba(255,255,255,.4);font-size:.85rem">No comments yet.<br>Be the first!</div>';
        return;
      }
      list.innerHTML = comments.map(function (c) {
        return '<div class="comment">' +
          '<div class="c-avatar">' + escHtml((c.nickname || '?').slice(0, 1).toUpperCase()) + '</div>' +
          '<div class="c-body">' +
            '<div class="c-nick">@' + escHtml(c.nickname || 'User') + '</div>' +
            '<div class="c-text">' + escHtml(c.text) + '</div>' +
            '<div class="c-meta"><span class="c-time">' + timeAgo(c.created_at) + '</span></div>' +
          '</div>' +
        '</div>';
      }).join('');
    })
    .catch(function (err) {
      list.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--red);font-size:.85rem">' + escHtml(err.message) + '</div>';
    });
};

window.closeCmts = function () {
  document.getElementById('cmt-drawer').classList.remove('open');
};

window.sendCmt = function () {
  if (!STATE.user) return toast('⚠ Please sign in first.');
  var input = document.getElementById('cmt-input');
  var text = (input.value || '').trim();
  if (!text) return;
  var s = SHORTS_data[SHORTS_curIdx];

  api.post('/shorts/comments', { short_id: s.id, text: text })
    .then(function () {
      input.value = '';
      openComments(SHORTS_curIdx);
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

// ============================================================
// UPLOAD — picking a video opens a caption modal (no blocking prompt()),
// then the actual upload happens on "Post Short".
// ============================================================
window.handleVidUpload = function (e) {
  var file = e.target.files[0];
  if (!file) return;
  if (!STATE.user) return toast('⚠ Please sign in first.');

  SHORTS_pendingFile = file;
  document.getElementById('upload-modal').classList.remove('open');
  document.getElementById('caption-input').value = '';
  document.getElementById('caption-modal').classList.add('open');
  e.target.value = '';
};

window.cancelShortUpload = function () {
  SHORTS_pendingFile = null;
  document.getElementById('caption-modal').classList.remove('open');
};

window.confirmShortUpload = function () {
  if (!SHORTS_pendingFile) { document.getElementById('caption-modal').classList.remove('open'); return; }
  var caption = (document.getElementById('caption-input').value || '').trim();
  var file = SHORTS_pendingFile;
  SHORTS_pendingFile = null;

  document.getElementById('caption-modal').classList.remove('open');
  toast('📤 Uploading short...');

  watermarkFile(file).then(function (watermarked) {
    var form = new FormData();
    form.append('file', watermarked);
    form.append('caption', caption);
    return api.post('/shorts', form, true);
  })
    .then(function (res) {
      toast('✅ Uploaded!');
      SHORTS_data.unshift(res.short);
      renderShorts();
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

console.log('[YID PLUS] shorts.js loaded ✓');
