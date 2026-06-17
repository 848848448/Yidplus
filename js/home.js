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
    '<div style="display:flex;align-items:center;gap:.6rem;padding:.75rem;cursor:pointer" onclick="openChannel(\'' + escHtml(nick) + '\')">' +
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

// ── STATUS ROW — loads real statuses from /api/statuses ──────
var HOME_svStatuses = [];
var HOME_svUserIdx  = 0;
var HOME_svSlideIdx = 0;
var HOME_svTimer    = null;
var HOME_svPaused   = false;
var HOME_svMuted    = false;
var HOME_svBarRaf   = null;
var HOME_svBarStart = 0;
var HOME_svBarDur   = 5000;

function buildStatusRow() {
  var row = document.getElementById('status-row');
  if (!row) return;
  var myNick = (STATE.user && STATE.user.nickname) ? STATE.user.nickname : 'My Status';
  row.innerHTML =
    '<div class="status-item" onclick="openStatusUpload()">' +
      '<div class="status-ring mine"><div class="status-inner">👤<div class="status-plus">+</div></div></div>' +
      '<div class="status-name">' + escHtml(myNick) + '</div>' +
    '</div>';

  api.get('/statuses').then(function (res) {
    HOME_svStatuses = res.statuses || [];
    var meId = STATE.user && STATE.user.id;
    HOME_svStatuses.sort(function (a, b) {
      if (a.user_id === meId) return -1;
      if (b.user_id === meId) return 1;
      return 0;
    });
    HOME_svStatuses.forEach(function (s, i) {
      var isMine  = s.user_id === meId;
      var initial = (s.nickname || '?').slice(0, 1).toUpperCase();
      var el = document.createElement('div');
      el.className = 'status-item';
      el.onclick   = function () { openSV(i); };
      el.innerHTML =
        '<div class="status-ring' + (isMine ? ' mine' : '') + '">' +
          '<div class="status-inner" style="font-size:.9rem;font-weight:700">' + initial + '</div>' +
        '</div>' +
        '<div class="status-name">' + escHtml(isMine ? 'My Status' : (s.nickname || 'User')) + '</div>';
      row.appendChild(el);
    });
  }).catch(function () {});
}

window.openSV = function (userIdx) {
  if (!HOME_svStatuses[userIdx]) return;
  HOME_svUserIdx  = userIdx;
  HOME_svSlideIdx = 0;
  _svShowSlide();
  document.getElementById('sv-overlay').classList.add('open');
};
window.openStatusViewer = window.openSV;

function _svShowSlide() {
  var s      = HOME_svStatuses[HOME_svUserIdx];
  if (!s || !s.slides || !s.slides.length) { closeSV(); return; }
  var slide  = s.slides[HOME_svSlideIdx];
  if (!slide) { closeSV(); return; }

  clearTimeout(HOME_svTimer);
  cancelAnimationFrame(HOME_svBarRaf);
  HOME_svPaused = false;
  HOME_svBarDur = 5000;

  document.getElementById('sv-avatar').textContent = (s.nickname || '?').slice(0,1).toUpperCase();
  document.getElementById('sv-nick').textContent   = '@' + (s.nickname || 'User');
  document.getElementById('sv-time').textContent   = s.slides[0].created_at ? timeAgo(s.slides[0].created_at) : 'now';

  var bars = document.getElementById('sv-bars');
  bars.innerHTML = s.slides.map(function (_, j) {
    return '<div class="sv-bar"><div class="sv-bar-fill' + (j < HOME_svSlideIdx ? ' done' : '') + '" id="svbar-' + j + '"></div></div>';
  }).join('');

  var el = document.getElementById('sv-slide');
  el.innerHTML = '';
  el.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;transition:opacity .15s';

  if (slide.type === 'media' && slide.media_url) {
    var isVideo = /\.(mp4|webm|mov|avi)$/i.test(slide.media_url);
    if (isVideo) {
      var vid = document.createElement('video');
      vid.src         = slide.media_url;
      vid.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
      vid.autoplay    = true;
      vid.loop        = false;
      vid.muted       = HOME_svMuted;
      vid.playsInline = true;
      vid.onloadedmetadata = function () {
        HOME_svBarDur = (vid.duration || 5) * 1000;
        _svStartBar();
      };
      vid.onended = function () { window.svNext(); };
      el.style.background = '#000';
      el.appendChild(vid);
    } else {
      var img = document.createElement('img');
      img.src           = slide.media_url;
      img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain';
      el.style.background = '#000';
      el.appendChild(img);
      if (slide.text) {
        var cap = document.createElement('div');
        cap.style.cssText = 'position:absolute;bottom:80px;left:0;right:0;padding:.75rem 1rem;background:rgba(0,0,0,.5);color:#fff;font-size:.9rem;text-align:center;border-radius:0 0 8px 8px';
        cap.textContent = slide.text;
        el.appendChild(cap);
      }
      _svStartBar();
    }
  } else {
    el.style.background     = slide.bg    || '#1a0a2e';
    el.style.color          = slide.color || '#fff';
    el.style.fontSize       = '1.2rem';
    el.style.textAlign      = 'center';
    el.style.padding        = '2rem';
    el.style.lineHeight     = '1.6';
    el.textContent = slide.text || '';
    _svStartBar();
  }
}

function _svStartBar() {
  cancelAnimationFrame(HOME_svBarRaf);
  HOME_svBarStart = performance.now();
  var barEl = document.getElementById('svbar-' + HOME_svSlideIdx);
  function tick(now) {
    if (HOME_svPaused) { HOME_svBarRaf = requestAnimationFrame(tick); return; }
    var elapsed = now - HOME_svBarStart;
    var pct = Math.min(100, elapsed / HOME_svBarDur * 100);
    if (barEl) barEl.style.width = pct + '%';
    if (pct < 100) { HOME_svBarRaf = requestAnimationFrame(tick); }
    else { window.svNext(); }
  }
  HOME_svBarRaf = requestAnimationFrame(tick);
}

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

window.closeSV = function () {
  cancelAnimationFrame(HOME_svBarRaf);
  clearTimeout(HOME_svTimer);
  HOME_svPaused = false;
  var vid = document.querySelector('#sv-slide video');
  if (vid) { vid.pause(); vid.src = ''; }
  var el = document.getElementById('sv-overlay');
  if (el) el.classList.remove('open');
};

window.svToggleMute = window.svMute = function () {
  HOME_svMuted = !HOME_svMuted;
  var btn = document.getElementById('sv-mute');
  if (btn) btn.textContent = HOME_svMuted ? '🔇' : '🔊';
  var vid = document.querySelector('#sv-slide video');
  if (vid) vid.muted = HOME_svMuted;
};

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
