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
        c.onclick = function () { goPage('/shorts'); };
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
        card.onclick = function () { goPage('/?channel=' + c.owner_id); };
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
var _homeInitDone = false;
window.init_home = function () {
  if (typeof applyRoleUI === 'function') applyRoleUI();

  // Run all home data fetches in parallel for max speed
  Promise.all([
    _fetchHomeData(),
  ]).catch(function () {});

  // Only set intervals once
  if (!_homeInitDone) {
    _homeInitDone = true;
    setInterval(_updateNotifBadge, 45000);  // was 30s
    setInterval(_updateNavBadges, 90000);   // was 60s
    setInterval(listenBroadcasts, 120000);  // every 2 min
  }
};

// Single batched fetch for all home screen data
function _fetchHomeData() {
  // Fire all requests simultaneously
  var p2 = api.get('/shorts?limit=6').catch(function(){ return { shorts: [] }; });
  var p3 = api.get('/channels?limit=6').catch(function(){ return { channels: [] }; });
  var p4 = api.get('/posts?limit=20').catch(function(){ return { posts: [] }; });
  var p5 = api.get('/broadcasts').catch(function(){ return { announcements: [] }; });
  var p6 = api.get('/chat/rooms').catch(function(){ return { rooms: [] }; });

  return Promise.all([p2, p3, p4, p5, p6]).then(function(res) {
    var shortsRes  = res[0];
    var channelRes = res[1];
    var postsRes   = res[2];
    var broadRes   = res[3];
    var roomsRes   = res[4];

    // Build all sections at once
    _renderShortsPrev(shortsRes.shorts || []);
    _renderChannelsPrev(channelRes.channels || []);
    _renderFeed(postsRes.posts || []);
    _renderBroadcast(broadRes.announcements || broadRes.pinned || []);
    _updateBadgesFromRooms(roomsRes.rooms || []);

    // Welcome banner (first time only)
    _showWelcomeBannerIfFirst();
  });
}

// ══════════════════════════════════════════════════════════
//  DYNAMIC FEED — reads from /api/posts (D1-backed)
//  Row shape: { id, username, caption, content, likes,
//                comments, created_at }
//  'content' can be a URL or an emoji for preview
// ══════════════════════════════════════════════════════════
window.loadDynamicFeed = function () {
  var feed = document.getElementById('home-feed');
  if (!feed) return;

  feed.innerHTML =
    '<div class="feed-state">' +
      '<div class="spinner"></div>' +
    '</div>';

  // Limit to 20 posts for speed
  api.get('/posts?limit=20')
    .then(function (res) {
      var posts = res.posts || [];
      if (!posts.length) {
        feed.innerHTML =
          '<div class="feed-state">' +
            '<div style="font-size:2.5rem">📭</div>' +
            '<div class="feed-state-text">No posts yet</div>' +
            '<div class="feed-state-sub">Be the first to share something!</div>' +
          '</div>';
        return;
      }
      feed.innerHTML = '';
      posts.forEach(function (p) { feed.appendChild(buildPostCard(p)); });
    })
    .catch(function (err) {
      feed.innerHTML =
        '<div class="feed-state">' +
          '<div style="font-size:2rem">⚠️</div>' +
          '<div class="feed-state-text">Could not load posts.</div>' +
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
    (caption ? '<div style="padding:.6rem .75rem;font-size:.82rem;color:var(--muted);border-bottom:.5px solid var(--border)">' + (typeof filterContent==='function'?filterContent(_linkHashtags(escHtml(caption))):_linkHashtags(escHtml(caption))) + '</div>' : '') +
    // Actions
    '<div style="display:flex;gap:1rem;padding:.75rem">' +
      '<button class="post-action" id="like-btn-' + p.id + '" onclick="handleLike(this,\'' + p.id + '\',' + likes + ')">' +
        '🤍 ' + fmtN(likes) +
      '</button>' +
      '<button class="post-action" onclick="openPostComments(\'' + p.id + '\')">' +
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

  // Welcome banner — show only once ever
  try {
    if (!localStorage.getItem('yp_welcomed')) {
      localStorage.setItem('yp_welcomed', '1');
      var bar = document.getElementById('broadcast-bar');
      if (bar) {
        var wb = document.createElement('div');
        wb.style.cssText = 'margin:.5rem .75rem;background:linear-gradient(135deg,rgba(21,101,192,.08),rgba(21,101,192,.04));border:1px solid rgba(21,101,192,.2);border-radius:14px;padding:.75rem 1rem;display:flex;align-items:center;gap:.65rem';
        wb.innerHTML =
          '<div style="font-size:1.5rem;flex-shrink:0">✡️</div>' +
          '<div style="flex:1">' +
            '<div style="font-size:.85rem;font-weight:700;color:var(--blue)">ברוכים הבאים ל-YID PLUS!</div>' +
            '<div style="font-size:.72rem;color:var(--muted);margin-top:.15rem">A Yiddish social platform for the Jewish community 🎉</div>' +
          '</div>' +
          '<button onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:var(--muted);padding:.25rem;flex-shrink:0">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
          '</button>';
        bar.insertBefore(wb, bar.firstChild);
        // Auto-dismiss after 8 seconds
        setTimeout(function () { if (wb.parentElement) wb.remove(); }, 8000);
      }
    }
  } catch (e) {}
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

function _updateNavBadges() {
  // Chats unread
  api.get('/chat/rooms').then(function (res) {
    var total = (res.rooms || []).reduce(function (s, r) { return s + (r.unread || 0); }, 0);
    ['nav-badge-chats','nav-badge-chats2'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (total > 0) { el.textContent = total > 99 ? '99+' : total; el.style.display = 'flex'; }
      else el.style.display = 'none';
    });
    // Also update bell badge
    var badge = document.getElementById('notif-badge');
    if (badge) {
      if (total > 0) { badge.textContent = total > 99 ? '99+' : total; badge.style.display = 'flex'; }
      else badge.style.display = 'none';
    }
  }).catch(function () {});

  // New shorts since last visit
  var lastVisit = localStorage.getItem('yp_last_shorts_visit') || '1970-01-01';
  api.get('/shorts?limit=1').then(function (res) {
    var latest = res.shorts && res.shorts[0] && res.shorts[0].created_at;
    ['nav-badge-shorts','nav-badge-shorts2'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (latest && latest > lastVisit) { el.textContent = ''; el.style.display = 'flex'; el.style.minWidth = '8px'; el.style.height = '8px'; el.style.padding = '0'; }
      else el.style.display = 'none';
    });
  }).catch(function () {});
}

function _updateNotifBadge() {
  api.get('/chat/rooms')
    .then(function (res) {
      var total = (res.rooms || []).reduce(function (sum, r) { return sum + (r.unread || 0); }, 0);
      var badge = document.getElementById('notif-badge');
      if (!badge) return;
      if (total > 0) {
        badge.textContent = total > 99 ? '99+' : total;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    })
    .catch(function () {});
}

window.openSearchModal = function () {
  var modal = document.getElementById('search-modal');
  if (!modal) return;
  modal.classList.add('open');
  var inp = document.getElementById('search-input');
  if (inp) { inp.value = ''; setTimeout(function () { inp.focus(); }, 100); }
  document.getElementById('search-results').innerHTML = '';
};

var _searchTimer = null;
window.doSearch = function (q) {
  clearTimeout(_searchTimer);
  q = (q || '').trim();
  var el = document.getElementById('search-results');
  if (!q || q.length < 2) { el.innerHTML = ''; return; }
  el.innerHTML = '<div style="padding:1rem;text-align:center"><div class="spinner"></div></div>';
  _searchTimer = setTimeout(function () {
    api.get('/admin/users?search=' + encodeURIComponent(q))
      .then(function (res) {
        var users = res.users || [];
        if (!users.length) {
          el.innerHTML = '<div style="padding:1rem;text-align:center;font-size:.85rem;color:var(--muted)">No results</div>';
          return;
        }
        el.innerHTML = users.slice(0, 15).map(function (u) {
          var init = (u.nickname || '?').slice(0,1).toUpperCase();
          return '<div style="display:flex;align-items:center;gap:.75rem;padding:.7rem 1rem;cursor:pointer;border-bottom:1px solid var(--border)" onclick="document.getElementById(\'search-modal\').classList.remove(\'open\');CHANNEL_pendingOwnerId=\'' + u.id + '\';navTo(\'channel\')">' +
            '<div style="width:40px;height:40px;border-radius:50%;background:var(--blue);color:#fff;display:flex;align-items:center;justify-content:center;font-size:.9rem;font-weight:700;flex-shrink:0">' + init + '</div>' +
            '<div><div style="font-size:.88rem;font-weight:700">@' + escHtml(u.nickname) + '</div>' +
              (u.verified ? '<div style="font-size:.72rem;color:var(--blue)">✓ Verified</div>' : '') +
            '</div>' +
          '</div>';
        }).join('');
      })
      .catch(function () {
        el.innerHTML = '<div style="padding:1rem;text-align:center;font-size:.82rem;color:var(--muted)">Search error</div>';
      });
  }, 350);
};

// WhatsApp-style segmented status ring SVG
window.loadStatuses = buildStatusRow;
function _buildStatusRing(count, color) {
  var r = 25, cx = 27, cy = 27;
  var gap = count > 1 ? 0.12 : 0;
  var total = 2 * Math.PI;
  var segAngle = (total - gap * count) / count;
  var paths = [];
  for (var i = 0; i < count; i++) {
    var startAngle = -Math.PI / 2 + i * (segAngle + gap);
    var endAngle   = startAngle + segAngle;
    var x1 = cx + r * Math.cos(startAngle);
    var y1 = cy + r * Math.sin(startAngle);
    var x2 = cx + r * Math.cos(endAngle);
    var y2 = cy + r * Math.sin(endAngle);
    var largeArc = segAngle > Math.PI ? 1 : 0;
    paths.push('<path d="M' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' A' + r + ' ' + r + ' 0 ' + largeArc + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + '" fill="none" stroke="' + color + '" stroke-width="2.8" stroke-linecap="round"/>');
  }
  return '<svg width="54" height="54" viewBox="0 0 54 54" style="position:absolute;inset:0">' + paths.join('') + '</svg>';
}

function buildStatusRow() {
  var row = document.getElementById('status-row');
  if (!row) return;

  var meNick = (STATE.user && STATE.user.nickname) ? STATE.user.nickname : 'My Status';
  var meInitial = meNick.slice(0,1).toUpperCase();

  // "My Status" — always first, shows highlights indicator if archived
  row.innerHTML =
    '<div class="status-item" onclick="openStatusUpload()">' +
      '<div class="status-ring mine" style="border-style:dashed">' +
        '<div class="status-inner" id="my-status-av" style="font-size:1rem;font-weight:700;color:var(--muted)">' +
          (STATE.user ? (STATE.user.nickname||'?').slice(0,1).toUpperCase() : '?') +
        '</div>' +
        '<div class="status-plus">' +
          '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
        '</div>' +
      '</div>' +
      '<div class="status-name">My Status</div>' +
    '</div>';
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
        var isMine   = s.user_id === meId;
        var initial  = (s.nickname || '?').slice(0,1).toUpperCase();
        var count    = (s.slides || []).length;
        var el = document.createElement('div');
        el.className = 'status-item';
        el.onclick   = function () { openSV(i); };

        var avatarContent = s.photo_url
          ? '<div style="width:100%;height:100%;border-radius:50%;background-image:url(\'' + s.photo_url + '\');background-size:cover;background-position:center"></div>'
          : '<div style="font-size:.9rem;font-weight:700">' + initial + '</div>';

        // Build WhatsApp-style segmented ring
        var ringColor = isMine ? 'var(--blue)' : 'var(--green,#25D366)';
        var ringHTML = _buildStatusRing(count, ringColor);

        el.innerHTML =
          '<div style="position:relative;width:54px;height:54px;flex-shrink:0">' +
            ringHTML +
            '<div style="position:absolute;inset:4px;border-radius:50%;background:var(--surface);display:flex;align-items:center;justify-content:center;overflow:hidden">' +
              avatarContent +
            '</div>' +
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

  // Track view — send to server (only for other people's statuses)
  var myId = STATE.user && STATE.user.id;
  var isMySlide = s.user_id === myId;
  if (slide.id && !isMySlide) {
    api.post('/statuses/view', { id: slide.id }).catch(function () {});
  }
  var viewsRow = document.getElementById('sv-views-row');
  var viewsCount = document.getElementById('sv-views-count');
  if (viewsRow) viewsRow.style.display = isMySlide ? 'flex' : 'none';
  if (viewsCount && slide.views !== undefined) viewsCount.textContent = fmtN(slide.views || 0);

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
    var isVideo = slide.is_video || (slide.media_key && /\.(mp4|webm|mov|avi)$/i.test(slide.media_key)) || /\.(mp4|webm|mov|avi)$/i.test(slide.media_url);
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
      // Genuine long press — pause silently
      HOME_svPaused = true;
      var vid = document.querySelector('#sv-slide video');
      if (vid) vid.pause();
}
  }, 400);
};

window.svTouchEnd = function (e) {
  var wasLongPress = !HOME_svLongTimer; // timer already fired = long press
  clearTimeout(HOME_svLongTimer);
  HOME_svLongTimer = null;

  var touch = e.changedTouches[0];
  var dy = touch.clientY - _svTouchY;
  var dx = touch.clientX - _svTouchX;

  if (wasLongPress) {
    // Releasing after long press → resume silently
    HOME_svPaused = false;
    var vid = document.querySelector('#sv-slide video');
    if (vid) vid.play().catch(function(){});
    _svResyncBar();
  } else if (!_svTouchMoved) {
    // Normal tap → navigate
    if (touch.clientX < window.innerWidth * 0.3) {
      svPrev();
    } else {
      svNext();
    }
  } else if (dy > 80 && Math.abs(dy) > Math.abs(dx) * 2) {
    // Swipe down → close
    closeSV();
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
          (h.media_url ? '<img src="' + h.media_url + '" style="width:100%;height:100%;object-fit:cover" loading="lazy">' : '<span style="font-size:.7rem;color:#fff">' + escHtml((h.text || '').slice(0,20)) + '</span>') +
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
  api.put('/statuses', { action: 'delete', id: slide.id }).catch(function(){});
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
var STATUS_BGS = [
  'linear-gradient(135deg,#1a1a2e,#16213e)',
  'linear-gradient(135deg,#0f3460,#533483)',
  'linear-gradient(135deg,#1b4332,#40916c)',
  'linear-gradient(135deg,#7b2d8b,#e040fb)',
  'linear-gradient(135deg,#b5179e,#f72585)',
  'linear-gradient(135deg,#e85d04,#faa307)',
  'linear-gradient(135deg,#03045e,#0096c7)',
  'linear-gradient(135deg,#2d3436,#636e72)',
];
var STATUS_selectedBg = STATUS_BGS[0];
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

  STATUS_selectedBg = STATUS_BGS[0];

  var bgRow = document.getElementById('status-bg-row');
  if (bgRow) {
    bgRow.innerHTML = '';
    STATUS_BGS.forEach(function (c, i) {
      var sw = document.createElement('div');
      sw.style.cssText = 'width:32px;height:32px;border-radius:50%;background:' + c + ';cursor:pointer;border:3px solid ' + (i === 0 ? '#fff' : 'transparent') + ';box-shadow:0 2px 6px rgba(0,0,0,.3);transition:border .15s;flex-shrink:0';
      sw.onclick = function () {
        STATUS_selectedBg = c;
        var preview = document.getElementById('status-preview-box');
        if (preview) preview.style.background = c;
        bgRow.querySelectorAll('div').forEach(function (x) { x.style.borderColor = 'transparent'; });
        sw.style.borderColor = '#fff';
      };
      bgRow.appendChild(sw);
    });
  }

  // Set initial preview bg
  var previewBox = document.getElementById('status-preview-box');
  if (previewBox) previewBox.style.background = STATUS_BGS[0];

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
  // Update button styles
  var btnText  = document.getElementById('st-btn-text');
  var btnMedia = document.getElementById('st-btn-media');
  if (btnText)  { btnText.style.background  = type === 'text'  ? 'var(--blue)' : 'var(--bg3)';  btnText.style.color  = type === 'text'  ? '#fff' : 'var(--text)'; }
  if (btnMedia) { btnMedia.style.background = type === 'media' ? 'var(--blue)' : 'var(--bg3)'; btnMedia.style.color = type === 'media' ? '#fff' : 'var(--text)'; }
};

window.updateStatusPreview = function () {
  var ta  = document.getElementById('status-text-content');
  var box = document.getElementById('status-preview-text');
  if (box && ta) box.textContent = ta.value;
};

window.onStatusFileSelected = function (e) {
  STATUS_selectedFile = e.target.files[0];
  if (!STATUS_selectedFile) return;
  STATUS_type = 'media';
  switchStatusType('media');
  var preview = document.getElementById('status-media-preview');
  if (!preview) return;
  var url = URL.createObjectURL(STATUS_selectedFile);
  var isVid = STATUS_selectedFile.type.startsWith('video/');
  preview.innerHTML = isVid
    ? '<video src="' + url + '" style="width:100%;max-height:220px;object-fit:cover;border-radius:14px" controls muted playsinline></video>'
    : '<img src="' + url + '" style="width:100%;max-height:220px;object-fit:cover;border-radius:14px" loading="lazy">';
};

window.submitStatus = function () {
  if (!STATE.user) return toast('⚠ Please sign in first.');

  if (STATUS_type === 'text') {
    var ta  = document.getElementById('status-text-content');
    var txt = (ta && ta.value || '').trim();
    if (!txt) return toast('⚠ Type something first.');
    var privacy = (document.getElementById('status-privacy') || {}).value || 'public';
    api.post('/statuses', { type: 'text', text: txt, bg: STATUS_selectedBg, privacy: privacy })
      .then(function () { closeStatusModal(); toast('✅ Status posted!'); loadStatuses(); })
      .catch(function (err) { toast('❌ ' + err.message); });

  } else if (STATUS_selectedFile) {
    var caption = (document.getElementById('status-media-caption') || {}).value || '';
    var privacy2 = (document.getElementById('status-privacy') || {}).value || 'public';
    var form = new FormData();
    form.append('type', 'media');
    form.append('media', STATUS_selectedFile);
    form.append('caption', caption);
    form.append('privacy', privacy2);
    api.post('/statuses', form, true)
      .then(function () { closeStatusModal(); toast('✅ Status posted!'); loadStatuses(); })
      .catch(function (err) { toast('❌ ' + err.message); });
  } else {
    toast('⚠ Choose Text or Photo/Video first.');
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
  var tb = document.getElementById('channel-topbar-fixed');
  if (tb) tb.style.display = 'flex';
  // Remember where we came from so the back button works correctly
  if (STATE.prevScreen && STATE.prevScreen !== 'channel') {
    window._channelBackScreen = STATE.prevScreen;
  }
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
      if (res.locked) {
        _renderLockedWall(res.request_status);
      } else {
        _renderChannelWall(res.wall || []);
      }
    })
    .catch(function (err) {
      toast('❌ ' + err.message);
      navTo('home');
    });
}

function _renderLockedWall(requestStatus) {
  var grid = document.getElementById('ch-grid');
  if (!grid) return;

  var btnHTML = '';
  if (requestStatus === 'pending') {
    btnHTML = '<button style="margin-top:1rem;padding:.6rem 1.5rem;border-radius:20px;background:var(--bg3);border:1px solid var(--border);color:var(--muted);font-size:.85rem;cursor:default">⏳ Request pending...</button>';
  } else if (requestStatus === 'rejected') {
    btnHTML = '<button style="margin-top:1rem;padding:.6rem 1.5rem;border-radius:20px;background:rgba(211,47,47,.1);border:1px solid var(--red);color:var(--red);font-size:.85rem;cursor:default">❌ Request was declined</button>';
  } else {
    btnHTML = '<button onclick="requestChannelFollow()" style="margin-top:1rem;padding:.6rem 1.5rem;border-radius:20px;background:var(--blue);border:none;color:#fff;font-size:.85rem;cursor:pointer;font-weight:700">Request to Follow</button>';
  }

  grid.innerHTML =
    '<div style="grid-column:1/-1;padding:2.5rem 1rem;text-align:center">' +
      '<div style="font-size:2.5rem;margin-bottom:.5rem">🔒</div>' +
      '<div style="font-size:.95rem;font-weight:700;margin-bottom:.35rem">This channel is private</div>' +
      '<div style="font-size:.8rem;color:var(--muted);margin-bottom:.5rem">Follow this channel to see their content</div>' +
      btnHTML +
    '</div>';
}

window.requestChannelFollow = function () {
  if (!CHANNEL_current) return;
  if (!STATE.user) return toast('⚠ Please sign in first.');

  api.post('/channel-follows', { channel_owner_id: CHANNEL_current.owner_id })
    .then(function (res) {
      if (res.status === 'approved') {
        toast('✅ You are now following this channel!');
        _loadChannel(CHANNEL_current.owner_id);
      } else if (res.status === 'pending') {
        toast('📨 Follow request sent! Waiting for approval.');
        _renderLockedWall('pending');
      } else {
        toast('✅ ' + (res.status || 'Done'));
      }
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

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

  // Follow button — hide for your own channel, show privacy toggle instead
  var isOwnChannel = STATE.user && STATE.user.id === ch.owner_id;
  var followBtn = document.getElementById('ch-follow-btn');
  if (isOwnChannel) {
    var isPrivate = ch.privacy === 'followers_only';
    followBtn.innerHTML = (isPrivate ? '🔒 Private' : '🌍 Public') + ' <span style="font-size:.7rem;opacity:.7">tap to change</span>';
    followBtn.className = 'ch-follow-btn';
    followBtn.onclick = function () { toggleChannelPrivacy(); };
  } else {
    var following = _isFollowingChannel(ch.owner_id);
    followBtn.textContent = following ? '✓ Following' : '+ Follow';
    followBtn.classList.toggle('following', following);
    followBtn.onclick = function () { toggleChFollow(); };
  }

  // Reset to Shorts tab
  var tabs = document.querySelectorAll('.screen#screen-channel .chtab');
  tabs.forEach(function (t, i) { t.classList.toggle('active', i === 0); });
  document.getElementById('ch-shorts-tab').style.display = 'block';
  document.getElementById('ch-music-tab').style.display = 'none';
  document.getElementById('ch-about-tab').style.display = 'none';
}

window.toggleChannelPrivacy = function () {
  if (!CHANNEL_current || !STATE.user) return;
  if (STATE.user.id !== CHANNEL_current.owner_id) return;

  var isCurrentlyPrivate = CHANNEL_current.privacy === 'followers_only';
  var newPrivacy = isCurrentlyPrivate ? 'public' : 'followers_only';
  var label = isCurrentlyPrivate ? 'Make this channel PUBLIC? Everyone will be able to see your content.' : 'Make this channel PRIVATE? Only followers will see your content.';

  if (!confirm(label)) return;

  api.put('/channels', { owner_id: CHANNEL_current.owner_id, privacy: newPrivacy })
    .then(function () {
      CHANNEL_current.privacy = newPrivacy;
      var followBtn = document.getElementById('ch-follow-btn');
      var isPrivate = newPrivacy === 'followers_only';
      followBtn.innerHTML = (isPrivate ? '🔒 Private' : '🌍 Public') + ' <span style="font-size:.7rem;opacity:.7">tap to change</span>';
      toast(isPrivate ? '🔒 Channel is now private — only followers can see your content' : '🌍 Channel is now public — everyone can see your content');
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};function _renderChannelWall(wall) {
  var shorts = wall.filter(function (w) { return w.wall_type === 'short'; });
  var posts  = wall.filter(function (w) { return w.wall_type === 'post'; });

  document.getElementById('ch-shorts-ct').textContent = fmtN(shorts.length);

  var grid = document.getElementById('ch-grid');
  if (!shorts.length && !posts.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;padding:2rem;text-align:center;font-size:.82rem;color:var(--muted)">No content yet</div>';
  } else {
    grid.innerHTML = shorts.map(function (s) {
      return '<div class="ch-grid-item" style="position:relative;aspect-ratio:9/16;background:var(--bg3);border-radius:8px;overflow:hidden;cursor:pointer" onclick="goPage(\'/shorts\')">' +
        (s.media_url ? '<video src="' + s.media_url + '" muted style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" preload="metadata"></video>' : '') +
        '<div style="position:absolute;bottom:.3rem;left:.3rem;font-size:.65rem;color:#fff;background:rgba(0,0,0,.5);padding:.1rem .35rem;border-radius:4px">▶ ' + fmtN(s.likes || 0) + '</div>' +
      '</div>';
    }).join('');
  }

  // About tab content
  var aboutEl = document.getElementById('ch-about-content');
  if (aboutEl) {
    var isOwnChannel = STATE.user && STATE.user.id === CHANNEL_current.owner_id;
    var pendingRequestsHTML = '';

    if (isOwnChannel && CHANNEL_current.privacy === 'followers_only') {
      pendingRequestsHTML =
        '<div style="margin-top:1.5rem;border-top:1px solid var(--border);padding-top:1rem">' +
          '<div style="font-size:.85rem;font-weight:700;margin-bottom:.75rem">📨 Follow Requests</div>' +
          '<div id="ch-follow-requests-list"><div class="spinner" style="margin:auto"></div></div>' +
        '</div>';

      // Load pending requests
      setTimeout(function () {
        api.get('/channel-follows?channel_owner_id=' + encodeURIComponent(CHANNEL_current.owner_id))
          .then(function (res) {
            var el = document.getElementById('ch-follow-requests-list');
            if (!el) return;
            var reqs = res.requests || [];
            if (!reqs.length) {
              el.innerHTML = '<div style="font-size:.8rem;color:var(--muted)">No pending requests</div>';
              return;
            }
            el.innerHTML = reqs.map(function (r) {
              return '<div style="display:flex;align-items:center;justify-content:space-between;padding:.6rem 0;border-bottom:1px solid var(--border)">' +
                '<div style="font-size:.85rem;font-weight:600">@' + escHtml(r.requester_nick) + '</div>' +
                '<div style="display:flex;gap:.4rem">' +
                  '<button onclick="respondFollowRequest(\'' + r.id + '\',\'approve\')" style="padding:.3rem .75rem;border-radius:12px;background:var(--blue);border:none;color:#fff;font-size:.75rem;cursor:pointer;font-weight:700">✓ Approve</button>' +
                  '<button onclick="respondFollowRequest(\'' + r.id + '\',\'reject\')" style="padding:.3rem .75rem;border-radius:12px;background:var(--bg3);border:1px solid var(--border);color:var(--muted);font-size:.75rem;cursor:pointer">✕ Decline</button>' +
                '</div>' +
              '</div>';
            }).join('');
          })
          .catch(function () {});
      }, 0);
    }

    aboutEl.innerHTML =
      '<div style="font-size:.85rem;line-height:1.6;color:var(--text)">' +
        (CHANNEL_current.bio ? escHtml(CHANNEL_current.bio) : '<span style="color:var(--muted)">No bio yet.</span>') +
      '</div>' +
      '<div style="margin-top:1rem;font-size:.75rem;color:var(--muted)">' +
        posts.length + ' posts · ' + shorts.length + ' shorts' +
      '</div>' +
      pendingRequestsHTML;
  }
}

function _isFollowingChannel(ownerId) {
  try {
    var set = JSON.parse(localStorage.getItem('yp_following') || '[]');
    return set.indexOf(ownerId) !== -1;
  } catch (e) { return false; }
}

window.respondFollowRequest = function (requestId, action) {
  api.put('/channel-follows', { request_id: requestId, action: action })
    .then(function () {
      toast(action === 'approve' ? '✅ Approved!' : '❌ Declined');
      // Re-render the About tab to refresh the list
      if (CHANNEL_current) switchChTab(document.querySelector('.chtab:last-child'), 'about');
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.shareChannel = function () {
  if (!CHANNEL_current) return;
  var url = window.location.origin + '//?channel=' + encodeURIComponent(CHANNEL_current.owner_id);
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
  var url = window.location.origin + '//?channel=' + encodeURIComponent(CHANNEL_current.owner_id);
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
  if (btn) btn.classList.add('active');
  document.getElementById('ch-shorts-tab').style.display = (tab === 'shorts') ? 'block' : 'none';
  document.getElementById('ch-music-tab').style.display  = (tab === 'music')  ? 'block' : 'none';
  document.getElementById('ch-about-tab').style.display  = (tab === 'about')  ? 'block' : 'none';
  var postsTab = document.getElementById('ch-posts-tab');
  if (postsTab) postsTab.style.display = (tab === 'posts') ? 'block' : 'none';

  if (tab === 'posts' && CHANNEL_current) {
    _loadChannelPosts();
  }

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
            '<div style="width:40px;height:40px;border-radius:8px;background:var(--bg3);display:flex;align-items:center;justify-content:center"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>' +
            '<div style="flex:1"><div style="font-size:.82rem;font-weight:700">' + escHtml(t.title) + '</div><div style="font-size:.68rem;color:var(--muted)">' + escHtml(t.artist) + '</div></div>' +
          '</div>';
        }).join('');
      })
      .catch(function () { listEl.innerHTML = '<div style="padding:1rem;color:var(--red);font-size:.8rem">Could not load music</div>'; });
  }
};

function _loadChannelPosts() {
  var el = document.getElementById('ch-posts-list');
  if (!el || !CHANNEL_current) return;
  el.innerHTML = '<div style="padding:2rem;text-align:center"><div class="spinner"></div></div>';
  api.get('/posts?user_id=' + encodeURIComponent(CHANNEL_current.owner_id))
    .then(function (res) {
      var posts = res.posts || [];
      var meId  = STATE.user && STATE.user.id;
      var isOwn = CHANNEL_current.owner_id === meId;
      var isAdmin = STATE.user && (STATE.user.role === 'admin_super' || STATE.user.role === 'admin_limited');

      var newPostBtn = '';
      if (isOwn || isAdmin) {
        newPostBtn = '<div style="padding:.75rem 1rem;border-bottom:1px solid var(--border)">' +
          '<div onclick="openChannelPostComposer()" style="display:flex;align-items:center;gap:.75rem;padding:.65rem 1rem;background:var(--bg3);border-radius:12px;cursor:pointer;color:var(--muted);font-size:.85rem">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
            'New Post...' +
          '</div>' +
        '</div>';
      }

      if (!posts.length) {
        el.innerHTML = newPostBtn + '<div style="padding:2rem;text-align:center;font-size:.85rem;color:var(--muted)">No posts yet</div>';
        return;
      }
      el.innerHTML = newPostBtn + posts.map(function (p) {
        return '<div style="padding:.85rem 1rem;border-bottom:1px solid var(--border)">' +
          '<div style="font-size:.88rem;line-height:1.55;unicode-bidi:plaintext">' + _linkHashtags(escHtml(p.content || p.caption || '')) + '</div>' +
          '<div style="font-size:.7rem;color:var(--muted);margin-top:.4rem">' + timeAgo(p.created_at) + '</div>' +
        '</div>';
      }).join('');
    })
    .catch(function () {
      var el2 = document.getElementById('ch-posts-list');
      if (el2) el2.innerHTML = '<div style="padding:1rem;color:var(--red);font-size:.8rem">Could not load posts</div>';
    });
}

window.openChannelPostComposer = function () {
  if (!CHANNEL_current) return;
  var text = prompt('Write a post:');
  if (!text || !text.trim()) return;
  api.post('/posts', { content: text.trim(), user_id: CHANNEL_current.owner_id })
    .then(function () { toast('✅ Posted!'); _loadChannelPosts(); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

// ── EXPLORE SCREEN — load channels ──
// ── EXPLORE STATE ──
var EXPLORE_tab = 'all';
var EXPLORE_searchTimer = null;

window.init_explore = function () {
  EXPLORE_tab = 'all';
  var inp = document.getElementById('explore-search-inp');
  if (inp) inp.value = '';
  var clr = document.getElementById('explore-clear-btn');
  if (clr) clr.style.display = 'none';
  document.querySelectorAll('.ctab[id^="etab-"]').forEach(function(b){b.classList.remove('active');});
  var allTab = document.getElementById('etab-all');
  if (allTab) allTab.classList.add('active');
  _loadExploreAll();
};

window.switchExploreTab = function (tab, btn) {
  EXPLORE_tab = tab;
  document.querySelectorAll('.ctab[id^="etab-"]').forEach(function(b){b.classList.remove('active');});
  btn.classList.add('active');
  var q = (document.getElementById('explore-search-inp')||{}).value || '';
  if (q.trim().length >= 2) {
    _doExploreSearch(q);
  } else {
    _loadExploreAll();
  }
};

window.onExploreSearch = function () {
  var inp = document.getElementById('explore-search-inp');
  var clr = document.getElementById('explore-clear-btn');
  var q = inp ? inp.value : '';
  if (clr) clr.style.display = q ? 'block' : 'none';
  clearTimeout(EXPLORE_searchTimer);
  if (!q.trim()) { _loadExploreAll(); return; }
  EXPLORE_searchTimer = setTimeout(function () { _doExploreSearch(q); }, 350);
};

window.clearExploreSearch = function () {
  var inp = document.getElementById('explore-search-inp');
  if (inp) inp.value = '';
  var clr = document.getElementById('explore-clear-btn');
  if (clr) clr.style.display = 'none';
  _loadExploreAll();
};

function _doExploreSearch(q) {
  var body = document.getElementById('explore-body');
  if (!body) return;
  body.innerHTML = '<div style="padding:2rem;text-align:center"><div class="spinner"></div></div>';

  var tab = EXPLORE_tab;
  var calls = [];

  if (tab === 'all' || tab === 'users') {
    calls.push(api.get('/users/search?q=' + encodeURIComponent(q), true).catch(function(){ return { users: [] }; }));
  } else { calls.push(Promise.resolve({ users: [] })); }

  if (tab === 'all' || tab === 'channels') {
    calls.push(api.get('/channels?search=' + encodeURIComponent(q), true).catch(function(){ return { channels: [] }; }));
  } else { calls.push(Promise.resolve({ channels: [] })); }

  if (tab === 'all' || tab === 'groups') {
    calls.push(api.get('/chat/rooms?search=' + encodeURIComponent(q), true).catch(function(){ return { rooms: [] }; }));
  } else { calls.push(Promise.resolve({ rooms: [] })); }

  Promise.all(calls).then(function (res) {
    var users    = res[0].users || [];
    var channels = res[1].channels || [];
    var groups   = (res[2].rooms || []).filter(function(r){ return r.type === 'group'; });
    var html = '';

    if (users.length) {
      html += _exploreSection('People', users.map(function(u){ return _userRow(u); }).join(''));
    }
    if (channels.length) {
      html += _exploreSection('Channels', channels.map(function(c){ return _channelRow(c); }).join(''));
    }
    if (groups.length) {
      html += _exploreSection('Groups', groups.map(function(g){ return _groupRow(g); }).join(''));
    }
    if (!html) html = '<div style="padding:3rem;text-align:center;color:var(--muted);font-size:.88rem">No results for "' + escHtml(q) + '"</div>';
    body.innerHTML = html;
  });
}

function _loadExploreAll() {
  var body = document.getElementById('explore-body');
  if (!body) return;
  body.innerHTML = '<div style="padding:2rem;text-align:center"><div class="spinner"></div></div>';

  var tab = EXPLORE_tab;
  var calls = [];

  if (tab === 'all' || tab === 'users') {
    calls.push(api.get('/users/search?featured=1', true).catch(function(){ return { users: [] }; }));
  } else { calls.push(Promise.resolve({ users: [] })); }

  if (tab === 'all' || tab === 'channels') {
    calls.push(api.get('/channels', true).catch(function(){ return { channels: [] }; }));
  } else { calls.push(Promise.resolve({ channels: [] })); }

  if (tab === 'all' || tab === 'groups') {
    calls.push(api.get('/chat/rooms?public=1', true).catch(function(){ return { rooms: [] }; }));
  } else { calls.push(Promise.resolve({ rooms: [] })); }

  Promise.all(calls).then(function (res) {
    var users    = (res[0].users || []).slice(0, 10);
    var channels = (res[1].channels || []).slice(0, 10);
    var groups   = (res[2].rooms || []).filter(function(r){ return r.type === 'group'; }).slice(0, 10);
    var html = '';

    if (tab === 'all' || tab === 'users') {
      html += _exploreSection('People', users.length ? users.map(function(u){ return _userRow(u); }).join('') : '<div style="padding:1rem;color:var(--muted);font-size:.82rem;text-align:center">No users yet</div>');
    }
    if (tab === 'all' || tab === 'channels') {
      html += _exploreSection('Channels', channels.length ? channels.map(function(c){ return _channelRow(c); }).join('') : '<div style="padding:1rem;color:var(--muted);font-size:.82rem;text-align:center">No channels yet</div>');
    }
    if (tab === 'all' || tab === 'groups') {
      html += _exploreSection('Public Groups', groups.length ? groups.map(function(g){ return _groupRow(g); }).join('') : '<div style="padding:1rem;color:var(--muted);font-size:.82rem;text-align:center">No public groups yet</div>');
    }
    body.innerHTML = html || '<div style="padding:3rem;text-align:center;color:var(--muted)">Nothing to explore yet!</div>';
  });
}

function _exploreSection(title, content) {
  return '<div style="padding:.5rem .75rem .2rem"><div style="font-size:.65rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:700;margin-bottom:.4rem">' + title + '</div>' +
    '<div style="background:var(--surface);border-radius:14px;overflow:hidden;border:1px solid var(--border)">' + content + '</div>' +
  '</div><div style="height:.5rem"></div>';
}

function _userRow(u) {
  var av = u.photo_url
    ? '<div style="width:44px;height:44px;border-radius:50%;background-image:url(' + u.photo_url + ');background-size:cover;flex-shrink:0"></div>'
    : '<div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,var(--gold),var(--gold-l));display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;flex-shrink:0">' + (u.nickname||'U').slice(0,1).toUpperCase() + '</div>';
  return '<div style="display:flex;align-items:center;gap:.65rem;padding:.65rem .85rem;border-bottom:.5px solid var(--border);cursor:pointer" onclick="openUserProfile(\'' + u.id + '\')">' +
    av +
    '<div style="flex:1;min-width:0">' +
      '<div style="font-size:.88rem;font-weight:700">@' + escHtml(u.nickname||'User') + (u.verified?' ✅':'') + '</div>' +
      (u.bio ? '<div style="font-size:.72rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(u.bio) + '</div>' : '') +
    '</div>' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>' +
  '</div>';
}

function _channelRow(c) {
  var av = c.photo_url
    ? '<div style="width:46px;height:46px;border-radius:12px;background-image:url(' + c.photo_url + ');background-size:cover;flex-shrink:0"></div>'
    : '<div style="width:46px;height:46px;border-radius:12px;background:linear-gradient(135deg,#1565C0,#1976D2);display:flex;align-items:center;justify-content:center;font-size:1.1rem;font-weight:800;color:#fff;flex-shrink:0">' + (c.nickname||'C').slice(0,1).toUpperCase() + '</div>';
  return '<div style="display:flex;align-items:center;gap:.65rem;padding:.65rem .85rem;border-bottom:.5px solid var(--border);cursor:pointer" onclick="CHANNEL_pendingOwnerId=\'' + c.owner_id + '\';navTo(\'channel\')">' +
    av +
    '<div style="flex:1;min-width:0">' +
      '<div style="font-size:.88rem;font-weight:700">@' + escHtml(c.nickname||'Channel') + (c.verified?' ✅':'') + '</div>' +
      '<div style="font-size:.72rem;color:var(--muted)">' + fmtN(c.followers||0) + ' followers</div>' +
    '</div>' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>' +
  '</div>';
}

function _groupRow(g) {
  return '<div style="display:flex;align-items:center;gap:.65rem;padding:.65rem .85rem;border-bottom:.5px solid var(--border);cursor:pointer" onclick="goPage(\'/chat\')">' +
    '<div style="width:46px;height:46px;border-radius:12px;background:linear-gradient(135deg,#7C3AED,#5B21B6);display:flex;align-items:center;justify-content:center;font-size:1.1rem;font-weight:800;color:#fff;flex-shrink:0">' + (g.nick||g.name||'G').slice(0,1).toUpperCase() + '</div>' +
    '<div style="flex:1;min-width:0">' +
      '<div style="font-size:.88rem;font-weight:700">' + escHtml(g.nick||g.name||'Group') + '</div>' +
      '<div style="font-size:.72rem;color:var(--muted)">' + (g.members||0) + ' members</div>' +
    '</div>' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>' +
  '</div>';
}

/* ══════════════════════════════════
   USER PROFILE SCREEN
══════════════════════════════════ */
var PROFILE_userId = null;

window.openUserProfile = function (userId) {
  if (!userId) return;
  PROFILE_userId = userId;
  navTo('profile');
  _buildProfileScreen(userId);
};

window.navBack = function () {
  navTo(STATE.prevScreen || 'home');
};

function _buildProfileScreen(userId) {
  var body = document.getElementById('profile-screen-body');
  var nick = document.getElementById('profile-screen-nick');
  if (body) body.innerHTML = '<div style="text-align:center;padding:3rem"><div class="spinner"></div></div>';

  Promise.all([
    api.get('/profile?user_id=' + encodeURIComponent(userId), true),
    api.get('/follows?user_id=' + encodeURIComponent(userId), true),
    api.get('/statuses?user_id=' + encodeURIComponent(userId), true).catch(function(){ return { statuses: [] }; }),
  ]).then(function (res) {
    var p     = res[0].profile || {};
    var stats = res[0].stats   || {};
    var fdata = res[1];
    var statusData = (res[2].statuses || [])[0]; // statuses for this one user, if visible
    var hasStatus = statusData && statusData.slides && statusData.slides.length;
    var isMe  = STATE.user && STATE.user.id === userId;

    if (nick) nick.textContent = '@' + (p.nickname || 'User');

    var avatarInner = p.photo_url
      ? '<div style="width:80px;height:80px;border-radius:50%;background-image:url(' + p.photo_url + ');background-size:cover;background-position:center;border:2.5px solid var(--surface);flex-shrink:0"></div>'
      : '<div style="width:80px;height:80px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:2rem;border:2.5px solid var(--surface);flex-shrink:0">' + (p.nickname||'U').slice(0,1).toUpperCase() + '</div>';

    // Wrap avatar with a status ring if they have an active status
    var avatarHtml = hasStatus
      ? '<div style="position:relative;width:86px;height:86px;cursor:pointer" onclick="_viewProfileStatus(\'' + userId + '\')">' +
          '<svg width="86" height="86" style="position:absolute;top:0;left:0">' + _svSegments(statusData.slides.length, false) + '</svg>' +
          '<div style="position:absolute;inset:3px">' + avatarInner + '</div>' +
        '</div>'
      : avatarInner;

    var followBtn = '';
    if (!isMe) {
      if (fdata.is_following) {
        followBtn = '<button onclick="unfollowUser(\'' + userId + '\')" style="padding:.45rem 1.25rem;background:var(--bg3);border:1.5px solid var(--border);border-radius:20px;font-size:.82rem;cursor:pointer;font-family:inherit;font-weight:600;color:var(--text)">Following</button>';
      } else if (fdata.has_pending_request) {
        followBtn = '<button disabled style="padding:.45rem 1.25rem;background:var(--bg3);border:1.5px solid var(--border);border-radius:20px;font-size:.82rem;font-family:inherit;font-weight:600;color:var(--muted)">Requested</button>';
      } else {
        followBtn = '<button onclick="followUser(\'' + userId + '\')" style="padding:.45rem 1.25rem;background:var(--gold);border:none;border-radius:20px;font-size:.82rem;cursor:pointer;font-family:inherit;font-weight:700;color:#fff">' + (fdata.is_private ? 'Request' : 'Follow') + '</button>';
      }
    } else {
      followBtn = '<button onclick="navTo(\'settings\')" style="padding:.45rem 1.25rem;background:var(--bg3);border:1.5px solid var(--border);border-radius:20px;font-size:.82rem;cursor:pointer;font-family:inherit;font-weight:600">Edit Profile</button>';
    }

    var msgBtn = !isMe
      ? '<button onclick="openDMWith(\'' + userId + '\')" style="padding:.45rem 1.25rem;background:var(--bg3);border:1.5px solid var(--border);border-radius:20px;font-size:.82rem;cursor:pointer;font-family:inherit;font-weight:600">Message</button>'
      : '';

    var bioHtml = p.bio ? '<div style="font-size:.85rem;color:var(--text);text-align:center;padding:0 1.25rem;margin-bottom:.75rem;line-height:1.5">' + escHtml(p.bio) + '</div>' : '';

    var linksHtml = '';
    if (p.location) linksHtml += '<span style="font-size:.75rem;color:var(--muted)">📍 ' + escHtml(p.location) + '</span>';
    if (p.website)  linksHtml += '<a href="' + escHtml(p.website) + '" target="_blank" style="font-size:.75rem;color:var(--blue);text-decoration:none">🌐 Website</a>';
    if (linksHtml)  linksHtml = '<div style="display:flex;gap:.75rem;justify-content:center;flex-wrap:wrap;margin-bottom:.75rem">' + linksHtml + '</div>';

    if (body) body.innerHTML =
      // Banner
      (p.banner_url ? '<div style="width:100%;height:120px;background-image:url(' + p.banner_url + ');background-size:cover;background-position:center"></div>' : '<div style="width:100%;height:80px;background:linear-gradient(135deg,var(--gold),var(--gold-l))"></div>') +

      // Profile card
      '<div style="padding:0 1rem 1rem;background:var(--surface);border-bottom:1px solid var(--border)">' +
        '<div style="display:flex;align-items:flex-end;gap:.75rem;margin-top:-40px;margin-bottom:.75rem">' +
          avatarHtml +
          '<div style="flex:1;padding-bottom:.25rem">' +
            '<div style="font-size:1rem;font-weight:800">' + escHtml(p.nickname || 'User') + (p.verified ? ' ✅' : '') + '</div>' +
            (p.role && p.role !== 'member' ? '<div style="font-size:.68rem;color:var(--gold);font-weight:700;text-transform:uppercase">' + escHtml(p.role) + '</div>' : '') +
          '</div>' +
        '</div>' +
        bioHtml + linksHtml +
        // Stats row
        '<div style="display:flex;justify-content:center;gap:2rem;margin-bottom:.75rem">' +
          _pStat(fdata.followers || 0, 'Followers', 'openFollowersList(\'' + userId + '\')') +
          _pStat(fdata.following || 0, 'Following', 'openFollowingList(\'' + userId + '\')') +
          _pStat(stats.shorts || 0, 'Videos', '') +
          _pStat(stats.music  || 0, 'Music', '') +
        '</div>' +
        // Action buttons
        '<div style="display:flex;gap:.5rem;justify-content:center">' + followBtn + msgBtn + '</div>' +
      '</div>' +

      // Content tabs
      '<div style="display:flex;border-bottom:1px solid var(--border);background:var(--surface);margin-top:.5rem">' +
        '<button class="ctab active" onclick="switchProfileTab(this,\'shorts\')" style="flex:1">Videos</button>' +
        '<button class="ctab" onclick="switchProfileTab(this,\'music\')" style="flex:1">Music</button>' +
      '</div>' +
      '<div id="profile-content-area"><div style="padding:2rem;text-align:center;color:var(--muted);font-size:.85rem">Loading...</div></div>';

    _loadProfileContent(userId, 'shorts');

  }).catch(function (err) {
    if (body) body.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--muted)">' + escHtml(err.message) + '</div>';
  });
}

function _pStat(val, label, onclick) {
  return '<div style="text-align:center;cursor:' + (onclick ? 'pointer' : 'default') + '"' + (onclick ? ' onclick="' + onclick + '"' : '') + '>' +
    '<div style="font-size:1rem;font-weight:800">' + fmtN(val) + '</div>' +
    '<div style="font-size:.68rem;color:var(--muted)">' + label + '</div>' +
  '</div>';
}

window.switchProfileTab = function (btn, tab) {
  document.querySelectorAll('#profile-screen-body .ctab').forEach(function (b) { b.classList.remove('active'); });
  btn.classList.add('active');
  _loadProfileContent(PROFILE_userId, tab);
};

function _loadProfileContent(userId, tab) {
  var area = document.getElementById('profile-content-area');
  if (!area) return;
  area.innerHTML = '<div style="padding:2rem;text-align:center"><div class="spinner"></div></div>';

  if (tab === 'shorts') {
    api.get('/shorts?owner_id=' + encodeURIComponent(userId), true)
      .then(function (res) {
        var items = res.shorts || [];
        if (!items.length) { area.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--muted);font-size:.85rem">No videos yet</div>'; return; }
        area.innerHTML = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:2px">' +
          items.map(function (s) {
            return '<div style="aspect-ratio:9/16;position:relative;background:#000;overflow:hidden;cursor:pointer" onclick="openShort(\'' + s.id + '\')">' +
              (s.media_url ? '<video src="' + s.media_url + '" style="width:100%;height:100%;object-fit:cover" preload="none"></video>' : '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#fff">📹</div>') +
              '<div style="position:absolute;bottom:4px;left:4px;font-size:.68rem;color:#fff;font-weight:700">▶ ' + fmtN(s.views||0) + '</div>' +
            '</div>';
          }).join('') +
        '</div>';
      })
      .catch(function () { area.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--muted)">Could not load videos</div>'; });
  } else if (tab === 'music') {
    api.get('/music?owner_id=' + encodeURIComponent(userId), true)
      .then(function (res) {
        var items = res.tracks || res.music || [];
        if (!items.length) { area.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--muted);font-size:.85rem">No music yet</div>'; return; }
        area.innerHTML = '<div style="padding:.5rem">' +
          items.map(function (t) {
            return '<div style="display:flex;align-items:center;gap:.65rem;padding:.6rem .5rem;border-bottom:.5px solid var(--border)">' +
              '<div style="width:44px;height:44px;border-radius:8px;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0">🎵</div>' +
              '<div style="flex:1;min-width:0">' +
                '<div style="font-size:.85rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(t.title||'Track') + '</div>' +
                '<div style="font-size:.7rem;color:var(--muted)">' + fmtN(t.plays||0) + ' plays</div>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>';
      })
      .catch(function () { area.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--muted)">Could not load music</div>'; });
  }
}

window._viewProfileStatus = function (userId) {
  api.get('/statuses?user_id=' + encodeURIComponent(userId), true)
    .then(function (res) {
      var data = (res.statuses || [])[0];
      if (!data || !data.slides || !data.slides.length) { toast('No active status'); return; }
      HOME_svStatuses = [data];
      openSV(0);
    })
    .catch(function () { toast('Could not load status'); });
};

window.followUser = function (userId) {
  api.post('/follows', { user_id: userId })
    .then(function (res) {
      if (res.requested) { toast('Follow request sent'); }
      else { toast('Following!'); }
      _buildProfileScreen(userId);
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.unfollowUser = function (userId) {
  api.del('/follows?user_id=' + encodeURIComponent(userId))
    .then(function () { toast('Unfollowed'); _buildProfileScreen(userId); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.openDMWith = function (userId) {
  api.post('/chat/rooms', { type: 'private', other_user_id: userId })
    .then(function (res) {
      goPage('/chat');
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.openFollowersList = function (userId) {
  _openFollowModal('Followers', '/follows?followers=1&user_id=' + encodeURIComponent(userId));
};

window.openFollowingList = function (userId) {
  _openFollowModal('Following', '/follows?following=1&user_id=' + encodeURIComponent(userId));
};

function _openFollowModal(title, path) {
  var modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;z-index:8000;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;justify-content:center';
  modal.innerHTML =
    '<div style="background:var(--surface);border-radius:20px 20px 0 0;width:100%;max-width:500px;padding:1.25rem;max-height:75vh;display:flex;flex-direction:column">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.85rem;flex-shrink:0">' +
        '<div style="font-size:.95rem;font-weight:700">' + title + '</div>' +
        '<button onclick="this.closest(\'div[style*=fixed]\').remove()" style="background:none;border:none;cursor:pointer;color:var(--muted)">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
      '</div>' +
      '<div id="follow-list-content" style="flex:1;overflow-y:auto"><div style="text-align:center;padding:1.5rem"><div class="spinner"></div></div></div>' +
    '</div>';
  document.body.appendChild(modal);
  modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });

  api.get(path, true).then(function (res) {
    var el = document.getElementById('follow-list-content');
    if (!el) return;
    var users = res.users || [];
    if (!users.length) { el.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--muted);font-size:.85rem">Nobody here yet</div>'; return; }
    el.innerHTML = users.map(function (u) {
      return '<div style="display:flex;align-items:center;gap:.65rem;padding:.65rem 0;border-bottom:.5px solid var(--border);cursor:pointer" onclick="this.closest(\'div[style*=fixed]\').remove();openUserProfile(\'' + u.id + '\')">' +
        (u.photo_url
          ? '<div style="width:42px;height:42px;border-radius:50%;background-image:url(' + u.photo_url + ');background-size:cover;flex-shrink:0"></div>'
          : '<div style="width:42px;height:42px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0">' + (u.nickname||'U').slice(0,1).toUpperCase() + '</div>') +
        '<div>' +
          '<div style="font-size:.88rem;font-weight:700">@' + escHtml(u.nickname) + (u.verified ? ' ✅' : '') + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }).catch(function () {});
}

/* ══════════════════════════════════
   IN-APP NOTIFICATION PANEL
══════════════════════════════════ */
window.openNotifPanel = function () {
  var existing = document.getElementById('notif-panel-modal');
  if (existing) { existing.remove(); return; }

  var modal = document.createElement('div');
  modal.id = 'notif-panel-modal';
  modal.style.cssText = 'position:fixed;top:56px;right:.75rem;z-index:8000;width:min(340px,calc(100vw - 1.5rem));background:var(--surface);border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.15);border:1px solid var(--border);overflow:hidden;max-height:70vh;display:flex;flex-direction:column';

  modal.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;padding:.75rem 1rem;border-bottom:1px solid var(--border);flex-shrink:0">' +
      '<div style="font-size:.9rem;font-weight:700">Notifications</div>' +
      '<button onclick="document.getElementById(\'notif-panel-modal\').remove()" style="background:none;border:none;cursor:pointer;color:var(--muted);padding:.2rem">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button>' +
    '</div>' +
    '<div id="notif-panel-list" style="overflow-y:auto;flex:1"><div style="padding:1.5rem;text-align:center"><div class="spinner"></div></div></div>' +
    '<div style="padding:.5rem .75rem;border-top:1px solid var(--border);flex-shrink:0">' +
      '<button onclick="goPage(\'/chat\')" style="width:100%;padding:.5rem;background:var(--bg3);border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-size:.8rem;color:var(--blue);font-weight:600">Open Chats</button>' +
    '</div>';

  document.body.appendChild(modal);

  // Close on outside click
  setTimeout(function () {
    document.addEventListener('click', function handler(e) {
      if (!modal.contains(e.target) && !e.target.closest('.icon-btn')) {
        modal.remove();
        document.removeEventListener('click', handler);
      }
    });
  }, 100);

  // Load unread chats as notifications
  api.get('/chat/rooms', true).then(function (res) {
    var el = document.getElementById('notif-panel-list');
    if (!el) return;
    var rooms = (res.rooms || []).filter(function(r){ return r.unread > 0; });

    if (!rooms.length) {
      el.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--muted);font-size:.85rem">No new notifications 🎉</div>';
      return;
    }

    el.innerHTML = rooms.map(function (r) {
      var av = r.photo_url
        ? '<div style="width:42px;height:42px;border-radius:50%;background-image:url(' + r.photo_url + ');background-size:cover;flex-shrink:0"></div>'
        : '<div style="width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,var(--gold),var(--gold-l));display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;flex-shrink:0">' + (r.nick||'?').slice(0,1).toUpperCase() + '</div>';
      return '<div style="display:flex;align-items:center;gap:.65rem;padding:.65rem 1rem;border-bottom:.5px solid var(--border);cursor:pointer" onclick="document.getElementById(\'notif-panel-modal\').remove();goPage(\'/chat\')">' +
        av +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:.85rem;font-weight:700">' + escHtml(r.nick || 'Chat') + '</div>' +
          '<div style="font-size:.72rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(r.last_msg || 'New message') + '</div>' +
        '</div>' +
        '<div style="background:var(--gold);color:#fff;border-radius:10px;padding:.1rem .4rem;font-size:.72rem;font-weight:800;flex-shrink:0">' + r.unread + '</div>' +
      '</div>';
    }).join('');
  }).catch(function () {
    var el = document.getElementById('notif-panel-list');
    if (el) el.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--muted);font-size:.85rem">Could not load notifications</div>';
  });
};

/* ══════════════════════════════════
   POST COMMENTS
══════════════════════════════════ */
window.openPostComments = function (postId) {
  var modal = document.createElement('div');
  modal.id = 'comments-modal-' + postId;
  modal.style.cssText = 'position:fixed;inset:0;z-index:8000;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;justify-content:center';
  modal.innerHTML =
    '<div style="background:var(--surface);border-radius:20px 20px 0 0;width:100%;max-width:500px;max-height:80vh;display:flex;flex-direction:column">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:.85rem 1.1rem;border-bottom:1px solid var(--border);flex-shrink:0">' +
        '<div style="font-weight:700;font-size:.92rem">Comments</div>' +
        '<button onclick="this.closest(\'div[style*=fixed]\').remove()" style="background:none;border:none;cursor:pointer;color:var(--muted)">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
      '</div>' +
      '<div id="comments-list-' + postId + '" style="flex:1;overflow-y:auto;padding:.5rem .85rem"><div style="text-align:center;padding:1.5rem"><div class="spinner"></div></div></div>' +
      '<div style="padding:.6rem .85rem max(.6rem,env(safe-area-inset-bottom));border-top:1px solid var(--border);display:flex;gap:.5rem;flex-shrink:0">' +
        '<input id="comment-inp-' + postId + '" placeholder="Write a comment..." style="flex:1;padding:.5rem .75rem;background:var(--bg3);border:1.5px solid var(--border);border-radius:20px;color:var(--text);font-size:.85rem;font-family:inherit;outline:none" onkeydown="if(event.key===\'Enter\')submitComment(\'' + postId + '\')">' +
        '<button onclick="submitComment(\'' + postId + '\')" style="width:38px;height:38px;border-radius:50%;background:var(--gold);border:none;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
  modal.addEventListener('click', function(e){ if(e.target===modal) modal.remove(); });

  // Load comments
  api.get('/posts/comments?post_id=' + encodeURIComponent(postId), true)
    .then(function (res) {
      var el = document.getElementById('comments-list-' + postId);
      if (!el) return;
      var comments = res.comments || [];
      if (!comments.length) {
        el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--muted);font-size:.85rem">No comments yet — be first!</div>';
        return;
      }
      el.innerHTML = comments.map(function (c) {
        return '<div style="padding:.6rem 0;border-bottom:.5px solid var(--border)">' +
          '<div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.2rem">' +
            '<span style="font-size:.8rem;font-weight:700">@' + escHtml(c.nickname||c.username||'User') + '</span>' +
            '<span style="font-size:.68rem;color:var(--muted)">' + timeAgo(c.created_at) + '</span>' +
          '</div>' +
          '<div style="font-size:.85rem;color:var(--text)">' + (typeof filterContent==='function'?filterContent(escHtml(c.text)):escHtml(c.text)) + '</div>' +
        '</div>';
      }).join('');
    })
    .catch(function () {
      var el = document.getElementById('comments-list-' + postId);
      if (el) el.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--muted)">Could not load comments</div>';
    });
};

window.submitComment = function (postId) {
  var inp = document.getElementById('comment-inp-' + postId);
  if (!inp) return;
  var text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  inp.disabled = true;

  api.post('/posts/comments', { post_id: postId, text: text })
    .then(function () {
      inp.disabled = false;
      api.bust('/posts/comments?post_id=' + postId);
      openPostComments(postId);
      // Update comment count
      var countEl = document.querySelector('[data-post-comments="' + postId + '"]');
      if (countEl) countEl.textContent = parseInt(countEl.textContent || 0) + 1;
    })
    .catch(function (err) {
      inp.disabled = false;
      toast('❌ ' + err.message);
    });
};

/* ══════════════════════════════════
   HASHTAGS
══════════════════════════════════ */
function _linkHashtags(html) {
  return html.replace(/#([\w\u0590-\u05FF\uFB1D-\uFB4F]+)/g, function (match, tag) {
    return '<span style="color:var(--blue);cursor:pointer;font-weight:600" onclick="searchHashtag(\'' + tag + '\')">' + match + '</span>';
  });
}

window.searchHashtag = function (tag) {
  // Switch to explore and search for hashtag
  navTo('explore');
  setTimeout(function () {
    var inp = document.getElementById('explore-search-inp');
    if (inp) {
      inp.value = '#' + tag;
      onExploreSearch();
    }
  }, 200);
};

/* ══════════════════════════════════
   TRENDING
══════════════════════════════════ */
window.loadTrending = function (type) {
  // type: 'posts' | 'shorts' | 'music'
  var path = type === 'shorts' ? '/shorts?trending=1' : type === 'music' ? '/music?trending=1' : '/posts?trending=1';
  api.get(path, true).then(function (res) {
    toast('Trending ' + type + ' loaded!');
    if (type === 'shorts') goPage('/shorts');
    else if (type === 'music') goPage('/music');
  }).catch(function () { toast('Could not load trending'); });
};

/* ══════════════════════════════════
   SPAM DETECTION — rate limiting
══════════════════════════════════ */
var _postRateLimiter = [];
window.checkPostRateLimit = function () {
  var now = Date.now();
  _postRateLimiter = _postRateLimiter.filter(function (t) { return now - t < 60000; });
  if (_postRateLimiter.length >= 10) {
    toast('⚠️ Too many posts. Please wait a minute.');
    return false;
  }
  _postRateLimiter.push(now);
  return true;
};

/* ══════════════════════════════════
   SEARCH HISTORY
══════════════════════════════════ */
var SEARCH_history = [];
try { SEARCH_history = JSON.parse(localStorage.getItem('yp_search_hist') || '[]'); } catch(e) {}

window.addSearchHistory = function (q) {
  if (!q || !q.trim()) return;
  SEARCH_history = [q].concat(SEARCH_history.filter(function(h){ return h !== q; })).slice(0, 10);
  try { localStorage.setItem('yp_search_hist', JSON.stringify(SEARCH_history)); } catch(e) {}
};

window.getSearchHistory = function () { return SEARCH_history; };

window.clearSearchHistory = function () {
  SEARCH_history = [];
  try { localStorage.removeItem('yp_search_hist'); } catch(e) {}
  toast('Search history cleared');
};

/* ══════════════════════════════════
   MISSING FUNCTIONS
══════════════════════════════════ */

// Open a short from profile screen grid
window.openShort = function (shortId) {
  goPage('/shorts?id=' + encodeURIComponent(shortId));
};

// Feedback modal
window.openFeedbackModal = function () {
  var modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;z-index:8000;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;justify-content:center';
  modal.innerHTML =
    '<div style="background:var(--surface);border-radius:20px 20px 0 0;width:100%;max-width:500px;padding:1.25rem;padding-bottom:max(1.25rem,env(safe-area-inset-bottom))">' +
      '<div style="font-size:.95rem;font-weight:700;margin-bottom:.25rem">Send Feedback</div>' +
      '<div style="font-size:.75rem;color:var(--muted);margin-bottom:.85rem">Help us improve YID PLUS</div>' +
      '<div style="display:flex;gap:.5rem;margin-bottom:.75rem">' +
        '<button class="feedback-type-btn active" id="fb-type-bug" onclick="selectFeedbackType(\'bug\',this)" style="flex:1;padding:.45rem;border-radius:8px;border:1.5px solid #E11D48;background:#FFF1F2;color:#E11D48;cursor:pointer;font-size:.78rem;font-weight:600;font-family:inherit">🐛 Bug</button>' +
        '<button class="feedback-type-btn" id="fb-type-suggest" onclick="selectFeedbackType(\'suggestion\',this)" style="flex:1;padding:.45rem;border-radius:8px;border:1.5px solid var(--border);background:var(--bg3);color:var(--muted);cursor:pointer;font-size:.78rem;font-weight:600;font-family:inherit">💡 Suggestion</button>' +
        '<button class="feedback-type-btn" id="fb-type-other" onclick="selectFeedbackType(\'other\',this)" style="flex:1;padding:.45rem;border-radius:8px;border:1.5px solid var(--border);background:var(--bg3);color:var(--muted);cursor:pointer;font-size:.78rem;font-weight:600;font-family:inherit">💬 Other</button>' +
      '</div>' +
      '<textarea id="feedback-text" placeholder="Describe the issue or suggestion..." rows="4" style="width:100%;box-sizing:border-box;padding:.65rem .75rem;background:var(--bg3);border:1.5px solid var(--border);border-radius:10px;color:var(--text);font-size:.88rem;font-family:inherit;outline:none;resize:none;margin-bottom:.65rem"></textarea>' +
      '<div style="display:flex;gap:.5rem">' +
        '<button onclick="submitFeedback()" style="flex:1;padding:.65rem;background:var(--gold);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-family:inherit">Send Feedback</button>' +
        '<button onclick="this.closest(\'div[style*=fixed]\').remove()" style="padding:.65rem 1rem;background:var(--bg3);border:none;border-radius:10px;cursor:pointer;font-family:inherit">Cancel</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
  modal.addEventListener('click', function(e){ if(e.target===modal) modal.remove(); });
};

var _feedbackType = 'bug';
window.selectFeedbackType = function (type, btn) {
  _feedbackType = type;
  document.querySelectorAll('.feedback-type-btn').forEach(function(b){
    b.style.borderColor = 'var(--border)';
    b.style.background = 'var(--bg3)';
    b.style.color = 'var(--muted)';
  });
  btn.style.borderColor = 'var(--gold)';
  btn.style.background = 'rgba(201,168,76,.1)';
  btn.style.color = 'var(--gold)';
};

window.submitFeedback = function () {
  var text = (document.getElementById('feedback-text') || {}).value || '';
  if (!text.trim()) { toast('Please write something first'); return; }
  api.post('/feedback', { type: _feedbackType, text: text.trim(), device: navigator.userAgent.slice(0, 100) })
    .then(function () {
      document.querySelector('div[style*="z-index:8000"]') && document.querySelector('div[style*="z-index:8000"]').remove();
      toast('✅ Feedback sent! Thank you!');
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

/* ══════════════════════════════════
   FAST HOME RENDERERS
   (called from batched _fetchHomeData)
══════════════════════════════════ */
function _renderStatusRow(statuses) {
  // reuse existing buildStatusRow logic but with pre-fetched data
  var el = document.getElementById('status-row');
  if (!el) return;
  HOME_svStatuses = statuses;

  var me = STATE.user;
  var html = '';

  // My status bubble
  html += '<div style="display:flex;flex-direction:column;align-items:center;gap:.3rem;cursor:pointer;flex-shrink:0" onclick="openStatusUpload()">' +
    '<div style="position:relative;width:58px;height:58px">' +
      '<div style="width:58px;height:58px;border-radius:50%;border:2.5px dashed var(--blue);display:flex;align-items:center;justify-content:center;background:var(--bg3);overflow:hidden">' +
        (me && me.photo_url
          ? '<img src="' + me.photo_url + '" style="width:100%;height:100%;object-fit:cover" loading="lazy">'
          : '<div style="font-size:1.5rem;font-weight:700;color:var(--blue)">' + ((me&&me.nickname)||'?').slice(0,1).toUpperCase() + '</div>') +
      '</div>' +
      '<div style="position:absolute;bottom:-2px;right:-2px;width:20px;height:20px;border-radius:50%;background:var(--blue);border:2px solid var(--surface);display:flex;align-items:center;justify-content:center;color:#fff;font-size:.85rem;font-weight:700">+</div>' +
    '</div>' +
    '<div style="font-size:.65rem;color:var(--muted);text-align:center">My Status</div>' +
  '</div>';

  // Other statuses — use index so openSV(idx) works correctly
  var idx = 0;
  statuses.forEach(function (s, i) {
    if (!s || !s.user_id || (me && s.user_id === me.id)) return;
    var seg = _svSegments(s.count || 1, false);
    html += '<div style="display:flex;flex-direction:column;align-items:center;gap:.3rem;cursor:pointer;flex-shrink:0" onclick="openSV(' + i + ')">' +
      '<div style="position:relative;width:58px;height:58px">' +
        '<svg width="58" height="58" style="position:absolute;top:0;left:0">' + seg + '</svg>' +
        '<div style="position:absolute;inset:4px;border-radius:50%;overflow:hidden;background:var(--bg3)">' +
          (s.photo_url
            ? '<img src="' + s.photo_url + '" style="width:100%;height:100%;object-fit:cover" loading="lazy">'
            : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.3rem;font-weight:700;color:var(--blue)">' + (s.nick||'?').slice(0,1).toUpperCase() + '</div>') +
        '</div>' +
      '</div>' +
      '<div style="font-size:.65rem;color:var(--text);text-align:center;max-width:58px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(s.nick||'') + '</div>' +
    '</div>';
  });

  el.innerHTML = html;
}

function _renderShortsPrev(shorts) {
  var el = document.getElementById('home-shorts');
  if (!el) return;
  if (!shorts.length) { el.closest('.home-section') && (el.closest('.home-section').style.display = 'none'); return; }
  el.innerHTML = shorts.slice(0,6).map(function (s) {
    return '<div style="flex-shrink:0;width:100px;cursor:pointer" onclick="goPage(\'/shorts\')">' +
      '<div style="width:100px;height:160px;border-radius:12px;background:#111;overflow:hidden;position:relative">' +
        (s.media_url ? '<video src="' + s.media_url + '" style="width:100%;height:100%;object-fit:cover" preload="none"></video>' : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2rem">📹</div>') +
        '<div style="position:absolute;bottom:0;left:0;right:0;padding:.35rem .4rem;background:linear-gradient(transparent,rgba(0,0,0,.7))">' +
          '<div style="font-size:.6rem;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">@' + escHtml(s.nick||'') + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function _renderChannelsPrev(channels) {
  var el = document.getElementById('home-channels');
  if (!el) return;
  el.innerHTML = channels.slice(0,6).map(function (c) {
    return '<div style="display:flex;align-items:center;gap:.65rem;padding:.6rem 0;border-bottom:.5px solid var(--border);cursor:pointer" onclick="CHANNEL_pendingOwnerId=\'' + c.owner_id + '\';navTo(\'channel\')">' +
      '<div style="width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,#1565C0,#1976D2);display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;flex-shrink:0">' + (c.nickname||'C').slice(0,1).toUpperCase() + '</div>' +
      '<div><div style="font-size:.85rem;font-weight:700">@' + escHtml(c.nickname||'') + '</div><div style="font-size:.7rem;color:var(--muted)">' + fmtN(c.followers||0) + ' followers</div></div>' +
    '</div>';
  }).join('');
}

function _renderFeed(posts) {
  var feed = document.getElementById('home-feed');
  if (!feed) return;
  if (!posts.length) {
    feed.innerHTML = '<div class="feed-state"><div style="font-size:2.5rem">📭</div><div class="feed-state-text">No posts yet</div></div>';
    return;
  }
  feed.innerHTML = '';
  posts.forEach(function (p) { feed.appendChild(buildPostCard(p)); });
}

function _renderBroadcast(list) {
  if (list && list[0]) showBroadcast(list[0].text);
}

function _updateBadgesFromRooms(rooms) {
  var unread = rooms.reduce(function(sum, r){ return sum + (r.unread||0); }, 0);
  ['nav-badge-chats','nav-badge-chats2'].forEach(function(id){
    var el = document.getElementById(id);
    if (!el) return;
    el.style.display = unread > 0 ? 'flex' : 'none';
    el.textContent = unread > 99 ? '99+' : unread;
  });
  var notifBadge = document.getElementById('notif-badge');
  if (notifBadge) {
    notifBadge.style.display = unread > 0 ? 'flex' : 'none';
    notifBadge.textContent = unread > 99 ? '99+' : unread;
  }
}

function _showWelcomeBannerIfFirst() {
  try {
    if (localStorage.getItem('yp_welcomed')) return;
    localStorage.setItem('yp_welcomed', '1');
    var bar = document.getElementById('broadcast-bar');
    if (!bar) return;
    var wb = document.createElement('div');
    wb.style.cssText = 'margin:.5rem .75rem;background:linear-gradient(135deg,rgba(21,101,192,.08),rgba(21,101,192,.04));border:1px solid rgba(21,101,192,.2);border-radius:14px;padding:.75rem 1rem;display:flex;align-items:center;gap:.65rem';
    wb.innerHTML =
      '<div style="font-size:1.5rem;flex-shrink:0">✡️</div>' +
      '<div style="flex:1"><div style="font-size:.85rem;font-weight:700;color:var(--blue)">ברוכים הבאים ל-YID PLUS!</div><div style="font-size:.72rem;color:var(--muted);margin-top:.15rem">A Yiddish social platform 🎉</div></div>' +
      '<button onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:var(--muted);padding:.25rem;flex-shrink:0"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
    bar.insertBefore(wb, bar.firstChild);
    setTimeout(function(){ if(wb.parentElement) wb.remove(); }, 8000);
  } catch(e) {}
                                           }
