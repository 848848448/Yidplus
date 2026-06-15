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

// ── STATUS ROW ───────────────────────────────────────────
function buildStatusRow() {
  var row = document.getElementById('status-row');
  if (!row) return;
  row.innerHTML =
    '<div class="status-item" onclick="openStatusUpload()">' +
      '<div class="status-ring mine"><div class="status-inner">👤<div class="status-plus">+</div></div></div>' +
      '<div class="status-name">My Status</div>' +
    '</div>';
  HOME_STATUSES.forEach(function (s, i) {
    var el = document.createElement('div');
    el.className = 'status-item';
    el.onclick   = function () { HOME_openSV(i); };
    el.innerHTML =
      '<div class="status-ring' + (s.viewed ? ' viewed' : '') + '">' +
        '<div class="status-inner">' + s.emoji + '</div>' +
      '</div>' +
      '<div class="status-name">' + escHtml(s.nick) + '</div>';
    row.appendChild(el);
  });
}

// ── ADS BANNER ───────────────────────────────────────────
function buildAds() {
  var frame = document.getElementById('ad-frame');
  var dots  = document.getElementById('ad-dots');
  if (!frame || !dots) return;
  HOME_ADS.forEach(function (ad, i) {
    var s = document.createElement('div');
    s.className        = 'ad-slide' + (i===0?' active':'');
    s.style.background = ad.bg;
    s.innerHTML =
      '<div style="font-size:2.5rem">' + ad.icon + '</div>' +
      '<div class="ad-badge">Sponsored</div>' +
      '<div class="ad-title">' + ad.title + '</div>' +
      '<div class="ad-sub">' + ad.sub + '</div>';
    frame.appendChild(s);
    var d = document.createElement('div');
    d.className = 'ad-dot' + (i===0?' active':'');
    dots.appendChild(d);
  });
  HOME_runAd();
}
function HOME_runAd() {
  cancelAnimationFrame(HOME_adRaf);
  HOME_adStart = performance.now();
  var dur = HOME_ADS[HOME_adIdx].dur;
  var bar = document.getElementById('ad-prog');
  function tick(now) {
    var pct = Math.min(100, (now - HOME_adStart) / dur * 100);
    if (bar) bar.style.width = pct + '%';
    if (pct < 100) {
      HOME_adRaf = requestAnimationFrame(tick);
    } else {
      HOME_adIdx = (HOME_adIdx + 1) % HOME_ADS.length;
      document.querySelectorAll('#ad-frame .ad-slide').forEach(function(s,i){ s.classList.toggle('active',i===HOME_adIdx); });
      document.querySelectorAll('#ad-dots  .ad-dot' ).forEach(function(d,i){ d.classList.toggle('active',i===HOME_adIdx); });
      HOME_runAd();
    }
  }
  HOME_adRaf = requestAnimationFrame(tick);
}

// ── SHORTS PREVIEW ───────────────────────────────────────
function buildShortsPrev() {
  var row = document.getElementById('home-shorts');
  if (!row) return; row.innerHTML = '';
  [{e:'🎹',v:'12.4K',n:'@Moshe'},{e:'🕺',v:'8.7K',n:'@YidDancer'},{e:'🎤',v:'22K',n:'@Shlomo'},
   {e:'🥘',v:'5.1K',n:'@Chef'}, {e:'📖',v:'3.2K',n:'@Rebbe'},    {e:'🎻',v:'9.8K',n:'@Fiddle'}]
  .forEach(function(s) {
    var c = document.createElement('div');
    c.className = 'short-prev-card'; c.onclick = function(){ navTo('shorts'); };
    c.innerHTML =
      '<div style="width:100%;height:100%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:2.5rem">' + s.e + '</div>' +
      '<div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.75),transparent);display:flex;flex-direction:column;justify-content:flex-end;padding:.5rem">' +
        '<div style="font-size:.68rem;color:var(--gold-l)">' + s.n + '</div>' +
        '<div style="font-size:.65rem;color:rgba(255,255,255,.8)">👁 ' + s.v + '</div>' +
      '</div>' +
      '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:32px;height:32px;border-radius:50%;background:rgba(201,168,76,.8);display:flex;align-items:center;justify-content:center">▶</div>';
    row.appendChild(c);
  });
}

// ── CHANNELS PREVIEW ─────────────────────────────────────
function buildChannelsPrev() {
  var row = document.getElementById('home-channels');
  if (!row) return; row.innerHTML = '';
  [{e:'🎹',n:'MosheMusic',f:'12.4K',v:true},{e:'🎤',n:'ShlomoBeats',f:'8.1K',v:false},
   {e:'📖',n:'RebbeVibes',f:'31K',  v:true},{e:'🥘',n:'KosherFood', f:'5.6K',v:false}]
  .forEach(function(c) {
    var card = document.createElement('div');
    card.className = 'ch-preview-card'; card.onclick = function(){ openChannel(c.n); };
    card.innerHTML =
      '<div style="width:50px;height:50px;border-radius:50%;background:var(--bg3);margin:0 auto .5rem;display:flex;align-items:center;justify-content:center;font-size:1.5rem;border:1.5px solid var(--border);position:relative">' +
        c.e + (c.v ? '<div style="position:absolute;top:-6px;right:-4px;font-size:.8rem">👑</div>' : '') +
      '</div>' +
      '<div style="font-size:.8rem;font-weight:700">' + c.n + '</div>' +
      '<div style="font-size:.65rem;color:var(--muted)">' + c.f + ' followers</div>' +
      '<button class="follow-pill" onclick="event.stopPropagation();this.classList.toggle(\'following\');this.textContent=this.classList.contains(\'following\')?\'✓ Following\':\'+ Follow\'">+ Follow</button>';
    row.appendChild(card);
  });
}

// ── STATUS VIEWER ────────────────────────────────────────
function HOME_openSV(i) {
  HOME_svUser  = HOME_STATUSES[i];
  HOME_svSlide = 0;
  HOME_STATUSES[i].viewed = true;
  var rings = document.querySelectorAll('#status-row .status-ring');
  if (rings[i + 1]) rings[i + 1].classList.add('viewed');
  var el = document.getElementById('sv-overlay');
  if (!el) return;
  document.getElementById('sv-avatar').textContent = HOME_svUser.emoji;
  document.getElementById('sv-nick').textContent   = '@' + HOME_svUser.nick;
  document.getElementById('sv-time').textContent   = HOME_svUser.time + ' ago';
  el.classList.add('open');
  HOME_showSVSlide(0);
}
window.openStatusViewer = HOME_openSV;

function HOME_showSVSlide(idx) {
  clearTimeout(HOME_svTimer);
  var sl   = HOME_svUser.slides[idx];
  var el   = document.getElementById('sv-slide');
  var bars = document.getElementById('sv-bars');
  if (!el || !bars) return;
  bars.innerHTML = HOME_svUser.slides.map(function(_, j) {
    return '<div class="sv-bar"><div class="sv-bar-fill ' + (j<idx?'done':j===idx?'running':'') + '"></div></div>';
  }).join('');
  el.style.opacity    = '0';
  el.style.background = sl.bg    || '#111';
  el.style.color      = sl.color || '#fff';
  setTimeout(function() { el.textContent = sl.text || ''; el.style.opacity = '1'; }, 120);
  HOME_svTimer = setTimeout(function() { window.svNext(); }, 5000);
}
window.svNext  = function() { if(HOME_svUser&&HOME_svSlide<HOME_svUser.slides.length-1) HOME_showSVSlide(++HOME_svSlide); else closeSV(); };
window.svPrev  = function() { if(HOME_svUser&&HOME_svSlide>0) HOME_showSVSlide(--HOME_svSlide); };
window.closeSV = function() { var el=document.getElementById('sv-overlay'); if(el)el.classList.remove('open'); clearTimeout(HOME_svTimer); };
window.svMute  = function() { var b=document.getElementById('sv-mute'); if(b)b.textContent=b.textContent==='🔊'?'🔇':'🔊'; };

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
