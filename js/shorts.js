// ============================================================
// js/shorts.js — Shorts feed (Cloudflare D1 + R2)
// Uses: api, STATE, toast, escHtml, fmtN
// Screen: #screen-shorts (full-screen swipe video feed)
// ============================================================

var SHORTS_data = [];
var SHORTS_curIdx = 0;
var SHORTS_observer = null;

window.init_shorts = function () {
  loadShortsFeed();
};

function loadShortsFeed() {
  var cont = document.getElementById('swipe-cont');
  if (!cont) return;
  cont.innerHTML = '<div class="feed-state" style="height:100vh;color:#fff"><div class="spinner"></div><div>Loading shorts...</div></div>';

  api.get('/shorts')
    .then(function (res) {
      SHORTS_data = res.shorts || [];
      renderShorts();
    })
    .catch(function (err) {
      cont.innerHTML = '<div class="feed-state" style="height:100vh;color:#fff">' +
        '<div style="font-size:2.5rem">⚠️</div><div>Could not load shorts</div>' +
        '<div style="font-size:.75rem;opacity:.7">' + escHtml(err.message) + '</div>' +
        '<button class="feed-retry" onclick="loadShortsFeed()">Try Again</button></div>';
    });
}
window.loadShortsFeed = loadShortsFeed;

function renderShorts() {
  var cont = document.getElementById('swipe-cont');
  var dotsEl = document.getElementById('prog-dots');
  if (!cont) return;

  if (!SHORTS_data.length) {
    cont.innerHTML = '<div class="feed-state" style="height:100vh;color:#fff">' +
      '<div style="font-size:2.5rem">🎬</div><div>No shorts yet</div>' +
      '<div style="font-size:.75rem;opacity:.7">Tap ＋ to upload the first one!</div></div>';
    if (dotsEl) dotsEl.innerHTML = '';
    return;
  }

  cont.innerHTML = '';
  if (dotsEl) dotsEl.innerHTML = '';

  SHORTS_data.forEach(function (s, i) {
    if (dotsEl) {
      var dot = document.createElement('div');
      dot.className = 'pdot' + (i === 0 ? ' active' : '');
      dotsEl.appendChild(dot);
    }

    var slide = document.createElement('div');
    slide.className = 'short-slide';
    slide.dataset.idx = i;

    var tagsHTML = '#YidPlus #JewishContent';
    var verifiedBadge = s.verified ? '<span style="font-size:.75rem">👑</span>' : '';
    var likedIcon = s.liked ? '❤️' : '🤍';
    var likedClass = s.liked ? ' liked' : '';

    slide.innerHTML =
      '<video class="slide-video" src="' + s.media_url + '" loop muted playsinline preload="metadata" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000"></video>' +
      '<div class="slide-grad"></div>' +
      '<div class="pause-indicator" id="pause-' + i + '">⏸</div>' +
      '<div class="slide-info">' +
        '<div class="short-channel" onclick="toast(\'Channel: @' + escHtml(s.nick) + '\')">' +
          '<div class="short-avatar">' + escHtml((s.nick || '?').slice(0, 1).toUpperCase()) + '</div>' +
          '<span class="short-nick">@' + escHtml(s.nick) + '</span>' + verifiedBadge +
        '</div>' +
        '<div class="short-caption">' + escHtml(s.caption || '') + '</div>' +
        '<div class="short-tags"><span class="short-tag">' + tagsHTML + '</span></div>' +
      '</div>' +
      '<div class="slide-actions">' +
        '<div class="action-avatar-wrap" onclick="toast(\'Channel: @' + escHtml(s.nick) + '\')">' +
          '<div class="action-avatar">' + escHtml((s.nick || '?').slice(0, 1).toUpperCase()) + '</div>' +
          '<div class="action-avatar-plus">+</div>' +
        '</div>' +
        '<div class="s-action' + likedClass + '" id="like-' + i + '" onclick="toggleShortLike(' + i + ')">' +
          '<div class="s-icon">' + likedIcon + '</div><div class="s-count" id="like-count-' + i + '">' + fmtN(s.likes) + '</div>' +
        '</div>' +
        '<div class="s-action" onclick="openComments(' + i + ')">' +
          '<div class="s-icon">💬</div><div class="s-count">Chat</div>' +
        '</div>' +
        '<div class="s-action" onclick="shareShort(' + i + ')">' +
          '<div class="s-icon">📤</div><div class="s-count">Share</div>' +
        '</div>' +
        (canDeleteShort(s) ?
        '<div class="s-action" onclick="deleteShort(\'' + s.id + '\',' + i + ')">' +
          '<div class="s-icon">🗑️</div><div class="s-count">Del</div>' +
        '</div>' : '') +
      '</div>';

    // tap to play/pause
    var video = slide.querySelector('.slide-video');
    slide.addEventListener('click', function (e) {
      if (e.target.closest('.s-action') || e.target.closest('.short-channel') || e.target.closest('.action-avatar-wrap')) return;
      if (video.paused) {
        video.play();
        document.getElementById('pause-' + i).classList.remove('show');
      } else {
        video.pause();
        document.getElementById('pause-' + i).classList.add('show');
      }
    });

    // double tap to like
    var lastTap = 0;
    slide.addEventListener('touchend', function () {
      var now = Date.now();
      if (now - lastTap < 300) doubleTapLike(i, slide);
      lastTap = now;
    });
    slide.addEventListener('dblclick', function () { doubleTapLike(i, slide); });

    cont.appendChild(slide);
  });

  setupShortsObserver();
}

function canDeleteShort(s) {
  if (!STATE.user) return false;
  return s.nick === STATE.user.nickname || isAnyAdmin();
}

function setupShortsObserver() {
  if (SHORTS_observer) SHORTS_observer.disconnect();

  SHORTS_observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var video = entry.target.querySelector('.slide-video');
      var idx = parseInt(entry.target.dataset.idx, 10);
      if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
        SHORTS_curIdx = idx;
        document.querySelectorAll('.pdot').forEach(function (d, i) {
          d.classList.toggle('active', i === idx);
        });
        video.currentTime = 0;
        video.play().catch(function () {});
      } else {
        video.pause();
      }
    });
  }, { threshold: 0.6 });

  document.querySelectorAll('.short-slide').forEach(function (s) { SHORTS_observer.observe(s); });
}

// ── LIKE ──
function doubleTapLike(i, slide) {
  if (!SHORTS_data[i].liked) toggleShortLike(i);
  var burst = document.createElement('div');
  burst.className = 'heart-burst';
  burst.textContent = '❤️';
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
      var icon = el.querySelector('.s-icon');
      var count = document.getElementById('like-count-' + i);
      icon.textContent = newLiked ? '❤️' : '🤍';
      el.classList.toggle('liked', newLiked);
      count.textContent = fmtN(s.likes);
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

// ── SHARE ──
window.shareShort = function (i) {
  var s = SHORTS_data[i];
  var url = window.location.origin + '/yidplus-shorts.html#' + s.id;
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
// UPLOAD
// ============================================================
window.handleVidUpload = function (e) {
  var file = e.target.files[0];
  if (!file) return;
  if (!STATE.user) return toast('⚠ Please sign in first.');

  document.getElementById('upload-modal').classList.remove('open');
  toast('📤 Uploading short...');

  var caption = prompt('Caption for your short (optional):') || '';

  var form = new FormData();
  form.append('file', file);
  form.append('caption', caption);

  api.post('/shorts', form, true)
    .then(function (res) {
      toast('✅ Uploaded!');
      SHORTS_data.unshift(res.short);
      renderShorts();
    })
    .catch(function (err) { toast('❌ ' + err.message); });

  e.target.value = '';
};

console.log('[YID PLUS] shorts.js loaded ✓');
