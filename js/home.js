// ============================================================
// js/home.js  —  Home Dashboard
// Dynamic feed from Cloudflare D1 via /api/posts
// States: loading / empty / error / success
// Uses api/escHtml/fmtN/timeAgo/isAnyAdmin from js/state.js
// ============================================================

// ── LOCAL STATE ──────────────────────────────────────────
var HOME_adIdx    = 0;
var HOME_adRaf    = null;
var HOME_adStart  = 0;
var HOME_svUser   = null;
var HOME_svSlide  = 0;
var HOME_svTimer  = null;
var HOME_bcTimer  = null;

// ── STATIC DATA (Statuses + Ads stay local) ───────────────
var HOME_STATUSES = [
  { nick:'MosheMusic', emoji:'🎹', slides:[{bg:'#1a0a2e',text:'New niggun dropping Friday! 🎵',color:'#F0D080'},{bg:'#0a1a1a',text:'Studio session was fire 🎧',color:'#5DCAA5'}], time:'5m', viewed:false },
  { nick:'RebbeVibes', emoji:'📖', slides:[{bg:'#1a0f00',text:'Torah thought: Be kind 💛',color:'#F0D080'}], time:'12m', viewed:false },
  { nick:'ShlomoBeats',emoji:'🎤', slides:[{bg:'#001020',text:'Live performance SUNDAY! 🎤',color:'#85B7EB'}], time:'2h',  viewed:false },
  { nick:'KosherChef', emoji:'🥘', slides:[{bg:'#1a0a0a',text:'Cholent reveal TOMORROW 👀',color:'#F09595'}], time:'3h',  viewed:true  },
];
var HOME_ADS = [
  { title:"Moshe's Judaica",  sub:"Free worldwide shipping!",           icon:"🕎",  bg:"#1a1000", dur:5000 },
  { title:"Kosher Vacations", sub:"Exclusive glatt kosher resorts",      icon:"🏖️", bg:"#001a1a", dur:6000 },
  { title:"Torah Academy",    sub:"Learn with the best · Free trial!",   icon:"📚", bg:"#0a001a", dur:5000 },
];
var HOME_adIdx = 0;
var HOME_adRaf = null;

// ── ADS — loads real ads from /api/ads, falls back to demo set ──
function buildAds() {
  api.get('/ads')
    .then(function (res) {
      var ads = (res.ads || []).map(function (a) {
        return { title: a.title, sub: a.subtitle || '', icon: '📣', bg: '#1a1000', dur: 6000, media_url: a.media_url, link_url: a.link_url };
      });
      _renderAds(ads.length ? ads : HOME_ADS);
    })
    .catch(function () { _renderAds(HOME_ADS); });
}

function _renderAds(ads) {
  var frame = document.getElementById('ad-frame');
  var dots  = document.getElementById('ad-dots');
  if (!frame || !dots) return;
  frame.innerHTML = '<div id="ad-prog"></div>';
  dots.innerHTML = '';
  HOME_adIdx = 0;

  ads.forEach(function (ad, i) {
    var s = document.createElement('div');
    s.className = 'ad-slide' + (i === 0 ? ' active' : '');
    s.style.background = ad.bg || '#1a1000';
    s.style.cursor = ad.link_url ? 'pointer' : 'default';
    if (ad.link_url) s.onclick = function () { window.open(ad.link_url, '_blank'); };
    s.innerHTML = (ad.media_url ? '<img src="' + ad.media_url + '" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">' : '') +
      '<div style="position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:.3rem">' +
        '<div style="font-size:2.5rem">' + (ad.icon || '📣') + '</div>' +
        '<div class="ad-badge">Sponsored</div>' +
        '<div class="ad-title">' + escHtml(ad.title) + '</div>' +
        (ad.sub ? '<div class="ad-sub">' + escHtml(ad.sub) + '</div>' : '') +
      '</div>';
    frame.appendChild(s);
    var d = document.createElement('div');
    d.className = 'ad-dot' + (i === 0 ? ' active' : '');
    dots.appendChild(d);
  });

  if (ads.length > 1) _runAdRotation(ads);
}

function _runAdRotation(ads) {
  cancelAnimationFrame(HOME_adRaf);
  var start = performance.now();
  var dur = ads[HOME_adIdx].dur || 5000;
  var bar = document.getElementById('ad-prog');

  function tick(now) {
    var pct = Math.min(100, (now - start) / dur * 100);
    if (bar) bar.style.width = pct + '%';
    if (pct < 100) {
      HOME_adRaf = requestAnimationFrame(tick);
    } else {
      HOME_adIdx = (HOME_adIdx + 1) % ads.length;
      document.querySelectorAll('#ad-frame .ad-slide').forEach(function (s, i) { s.classList.toggle('active', i === HOME_adIdx); });
      document.querySelectorAll('#ad-dots .ad-dot').forEach(function (d, i) { d.classList.toggle('active', i === HOME_adIdx); });
      _runAdRotation(ads);
    }
  }
  HOME_adRaf = requestAnimationFrame(tick);
}

// ── SHORTS PREVIEW — loads real shorts from /api/shorts ──
function buildShortsPrev() {
  var row = document.getElementById('home-shorts');
  if (!row) return;
  row.innerHTML = '<div class="feed-state" style="padding:1rem"><div class="spinner"></div></div>';

  api.get('/shorts')
    .then(function (res) {
      var shorts = (res.shorts || []).slice(0, 8);
      if (!shorts.length) {
        row.innerHTML = '<div style="padding:1rem;font-size:.8rem;color:var(--muted)">No shorts yet</div>';
        return;
      }
      row.innerHTML = '';
      shorts.forEach(function (s) {
        var c = document.createElement('div');
        c.className = 'short-prev-card';
        c.style.cssText = 'flex-shrink:0;width:110px;height:185px;border-radius:12px;background:var(--bg2);border:1px solid var(--border);overflow:hidden;position:relative;cursor:pointer';
        c.onclick = function () { goPage('yidplus-shorts.html'); };
        c.innerHTML =
          '<video src="' + s.media_url + '" muted style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" preload="metadata"></video>' +
          '<div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.75),transparent 50%);display:flex;flex-direction:column;justify-content:flex-end;padding:.5rem">' +
            '<div style="font-size:.68rem;color:#fff;font-weight:700">@' + escHtml(s.nick) + '</div>' +
            '<div style="font-size:.65rem;color:rgba(255,255,255,.8)">❤️ ' + fmtN(s.likes) + '</div>' +
          '</div>';
        row.appendChild(c);
      });
    })
    .catch(function () {
      row.innerHTML = '<div style="padding:1rem;font-size:.8rem;color:var(--muted)">Could not load shorts</div>';
    });
}

// ── CHANNELS PREVIEW — loads real channels via /api/admin/users-like list ──
function buildChannelsPrev() {
  var row = document.getElementById('home-channels');
  if (!row) return;
  row.innerHTML = '<div class="feed-state" style="padding:1rem"><div class="spinner"></div></div>';

  api.get('/channels')
    .then(function (res) {
      var channels = (res.channels || []).slice(0, 8);
      if (!channels.length) {
        row.innerHTML = '<div style="padding:1rem;font-size:.8rem;color:var(--muted)">No channels yet</div>';
        return;
      }
      row.innerHTML = '';
      channels.forEach(function (c) {
        var card = document.createElement('div');
        card.className = 'ch-preview-card';
        card.style.cssText = 'flex-shrink:0;width:130px;background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:.9rem .75rem;text-align:center;cursor:pointer';
        card.onclick = function () { goPage('yidplus-dashboard.html?channel=' + c.owner_id); };
        card.innerHTML =
          '<div style="width:50px;height:50px;border-radius:50%;background:var(--bg3);margin:0 auto .5rem;display:flex;align-items:center;justify-content:center;font-size:1.3rem;font-weight:700;border:1.5px solid var(--border);position:relative">' +
            escHtml((c.nickname || '?').slice(0, 1).toUpperCase()) +
            (c.verified ? '<div style="position:absolute;top:-6px;right:-4px;font-size:.8rem">👑</div>' : '') +
          '</div>' +
          '<div style="font-size:.8rem;font-weight:700">' + escHtml(c.nickname) + '</div>' +
          '<div style="font-size:.65rem;color:var(--muted)">' + fmtN(c.followers || 0) + ' followers</div>';
        row.appendChild(card);
      });
    })
    .catch(function () {
      row.innerHTML = '<div style="padding:1rem;font-size:.8rem;color:var(--muted)">Could not load channels</div>';
    });
}

// ── INIT (called by router) ───────────────────────────────
window.init_home = function () {
  console.log('[HOME] init_home() called');
  buildStatusRow();
  buildAds();
  buildShortsPrev();
  buildChannelsPrev();
  loadDynamicFeed();      // ← Cloudflare D1 feed
  listenBroadcasts();
  if (typeof applyRoleUI  === 'function') applyRoleUI();
  if (typeof loadAppSettings === 'function') loadAppSettings();
};

// ══════════════════════════════════════════════════════════
//  DYNAMIC FEED — reads from /api/posts (D1-backed)
//  Row shape: { id, username, caption, content, likes,
//                comments, created_at }
//  'content' can be a URL or an emoji for preview
// ══════════════════════════════════════════════════════════
window.loadDynamicFeed = function () {
  var feed = document.getElementById('home-feed');
  if (!feed) {
    console.warn('[HOME] #home-feed element not found in DOM');
    return;
  }

  // ── 1. LOADING STATE ────────────────────────────────────
  console.log('[HOME] loadDynamicFeed() → fetching posts...');
  feed.innerHTML =
    '<div class="feed-state">' +
      '<div class="spinner"></div>' +
      '<div class="feed-state-text">Loading posts...</div>' +
    '</div>';

  // ── 2. FETCH FROM /api/posts ─────────────────────────────
  api.get('/posts')
    .then(function (res) {
      console.log('[HOME] /api/posts response:', res);

      var posts = res.posts || [];
      console.log('[HOME] Posts received:', posts.length);

      // ── 3. EMPTY STATE ─────────────────────────────────
      if (posts.length === 0) {
        console.log('[HOME] No posts in database yet');
        feed.innerHTML =
          '<div class="feed-state">' +
            '<div style="font-size:2.5rem">📭</div>' +
            '<div class="feed-state-text">No posts yet</div>' +
            '<div class="feed-state-sub">Be the first to share something!</div>' +
          '</div>';
        return;
      }

      // ── 4. SUCCESS — RENDER POSTS ──────────────────────
      console.log('[HOME] Rendering ' + posts.length + ' posts');
      feed.innerHTML = '';
      posts.forEach(function (p) {
        feed.appendChild(buildPostCard(p));
      });
    })
    .catch(function (err) {
      // ── 5. ERROR STATE ─────────────────────────────────
      console.error('[HOME] /api/posts error:', err.message);
      feed.innerHTML =
        '<div class="feed-state">' +
          '<div style="font-size:2rem">⚠️</div>' +
          '<div class="feed-state-text">Could not load posts.</div>' +
          '<div class="feed-state-sub">' + escHtml(err.message || 'Unknown error') + '</div>' +
          '<button class="feed-retry" onclick="loadDynamicFeed()">Try Again</button>' +
        '</div>';
    });
};

// ── BUILD ONE POST CARD ───────────────────────────────────
function buildPostCard(p) {
  var article = document.createElement('article');
  article.className  = 'feed-post';
  article.dataset.id = p.id;

  var nick    = p.username || 'Anonymous';
  var caption = p.caption  || '';
  var likes   = p.likes    || 0;
  var cmts    = p.comments || 0;
  var emoji   = /^[\p{Emoji}]+$/u.test(p.content || '') ? p.content : '🎬';
  var timeStr = p.created_at ? timeAgo(p.created_at) : '';

  article.innerHTML =
    // Header
    '<div style="display:flex;align-items:center;gap:.6rem;padding:.75rem;cursor:pointer" onclick="openChannel(\'' + escHtml(p.user_id || '') + '\')">' +
      '<div style="width:38px;height:38px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:1.1rem;border:1px solid var(--border);flex-shrink:0">' +
        escHtml(nick.charAt(0).toUpperCase()) +
      '</div>' +
      '<div>' +
        '<div style="font-size:.85rem;font-weight:700">@' + escHtml(nick) + '</div>' +
        '<div style="font-size:.65rem;color:var(--muted)">' + escHtml(timeStr) + '</div>' +
      '</div>' +
    '</div>' +
    // Thumbnail
    '<div class="post-thumb" onclick="toast(\'Opening post...\')">' +
      emoji +
      '<div class="post-play">▶</div>' +
    '</div>' +
    // Caption
    (caption ? '<div style="padding:.6rem .75rem;font-size:.82rem;color:var(--muted);border-bottom:.5px solid var(--border)">' + escHtml(caption) + '</div>' : '') +
    // Actions
    '<div style="display:flex;gap:1rem;padding:.75rem">' +
      '<button class="post-action" id="like-btn-' + p.id + '" onclick="handleLike(this,\'' + p.id + '\',' + likes + ')">' +
        '🤍 ' + fmtN(likes) +
      '</button>' +
      '<button class="post-action" onclick="toast(\'Comments coming soon\')">' +
        '💬 ' + fmtN(cmts) +
      '</button>' +
      '<button class="post-action" onclick="copyPostLink(\'' + p.id + '\')">' +
        '📤 Share' +
      '</button>' +
      // Delete button — only visible to admins
      (isAnyAdmin() ?
        '<button class="post-action" style="color:var(--red);margin-left:auto" data-role="admin" onclick="adminDeletePost(\'' + p.id + '\')">' +
          '🗑 Delete' +
        '</button>' : '') +
    '</div>';

  return article;
}

// ── POST ACTIONS ─────────────────────────────────────────
window.publishPost = function () {
  var ta = document.getElementById('new-post-content');
  if (!ta) return;
  var content = (ta.value || '').trim();

  if (!content) {
    toast('⚠ ביטע שרייב עפעס!');
    return;
  }
  if (!STATE.user) {
    toast('⚠ Please sign in first.');
    return;
  }

  api.post('/posts', {
    username: STATE.user.nickname || (STATE.user.email || '').split('@')[0],
    caption:  content,
    content:  '📝',
  }).then(function () {
    toast('✅ פאוסט ארויף!');
    ta.value = '';
    loadDynamicFeed(); // refresh feed so the new post shows up
  }).catch(function (err) {
    toast('❌ ' + err.message);
  });
};

window.handleLike = function (btn, postId, currentLikes) {
  var liked    = btn.classList.toggle('liked');
  var newCount = liked ? currentLikes + 1 : currentLikes - 1;
  btn.innerHTML = (liked ? '❤️ ' : '🤍 ') + fmtN(newCount);

  api.put('/posts', { id: postId, likes: newCount })
    .catch(function (err) {
      console.warn('[HOME] Like update error:', err.message);
    });
};

window.copyPostLink = function (postId) {
  var url = window.location.origin + window.location.pathname + '?post=' + postId;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(function () { toast('🔗 Link copied!'); });
  } else {
    toast('🔗 ' + url);
  }
};

window.adminDeletePost = function (postId) {
  if (!isAnyAdmin()) return;
  if (!confirm('Delete this post permanently?')) return;

  api.del('/posts?id=' + encodeURIComponent(postId))
    .then(function () {
      var card = document.querySelector('[data-id="' + postId + '"]');
      if (card) card.remove();
      toast('🗑 Post deleted.');
    })
    .catch(function (err) {
      toast('❌ Delete failed: ' + err.message);
    });
};

// ── BROADCASTS ───────────────────────────────────────────
function listenBroadcasts() {
  fetchLatestBroadcast();
  // Poll every 30s for new broadcasts (cheap "realtime" via D1)
  clearInterval(HOME_bcTimer);
  HOME_bcTimer = setInterval(fetchLatestBroadcast, 30000);
}
function fetchLatestBroadcast() {
  api.get('/broadcasts?limit=1')
    .then(function (res) {
      var list = res.broadcasts || [];
      if (list[0]) showBroadcast(list[0].text);
    })
    .catch(function () { /* silent */ });
}
function showBroadcast(text) {
  var bar = document.getElementById('broadcast-bar');
  if (!bar) return;
  bar.innerHTML =
    '<div style="margin:.5rem .75rem;background:rgba(201,168,76,.08);border:.5px solid var(--border2);border-radius:10px;padding:.65rem 1rem;display:flex;align-items:flex-start;gap:.6rem">' +
      '<span style="font-size:1rem;flex-shrink:0">📢</span>' +
      '<span style="font-size:.8rem;color:var(--gold-l);line-height:1.4;flex:1">' + escHtml(text) + '</span>' +
      '<button style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:1rem" onclick="this.parentElement.remove()">✕</button>' +
    '</div>';
}

// ══════════════════════════════════════════════════════════
//  STATUS / STORIES SYSTEM  (WhatsApp-style)
//  Features: progress bars, long-press pause, swipe nav,
//  emoji reactions, profile pictures, privacy, reply, archive
// ══════════════════════════════════════════════════════════

var HOME_svStatuses  = [];    // flat list: [{user_id, nickname, photo_url, slides:[...]}, ...]
var HOME_svUserIdx   = 0;
var HOME_svSlideIdx  = 0;
var HOME_svMuted     = false;
var HOME_svPaused    = false;
var HOME_svBarRaf    = null;
var HOME_svBarStart  = 0;
var HOME_svBarDur    = 5000;
var HOME_svLongTimer = null;   // distinguish tap vs long-press
var HOME_svPrivacy   = 'public'; // current user's privacy setting
var HOME_HIGHLIGHTS  = [];     // locally-saved highlights

function buildStatusRow() {
  var row = document.getElementById('status-row');
  if (!row) return;

  var meNick = (STATE.user && STATE.user.nickname) ? STATE.user.nickname : 'My Status';
  var meInitial = meNick.slice(0,1).toUpperCase();

  // "My Status" — always first, shows highlights indicator if archived
  row.innerHTML =
    '<div class="status-item" onclick="openStatusUpload()">' +
      '<div class="status-ring mine">' +
        '<div class="status-inner" id="my-status-av" style="font-size:.9rem;font-weight:700">' + meInitial + '</div>' +
        '<div class="status-plus">+</div>' +
      '</div>' +
      '<div class="status-name">My Status</div>' +
    '</div>' +
    (HOME_HIGHLIGHTS.length
      ? '<div class="status-item" onclick="openHighlightsModal()">' +
          '<div class="status-ring" style="border-color:#f59e0b">' +
            '<div class="status-inner">🔖</div>' +
          '</div>' +
          '<div class="status-name">Highlights</div>' +
        '</div>'
      : '');

  api.get('/statuses')
    .then(function (res) {
      HOME_svStatuses = res.statuses || [];
      var meId = STATE.user && STATE.user.id;
      // My own statuses first
      HOME_svStatuses.sort(function (a, b) {
        if (a.user_id === meId) return -1;
        if (b.user_id === meId) return 1;
        return 0;
      });

      // Update my own avatar with photo if available
      if (STATE.user && STATE.user.photo_url) {
        var myAv = document.getElementById('my-status-av');
        if (myAv) {
          myAv.style.backgroundImage = "url('" + STATE.user.photo_url + "')";
          myAv.style.backgroundSize = 'cover';
          myAv.style.backgroundPosition = 'center';
          myAv.textContent = '';
        }
      }

      HOME_svStatuses.forEach(function (s, i) {
        var isMine  = s.user_id === meId;
        var initial = (s.nickname || '?').slice(0,1).toUpperCase();
        var el = document.createElement('div');
        el.className = 'status-item';
        el.onclick   = function () { openSV(i); };

        var avatarContent = s.photo_url
          ? '<div style="width:100%;height:100%;border-radius:50%;background-image:url(\'' + s.photo_url + '\');background-size:cover;background-position:center"></div>'
          : '<div style="font-size:.9rem;font-weight:700">' + initial + '</div>';

        el.innerHTML =
          '<div class="status-ring' + (isMine ? ' mine' : '') + '">' +
            '<div class="status-inner">' + avatarContent + '</div>' +
          '</div>' +
          '<div class="status-name">' + escHtml(isMine ? 'My Status' : (s.nickname || 'User')) + '</div>';
        row.appendChild(el);
      });
    })
    .catch(function () {});
}

window.openSV = function (userIdx) {
  if (!HOME_svStatuses[userIdx]) return;
  HOME_svUserIdx  = userIdx;
  HOME_svSlideIdx = 0;
  _svShowSlide();
  document.getElementById('sv-overlay').classList.add('open');
  // Hide / show owner-only controls
  var meId = STATE.user && STATE.user.id;
  var isMyStatus = HOME_svStatuses[userIdx] && HOME_svStatuses[userIdx].user_id === meId;
  var menuDelete  = document.getElementById('sv-menu-delete');
  var menuPrivacy = document.getElementById('sv-menu-privacy');
  if (menuDelete)  menuDelete.style.display  = isMyStatus ? 'block' : 'none';
  if (menuPrivacy) menuPrivacy.style.display = isMyStatus ? 'block' : 'none';
};
window.openStatusViewer = window.openSV;

function _svShowSlide() {
  var s     = HOME_svStatuses[HOME_svUserIdx];
  if (!s || !s.slides || !s.slides.length) { closeSV(); return; }
  var slide = s.slides[HOME_svSlideIdx];
  if (!slide) { closeSV(); return; }

  cancelAnimationFrame(HOME_svBarRaf);
  HOME_svPaused = false;
  HOME_svBarDur = 5000;

  // ── Avatar (profile picture) ──
  var avEl = document.getElementById('sv-avatar');
  if (avEl) {
    if (s.photo_url) {
      avEl.style.backgroundImage = "url('" + s.photo_url + "')";
      avEl.textContent = '';
    } else {
      avEl.style.backgroundImage = '';
      avEl.textContent = (s.nickname || '?').slice(0,1).toUpperCase();
    }
  }

  document.getElementById('sv-nick').textContent = '@' + (s.nickname || 'User');
  document.getElementById('sv-time').textContent = slide.created_at ? timeAgo(slide.created_at) : 'now';

  // ── Progress bars ──
  var barsEl = document.getElementById('sv-bars');
  barsEl.innerHTML = s.slides.map(function (_, j) {
    return '<div class="sv-bar"><div class="sv-bar-fill' + (j < HOME_svSlideIdx ? ' done' : '') + '" id="svbar-' + j + '"></div></div>';
  }).join('');

  // ── Like button state ──
  var likeBtn = document.getElementById('sv-like-btn');
  if (likeBtn) likeBtn.textContent = slide.i_reacted ? '❤️' : '🤍';

  // ── Slide content ──
  var el = document.getElementById('sv-slide');
  el.innerHTML = '';
  el.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden';

  if (slide.type === 'media' && slide.media_url) {
    var isVideo = /\.(mp4|webm|mov|avi)$/i.test(slide.media_url);
    if (isVideo) {
      var vid = document.createElement('video');
      vid.src = slide.media_url;
      vid.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
      vid.autoplay = true;
      vid.loop     = false;
      vid.muted    = HOME_svMuted;
      vid.playsInline = true;
      vid.onloadedmetadata = function () {
        HOME_svBarDur = (vid.duration || 5) * 1000;
        _svStartBar();
      };
      vid.onended = function () { window.svNext(); };
      el.style.background = '#000';
      el.appendChild(vid);
    } else {
      el.style.background = '#000';
      var img = document.createElement('img');
      img.src = slide.media_url;
      img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain';
      el.appendChild(img);
      if (slide.text) {
        var cap = document.createElement('div');
        cap.style.cssText = 'position:absolute;bottom:80px;left:0;right:0;padding:.75rem 1rem;background:rgba(0,0,0,.5);color:#fff;font-size:.9rem;text-align:center';
        cap.textContent = slide.text;
        el.appendChild(cap);
      }
      _svStartBar();
    }
  } else {
    // Text status
    el.style.background    = slide.bg    || '#1a0a2e';
    el.style.color         = slide.color || '#fff';
    el.style.fontSize      = '1.3rem';
    el.style.fontWeight    = '700';
    el.style.textAlign     = 'center';
    el.style.padding       = '2rem';
    el.style.lineHeight    = '1.5';
    el.textContent = slide.text || '';
    _svStartBar();
  }

  // Hide more menu if open
  document.getElementById('sv-more-menu').style.display = 'none';
  document.getElementById('sv-reaction-bar').style.display = 'none';
}

// ── Progress bar animation ─────────────────────────────────
function _svStartBar() {
  cancelAnimationFrame(HOME_svBarRaf);
  HOME_svBarStart = performance.now();
  var barEl = document.getElementById('svbar-' + HOME_svSlideIdx);

  function tick(now) {
    if (HOME_svPaused) { HOME_svBarRaf = requestAnimationFrame(tick); return; }
    var pct = Math.min(100, (now - HOME_svBarStart) / HOME_svBarDur * 100);
    if (barEl) barEl.style.width = pct + '%';
    if (pct < 100) {
      HOME_svBarRaf = requestAnimationFrame(tick);
    } else {
      window.svNext();
    }
  }
  HOME_svBarRaf = requestAnimationFrame(tick);
}

// ── Navigation ────────────────────────────────────────────
window.svNext = function () {
  var s = HOME_svStatuses[HOME_svUserIdx];
  if (!s) { closeSV(); return; }
  if (HOME_svSlideIdx < s.slides.length - 1) {
    HOME_svSlideIdx++;
    _svShowSlide();
  } else if (HOME_svUserIdx < HOME_svStatuses.length - 1) {
    HOME_svUserIdx++;
    HOME_svSlideIdx = 0;
    _svShowSlide();
  } else {
    closeSV();
  }
};

window.svPrev = function () {
  if (HOME_svSlideIdx > 0) {
    HOME_svSlideIdx--;
  } else if (HOME_svUserIdx > 0) {
    HOME_svUserIdx--;
    HOME_svSlideIdx = Math.max(0, (HOME_svStatuses[HOME_svUserIdx].slides || []).length - 1);
  }
  _svShowSlide();
};

// ── Long-press logic (hold to pause, tap to nav) ───────────
// ── Touch/Click Gesture System ─────────────────────────────
// Rules (exactly like WhatsApp/Telegram):
//   • Normal TAP  (<400ms, little movement) → navigate left/right
//   • LONG PRESS  (≥400ms, no movement)     → pause while held, resume on release
//   • Pause icon NEVER shows on normal tap — only during a held long-press

var _svTouchX    = 0;
var _svTouchY    = 0;
var _svTouchMoved = false;

window.svTouchStart = function (e) {
  var t = e.touches[0];
  _svTouchX     = t.clientX;
  _svTouchY     = t.clientY;
  _svTouchMoved = false;
  HOME_svLongTimer = setTimeout(function () {
    HOME_svLongTimer = null;
    if (!_svTouchMoved) {
      // Genuine long press — pause and show icon
      HOME_svPaused = true;
      var vid = document.querySelector('#sv-slide video');
      if (vid) vid.pause();
      var pi = document.getElementById('sv-pause-icon');
      if (pi) pi.style.display = 'flex';
    }
  }, 400);
};

window.svTouchEnd = function (e) {
  var wasLongPress = !HOME_svLongTimer; // timer already fired = long press
  clearTimeout(HOME_svLongTimer);
  HOME_svLongTimer = null;

  if (wasLongPress) {
    // Releasing after long press → resume, hide icon
    HOME_svPaused = false;
    var vid = document.querySelector('#sv-slide video');
    if (vid) vid.play().catch(function(){});
    var pi = document.getElementById('sv-pause-icon');
    if (pi) pi.style.display = 'none';
    _svResyncBar();
  } else if (!_svTouchMoved) {
    // Normal tap → navigate (NO pause icon)
    var touch = e.changedTouches[0];
    if (touch.clientX < window.innerWidth * 0.3) {
      svPrev();
    } else {
      svNext();
    }
  }
};

// Detect scroll/swipe-away so we don't accidentally navigate
document.addEventListener('touchmove', function (e) {
  if (!document.getElementById('sv-overlay').classList.contains('open')) return;
  var t = e.touches[0];
  if (Math.abs(t.clientX - _svTouchX) > 10 || Math.abs(t.clientY - _svTouchY) > 10) {
    _svTouchMoved = true;
    if (HOME_svLongTimer) { clearTimeout(HOME_svLongTimer); HOME_svLongTimer = null; }
  }
}, { passive: true });

// Mouse fallback for desktop
window.svMouseDown = function (e) {
  _svTouchX     = e.clientX;
  _svTouchY     = e.clientY;
  _svTouchMoved = false;
  HOME_svLongTimer = setTimeout(function () {
    HOME_svLongTimer = null;
    HOME_svPaused = true;
    var vid = document.querySelector('#sv-slide video');
    if (vid) vid.pause();
    var pi = document.getElementById('sv-pause-icon');
    if (pi) pi.style.display = 'flex';
  }, 400);
};

window.svMouseUp = function (e) {
  var wasLongPress = !HOME_svLongTimer;
  clearTimeout(HOME_svLongTimer);
  HOME_svLongTimer = null;

  if (wasLongPress) {
    HOME_svPaused = false;
    var vid = document.querySelector('#sv-slide video');
    if (vid) vid.play().catch(function(){});
    var pi = document.getElementById('sv-pause-icon');
    if (pi) pi.style.display = 'none';
    _svResyncBar();
  } else if (!_svTouchMoved) {
    if (e.clientX < window.innerWidth * 0.3) svPrev();
    else svNext();
  }
};

function _svResyncBar() {
  // Recalculate bar start time so animation continues from where it was
  var barEl = document.getElementById('svbar-' + HOME_svSlideIdx);
  var pct = barEl ? parseFloat(barEl.style.width || '0') : 0;
  HOME_svBarStart = performance.now() - (pct / 100 * HOME_svBarDur);
}

// ── Pause / Resume (called by non-gesture code: more-menu, reply, reactions) ──
window.svPause = function () {
  HOME_svPaused = true;
  var vid = document.querySelector('#sv-slide video');
  if (vid) vid.pause();
  // Don't show pause icon here — this is for modals/menus, not a user hold-gesture
};
window.svResume = function () {
  HOME_svPaused = false;
  _svResyncBar();
  var vid = document.querySelector('#sv-slide video');
  if (vid) vid.play().catch(function(){});
  var pi = document.getElementById('sv-pause-icon');
  if (pi) pi.style.display = 'none';
};

// ── Close ─────────────────────────────────────────────────
window.closeSV = function () {
  cancelAnimationFrame(HOME_svBarRaf);
  HOME_svPaused = false;
  var vid = document.querySelector('#sv-slide video');
  if (vid) { vid.pause(); vid.src = ''; }
  document.getElementById('sv-overlay').classList.remove('open');
};

// ── Mute ─────────────────────────────────────────────────
window.svToggleMute = window.svMute = function () {
  HOME_svMuted = !HOME_svMuted;
  var btn = document.getElementById('sv-mute');
  if (btn) btn.textContent = HOME_svMuted ? '🔇' : '🔊';
  var vid = document.querySelector('#sv-slide video');
  if (vid) vid.muted = HOME_svMuted;
};

// ── Reactions / Likes ────────────────────────────────────
window.toggleSVReactionBar = function () {
  svPause();
  var bar = document.getElementById('sv-reaction-bar');
  bar.style.display = bar.style.display === 'flex' ? 'none' : 'flex';
};
window.svReact = function (emoji) {
  var s = HOME_svStatuses[HOME_svUserIdx];
  if (!s) return;
  var slide = s.slides[HOME_svSlideIdx];
  if (!slide) return;

  // Toggle heart button state
  var likeBtn = document.getElementById('sv-like-btn');
  if (likeBtn) likeBtn.textContent = emoji === '❤️' ? (likeBtn.textContent === '❤️' ? '🤍' : '❤️') : emoji;

  // Close reaction bar
  document.getElementById('sv-reaction-bar').style.display = 'none';

  // Send as a reply DM with the reaction emoji
  if (STATE.user && s.user_id !== STATE.user.id) {
    api.post('/chat/rooms', { type: 'private', other_user_id: s.user_id })
      .then(function (res) {
        return api.post('/chat', { room_id: res.room_id, type: 'text', text: emoji + ' (reacted to your status)' });
      })
      .catch(function () {});
  }

  toast(emoji + ' Reacted!');
  svResume();
};

// ── Reply to status ───────────────────────────────────────
window.svSendReply = function () {
  var s = HOME_svStatuses[HOME_svUserIdx];
  if (!s || !STATE.user) return;
  var inp = document.getElementById('sv-reply-input');
  var text = (inp.value || '').trim();
  if (!text) return;
  inp.value = '';

  svPause();
  api.post('/chat/rooms', { type: 'private', other_user_id: s.user_id })
    .then(function (res) {
      return api.post('/chat', { room_id: res.room_id, type: 'text', text: '↩️ ' + text });
    })
    .then(function () { toast('💬 Reply sent!'); svResume(); })
    .catch(function (err) { toast('❌ ' + err.message); svResume(); });
};

// ── Archive / Highlights ──────────────────────────────────
window.svArchiveCurrent = function () {
  var s = HOME_svStatuses[HOME_svUserIdx];
  if (!s) return;
  var slide = s.slides[HOME_svSlideIdx];
  if (!slide) return;

  var already = HOME_HIGHLIGHTS.some(function (h) { return h.id === slide.id; });
  if (already) { toast('Already in Highlights'); return; }

  HOME_HIGHLIGHTS.push({
    id: slide.id,
    type: slide.type,
    text: slide.text,
    media_url: slide.media_url,
    bg: slide.bg,
    color: slide.color,
    nick: s.nickname,
    created_at: slide.created_at,
  });
  try { localStorage.setItem('yp_highlights', JSON.stringify(HOME_HIGHLIGHTS)); } catch(e) {}
  toast('🔖 Saved to Highlights!');
  document.getElementById('sv-more-menu').style.display = 'none';
};

window.openHighlightsModal = function () {
  try { var saved = localStorage.getItem('yp_highlights'); if (saved) HOME_HIGHLIGHTS = JSON.parse(saved); } catch(e) {}
  var list = document.getElementById('sv-highlights-list');
  if (!list) return;
  if (!HOME_HIGHLIGHTS.length) {
    list.innerHTML = '<div style="text-align:center;padding:2rem;font-size:.85rem;color:var(--muted)">No highlights saved yet.<br>Long-press a status and tap 🔖 to save.</div>';
  } else {
    list.innerHTML = HOME_HIGHLIGHTS.map(function (h, i) {
      return '<div style="display:flex;align-items:center;gap:.75rem;padding:.6rem 0;border-bottom:1px solid var(--border)">' +
        '<div style="width:48px;height:48px;border-radius:10px;background:' + (h.bg || '#1a0a2e') + ';flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden">' +
          (h.media_url ? '<img src="' + h.media_url + '" style="width:100%;height:100%;object-fit:cover">' : '<span style="font-size:.7rem;color:#fff">' + escHtml((h.text || '').slice(0,20)) + '</span>') +
        '</div>' +
        '<div style="flex:1"><div style="font-size:.82rem;font-weight:700">@' + escHtml(h.nick || '') + '</div><div style="font-size:.68rem;color:var(--muted)">' + timeAgo(h.created_at) + '</div></div>' +
        '<button onclick="removeHighlight(' + i + ')" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:.8rem">Remove</button>' +
      '</div>';
    }).join('');
  }
  document.getElementById('sv-highlights-modal').classList.add('open');
};

window.removeHighlight = function (i) {
  HOME_HIGHLIGHTS.splice(i, 1);
  try { localStorage.setItem('yp_highlights', JSON.stringify(HOME_HIGHLIGHTS)); } catch(e) {}
  openHighlightsModal();
};

// ── Privacy controls ─────────────────────────────────────
window.svShowMore = function () {
  var menu = document.getElementById('sv-more-menu');
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  svPause();
};
window.svEditPrivacy = function () {
  document.getElementById('sv-more-menu').style.display = 'none';
  var sel = document.querySelector('input[name="sv-privacy"][value="' + HOME_svPrivacy + '"]');
  if (sel) sel.checked = true;
  document.getElementById('sv-privacy-modal').classList.add('open');
};
window.setSVPrivacy = function (val) {
  HOME_svPrivacy = val;
};
window.saveSVPrivacy = function () {
  document.getElementById('sv-privacy-modal').classList.remove('open');
  toast('🔒 Privacy saved: ' + HOME_svPrivacy);
  svResume();
};

window.svDeleteCurrent = function () {
  var s = HOME_svStatuses[HOME_svUserIdx];
  if (!s) return;
  var slide = s.slides[HOME_svSlideIdx];
  if (!slide || !slide.id) return;
  if (!confirm('Delete this status?')) return;
  api.del ? api.del('/statuses?id=' + encodeURIComponent(slide.id)).catch(function(){}) : null;
  s.slides.splice(HOME_svSlideIdx, 1);
  if (!s.slides.length) {
    HOME_svStatuses.splice(HOME_svUserIdx, 1);
    if (!HOME_svStatuses.length) { closeSV(); buildStatusRow(); return; }
    HOME_svUserIdx = Math.max(0, HOME_svUserIdx - 1);
    HOME_svSlideIdx = 0;
  } else {
    HOME_svSlideIdx = Math.min(HOME_svSlideIdx, s.slides.length - 1);
  }
  _svShowSlide();
  toast('🗑 Deleted.');
};

// Load saved highlights on startup
try { var _hl = localStorage.getItem('yp_highlights'); if (_hl) HOME_HIGHLIGHTS = JSON.parse(_hl); } catch(e) {}

console.log('YID PLUS: home.js loaded ✓ (Cloudflare D1 mode)');

// ============================================================
// STATUS UPLOAD (D1 'statuses' table + R2 for media)
// ============================================================
var STATUS_BGS = ['#1a0a2e','#0a1a0a','#1a0a0a','#001020','#1a1000','#0a001a','#222'];
var STATUS_selectedBg   = STATUS_BGS[0];
var STATUS_selectedFile = null;
var STATUS_type         = 'text';

window.openStatusUpload = function () {
  if (!STATE.user) return toast('⚠ Please sign in first.');

  STATUS_selectedFile = null;
  STATUS_type = 'text';
  STATUS_selectedBg = STATUS_BGS[0];

  var txtPanel = document.getElementById('status-text-panel');
  var mediaPanel = document.getElementById('status-media-panel');
  if (txtPanel) txtPanel.style.display = 'block';
  if (mediaPanel) mediaPanel.style.display = 'none';

  var ta = document.getElementById('status-text-content');
  if (ta) ta.value = '';

  var bgRow = document.getElementById('status-bg-row');
  if (bgRow) {
    bgRow.innerHTML = '';
    STATUS_BGS.forEach(function (c, i) {
      var sw = document.createElement('div');
      sw.className = 'status-bg-sw' + (i === 0 ? ' active' : '');
      sw.style.background = c;
      sw.onclick = function () {
        STATUS_selectedBg = c;
        document.querySelectorAll('.status-bg-sw').forEach(function (x) { x.classList.remove('active'); });
        sw.classList.add('active');
      };
      bgRow.appendChild(sw);
    });
  }

  document.getElementById('status-modal').classList.add('open');
};

window.closeStatusModal = function () {
  document.getElementById('status-modal').classList.remove('open');
};

window.switchStatusType = function (type) {
  STATUS_type = type;
  var txtPanel   = document.getElementById('status-text-panel');
  var mediaPanel = document.getElementById('status-media-panel');
  if (txtPanel)   txtPanel.style.display   = (type === 'text')  ? 'block' : 'none';
  if (mediaPanel) mediaPanel.style.display = (type === 'media') ? 'block' : 'none';
};

window.onStatusFileSelected = function (e) {
  STATUS_selectedFile = e.target.files[0];
  if (STATUS_selectedFile) {
    STATUS_type = 'media';
    var txtPanel   = document.getElementById('status-text-panel');
    var mediaPanel = document.getElementById('status-media-panel');
    if (txtPanel)   txtPanel.style.display   = 'none';
    if (mediaPanel) {
      mediaPanel.style.display = 'block';
      mediaPanel.textContent = '✅ Selected: ' + STATUS_selectedFile.name;
    }
  }
};

window.submitStatus = function () {
  if (!STATE.user) return toast('⚠ Please sign in first.');

  if (STATUS_type === 'text') {
    var ta  = document.getElementById('status-text-content');
    var txt = (ta && ta.value || '').trim();
    if (!txt) return toast('⚠ Type something first.');

    api.post('/statuses', {
      type: 'text',
      text: txt,
      bg: STATUS_selectedBg,
    }).then(function () {
      closeStatusModal();
      toast('✅ Status posted!');
    }).catch(function (err) {
      toast('❌ ' + err.message);
    });

  } else if (STATUS_selectedFile) {
    var form = new FormData();
    form.append('type', 'media');
    form.append('file', STATUS_selectedFile);

    api.post('/statuses', form, true).then(function () {
      closeStatusModal();
      toast('✅ Status posted!');
    }).catch(function (err) {
      toast('❌ ' + err.message);
    });

  } else {
    toast('⚠ Please select a type.');
  }
};

// ============================================================
// EDIT PROFILE
// ============================================================
window.openEditProfile = function () {
  if (!STATE.user) return toast('⚠ Please sign in first.');
  var nickEl = document.getElementById('edit-nick');
  var bioEl  = document.getElementById('edit-bio');
  if (nickEl) nickEl.value = STATE.user.nickname || '';
  if (bioEl)  bioEl.value  = STATE.user.bio || '';
  document.getElementById('edit-profile-modal').classList.add('open');
};

window.saveProfile = function () {
  var nick = (document.getElementById('edit-nick').value || '').trim();
  var bio  = (document.getElementById('edit-bio').value  || '').trim();

  if (nick.length < 3) return toast('⚠ Nickname must be at least 3 characters.');

  api.put('/profile', { nickname: nick, bio: bio })
    .then(function () {
      STATE.user.nickname = nick;
      STATE.user.bio = bio;
      applyRoleUI();
      document.getElementById('edit-profile-modal').classList.remove('open');
      toast('✅ Profile updated!');
    })
    .catch(function (err) {
      toast('❌ ' + err.message);
    });
};

// ============================================================
// CHANNEL PAGE — view a user's public channel (posts + shorts wall)
// Loaded via openChannel(ownerId) or navTo('channel') with
// CHANNEL_pendingOwnerId pre-set (used for cross-page URL loads).
// ============================================================
var CHANNEL_current = null;       // currently loaded channel data
var CHANNEL_pendingOwnerId = null; // set by boot logic when arriving via ?channel=xxx

window.init_channel = function () {
  var ownerId = CHANNEL_pendingOwnerId;
  CHANNEL_pendingOwnerId = null;
  if (!ownerId && CHANNEL_current) ownerId = CHANNEL_current.owner_id;
  if (!ownerId) { toast('⚠ No channel selected.'); navTo('home'); return; }

  _loadChannel(ownerId);
};

function _loadChannel(ownerId) {
  var nameEl = document.getElementById('ch-name');
  if (nameEl) nameEl.textContent = 'Loading...';

  api.get('/channels?owner_id=' + encodeURIComponent(ownerId))
    .then(function (res) {
      CHANNEL_current = res.channel;
      CHANNEL_current.owner_id = ownerId;
      _renderChannelHeader(res.channel);
      _renderChannelWall(res.wall || []);
    })
    .catch(function (err) {
      toast('❌ ' + err.message);
      navTo('home');
    });
}

function _renderChannelHeader(ch) {
  var initial = (ch.nickname || '?').slice(0, 1).toUpperCase();

  var coverEl = document.getElementById('ch-cover-emoji');
  if (coverEl) coverEl.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.35"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
  var avatarBig = document.getElementById('ch-avatar-big');
  avatarBig.textContent = initial;
  avatarBig.style.backgroundImage = '';

  var nameEl = document.getElementById('ch-name');
  nameEl.textContent = ch.nickname || 'Channel';
  nameEl.style.direction = 'rtl';

  document.getElementById('ch-handle').textContent = '@' + (ch.nickname || 'user');
  document.getElementById('ch-bio').textContent = ch.bio || '';
  document.getElementById('ch-followers').textContent = fmtN(ch.followers || 0);
  document.getElementById('ch-following').textContent = fmtN(ch.following || 0);
  document.getElementById('ch-views').textContent = fmtN(ch.total_views || 0);

  // Follow button state — uses a simple localStorage-backed "following" set
  // since there's no dedicated channel-follow table yet.
  var following = _isFollowingChannel(ch.owner_id);
  var followBtn = document.getElementById('ch-follow-btn');
  followBtn.textContent = following ? '✓ Following' : '+ Follow';
  followBtn.classList.toggle('following', following);

  // Reset to Shorts tab
  var tabs = document.querySelectorAll('.screen#screen-channel .chtab');
  tabs.forEach(function (t, i) { t.classList.toggle('active', i === 0); });
  document.getElementById('ch-shorts-tab').style.display = 'block';
  document.getElementById('ch-music-tab').style.display = 'none';
  document.getElementById('ch-about-tab').style.display = 'none';
}

function _renderChannelWall(wall) {
  var shorts = wall.filter(function (w) { return w.wall_type === 'short'; });
  var posts  = wall.filter(function (w) { return w.wall_type === 'post'; });

  document.getElementById('ch-shorts-ct').textContent = fmtN(shorts.length);

  var grid = document.getElementById('ch-grid');
  if (!shorts.length && !posts.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;padding:2rem;text-align:center;font-size:.82rem;color:var(--muted)">No content yet</div>';
  } else {
    grid.innerHTML = shorts.map(function (s) {
      return '<div class="ch-grid-item" style="position:relative;aspect-ratio:9/16;background:var(--bg3);border-radius:8px;overflow:hidden;cursor:pointer" onclick="goPage(\'yidplus-shorts.html\')">' +
        (s.media_url ? '<video src="' + s.media_url + '" muted style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" preload="metadata"></video>' : '') +
        '<div style="position:absolute;bottom:.3rem;left:.3rem;font-size:.65rem;color:#fff;background:rgba(0,0,0,.5);padding:.1rem .35rem;border-radius:4px">▶ ' + fmtN(s.likes || 0) + '</div>' +
      '</div>';
    }).join('');
  }

  // About tab content
  var aboutEl = document.getElementById('ch-about-content');
  if (aboutEl) {
    aboutEl.innerHTML =
      '<div style="font-size:.85rem;line-height:1.6;color:var(--text)">' +
        (CHANNEL_current.bio ? escHtml(CHANNEL_current.bio) : '<span style="color:var(--muted)">No bio yet.</span>') +
      '</div>' +
      '<div style="margin-top:1rem;font-size:.75rem;color:var(--muted)">' +
        posts.length + ' posts · ' + shorts.length + ' shorts' +
      '</div>';
  }
}

function _isFollowingChannel(ownerId) {
  try {
    var set = JSON.parse(localStorage.getItem('yp_following') || '[]');
    return set.indexOf(ownerId) !== -1;
  } catch (e) { return false; }
}

window.shareChannel = function () {
  if (!CHANNEL_current) return;
  var url = window.location.origin + '/yidplus-dashboard.html?channel=' + encodeURIComponent(CHANNEL_current.owner_id);
  if (navigator.share) {
    navigator.share({ title: '@' + CHANNEL_current.nickname + ' on YID PLUS', url: url });
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(function () { toast('🔗 Link copied!'); });
  } else {
    toast('🔗 ' + url);
  }
};

window.copyChannelLink = function () {
  if (!CHANNEL_current) return;
  var url = window.location.origin + '/yidplus-dashboard.html?channel=' + encodeURIComponent(CHANNEL_current.owner_id);
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(function () { toast('✅ Link copied!'); });
  } else {
    toast('🔗 ' + url);
  }
};

window.openChannelOptions = function () {
  var menu = document.getElementById('ch-options-menu');
  if (menu) menu.classList.toggle('open');
};

window.reportChannel = function () {
  if (!CHANNEL_current) return;
  if (!confirm('Report @' + CHANNEL_current.nickname + '?')) return;
  api.post('/reports', { target_type: 'channel', target_id: CHANNEL_current.owner_id, reason: 'User report' })
    .then(function () { toast('✅ Reported. We\'ll review this channel.'); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.toggleChFollow = function () {
  if (!STATE.user) return toast('⚠ Please sign in first.');
  if (!CHANNEL_current) return;
  var ownerId = CHANNEL_current.owner_id;

  var set = [];
  try { set = JSON.parse(localStorage.getItem('yp_following') || '[]'); } catch (e) {}

  var idx = set.indexOf(ownerId);
  var nowFollowing;
  if (idx === -1) { set.push(ownerId); nowFollowing = true; }
  else { set.splice(idx, 1); nowFollowing = false; }

  localStorage.setItem('yp_following', JSON.stringify(set));

  var followBtn = document.getElementById('ch-follow-btn');
  followBtn.textContent = nowFollowing ? '✓ Following' : '+ Follow';
  followBtn.classList.toggle('following', nowFollowing);

  var countEl = document.getElementById('ch-followers');
  var current = parseInt((countEl.textContent || '0').replace(/[^\d]/g, ''), 10) || 0;
  countEl.textContent = fmtN(Math.max(0, current + (nowFollowing ? 1 : -1)));

  toast(nowFollowing ? '✅ Following @' + CHANNEL_current.nickname : '➖ Unfollowed');
};

window.switchChTab = function (btn, tab) {
  document.querySelectorAll('.screen#screen-channel .chtab').forEach(function (b) { b.classList.remove('active'); });
  btn.classList.add('active');
  document.getElementById('ch-shorts-tab').style.display = (tab === 'shorts') ? 'block' : 'none';
  document.getElementById('ch-music-tab').style.display  = (tab === 'music')  ? 'block' : 'none';
  document.getElementById('ch-about-tab').style.display  = (tab === 'about')  ? 'block' : 'none';

  if (tab === 'music' && CHANNEL_current) {
    var listEl = document.getElementById('ch-music-list');
    listEl.innerHTML = '<div style="padding:1.5rem;text-align:center;font-size:.8rem;color:var(--muted)">Loading...</div>';
    api.get('/music')
      .then(function (res) {
        var mine = (res.tracks || []).filter(function (t) { return t.owner_id === CHANNEL_current.owner_id; });
        if (!mine.length) {
          listEl.innerHTML = '<div style="padding:1.5rem;text-align:center;font-size:.8rem;color:var(--muted)">No tracks yet</div>';
          return;
        }
        listEl.innerHTML = mine.map(function (t) {
          return '<div style="display:flex;align-items:center;gap:.6rem;padding:.6rem 1rem;border-bottom:1px solid var(--border)">' +
            '<div style="width:40px;height:40px;border-radius:8px;background:var(--bg3);display:flex;align-items:center;justify-content:center">🎵</div>' +
            '<div style="flex:1"><div style="font-size:.82rem;font-weight:700">' + escHtml(t.title) + '</div><div style="font-size:.68rem;color:var(--muted)">' + escHtml(t.artist) + '</div></div>' +
          '</div>';
        }).join('');
      })
      .catch(function () { listEl.innerHTML = '<div style="padding:1rem;color:var(--red);font-size:.8rem">Could not load music</div>'; });
  }
};
