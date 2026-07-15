// ============================================================

// Null-safe classList toggle — some status/media modals live only on the home
// page, so referencing them from the chat page must not crash.
function _safeCls(id, action, cls) { var e = document.getElementById(id); if (e) e.classList[action](cls); }
// js/chat.js  —  Telegram-style Chat (Cloudflare D1 + R2)
// Features:
//   • Real-time polling every 3s
//   • Typing indicator
//   • Reply-to message
//   • Voice notes (MediaRecorder)
//   • Photo / Video / File upload → R2
//   • One-time view media (auto-deletes after opening)
//   • Context menu: reply / copy / forward / delete
//   • "New messages" arrow with badge
//   • Members list on group name tap
//   • 12-hour clock timestamps
//   • Read ticks (✓ / ✓✓)
//   • Sticker tray
//   • Create private/public groups
// ============================================================

var CHAT_rooms       = [];
var CHAT_tab         = 'all';
var CHAT_activeFolder = null; // null = no folder, string = folder id
var CHAT_folders     = [];
var CHAT_bookmarks   = [];
var CHAT_search      = '';
var CHAT_curRoom     = null;
var CHAT_curTopicId  = null;   // null = not in a topic-scoped view (flat chat or "General")
var CHAT_curTopicName = null;
var CHAT_topicsCache  = {};    // roomId -> topics array, so re-opening a group doesn't always refetch
var CHAT_messages    = [];
var CHAT_lastRenderSig = null;
var CHAT_lpCache = {}; // msgId -> {html, css, url} so previews survive re-renders without flicker
var CHAT_reactions   = {}; // { messageId: { counts: {emoji: n}, my_reaction: emoji|null } }
var CHAT_replyTo     = null;
var CHAT_ctxMsg      = null;
var CHAT_pollTimer   = null;
var CHAT_scheduleFor = null;   // ISO string when this message should send, or null
var CHAT_disappearSecs = 0;    // seconds until the message vanishes, or 0

window._resetMsgOptions = function () {
  CHAT_scheduleFor = null;
  CHAT_disappearSecs = 0;
  var badge = document.getElementById('msg-opts-badge');
  if (badge) badge.style.display = 'none';
};

function _updateMsgOptsBadge() {
  var badge = document.getElementById('msg-opts-badge');
  if (!badge) return;
  var parts = [];
  if (CHAT_scheduleFor) {
    var d = new Date(CHAT_scheduleFor);
    parts.push('🕓 ' + d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
  }
  if (CHAT_disappearSecs) {
    var lbl = CHAT_disappearSecs >= 86400 ? (CHAT_disappearSecs / 86400) + 'd'
            : CHAT_disappearSecs >= 3600 ? (CHAT_disappearSecs / 3600) + 'h'
            : (CHAT_disappearSecs / 60) + 'm';
    parts.push('💨 ' + lbl);
  }
  if (parts.length) {
    badge.textContent = parts.join('  ·  ') + '   ✕';
    badge.style.display = 'block';
  } else {
    badge.style.display = 'none';
  }
}

window.openMsgOptionsMenu = function () {
  var existing = document.getElementById('msg-opts-overlay');
  if (existing) { existing.remove(); return; }
  var overlay = document.createElement('div');
  overlay.id = 'msg-opts-overlay';
  overlay.className = 'modal-overlay open';
  overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML =
    '<div class="modal-sheet">' +
      '<div class="modal-title">Message options</div>' +
      '<div class="ctx-item" style="border:1px solid var(--border);border-radius:12px;margin-bottom:.5rem" onclick="_openSchedulePicker()">🕓 Schedule for later</div>' +
      '<div style="font-size:.72rem;color:var(--muted);margin:.5rem 0 .35rem">💨 Disappear after</div>' +
      '<div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.5rem">' +
        ['Off:0','1 min:60','1 hour:3600','1 day:86400','1 week:604800'].map(function (o) {
          var p = o.split(':'); var secs = parseInt(p[1], 10);
          var active = CHAT_disappearSecs === secs;
          return '<button onclick="_setDisappear(' + secs + ')" style="padding:.4rem .7rem;border-radius:16px;border:1.5px solid ' + (active ? 'var(--gold)' : 'var(--border)') + ';background:' + (active ? 'var(--gold)' : 'transparent') + ';color:' + (active ? '#fff' : 'var(--text)') + ';font-size:.75rem;cursor:pointer;font-family:inherit">' + p[0] + '</button>';
        }).join('') +
      '</div>' +
      '<button class="modal-cancel" onclick="document.getElementById(\'msg-opts-overlay\').remove()">Done</button>' +
    '</div>';
  document.body.appendChild(overlay);
};

window._openSchedulePicker = function () {
  var ov = document.getElementById('msg-opts-overlay');
  if (ov) ov.remove();
  var picker = document.createElement('div');
  picker.id = 'schedule-overlay';
  picker.className = 'modal-overlay open';
  picker.onclick = function (e) { if (e.target === picker) picker.remove(); };
  // Default to 1 hour from now, formatted for datetime-local input.
  var d = new Date(Date.now() + 60 * 60 * 1000);
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var localVal = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  picker.innerHTML =
    '<div class="modal-sheet">' +
      '<div class="modal-title">🕓 Schedule message</div>' +
      '<div style="font-size:.78rem;color:var(--muted);margin-bottom:.6rem">Choose when this message should be sent (up to 30 days ahead).</div>' +
      '<input type="datetime-local" id="schedule-inp" value="' + localVal + '" style="width:100%;box-sizing:border-box;padding:.6rem .75rem;background:var(--bg3);border:1.5px solid var(--border);border-radius:10px;color:var(--text);font-size:.9rem;margin-bottom:.75rem">' +
      '<button class="btn-primary" onclick="_confirmSchedule()">Set Schedule</button>' +
      '<button class="modal-cancel" onclick="document.getElementById(\'schedule-overlay\').remove()">Cancel</button>' +
    '</div>';
  document.body.appendChild(picker);
};

window._confirmSchedule = function () {
  var val = document.getElementById('schedule-inp').value;
  if (!val) return;
  var t = new Date(val).getTime();
  if (isNaN(t) || t <= Date.now()) return toast('⚠ Pick a time in the future.');
  CHAT_scheduleFor = new Date(val).toISOString();
  var ov = document.getElementById('schedule-overlay'); if (ov) ov.remove();
  _updateMsgOptsBadge();
  toast('🕓 Will send at the chosen time');
};

window._setDisappear = function (secs) {
  CHAT_disappearSecs = secs;
  var ov = document.getElementById('msg-opts-overlay'); if (ov) ov.remove();
  _updateMsgOptsBadge();
};
var CHAT_isRecording = false;
var CHAT_mediaRec    = null;
var CHAT_recChunks   = [];
var CHAT_recStart    = 0;
var CHAT_unreadNew   = 0;   // new messages since last scroll
var CHAT_pinnedMsgId = null;
var CHAT_atBottom    = true;
var CHAT_members     = [];  // current room members
var CHAT_drafts      = {};  // roomId -> draft text

// Status-viewer state (the status viewer overlay is shared markup with the
// Home page, but this page loads its own copy of the viewer logic below —
// these must be declared here since js/home.js is not loaded on this page).
var HOME_svStatuses  = [];
var HOME_svUserIdx   = 0;
var HOME_svSlideIdx  = 0;
var HOME_svMuted     = false;
var HOME_svPaused    = false;
var HOME_svBarRaf    = null;
var HOME_svBarStart  = 0;
var HOME_svBarDur    = 5000;
var HOME_svLongTimer = null;
var HOME_svPrivacy   = 'public';
var HOME_HIGHLIGHTS  = [];

// ============================================================
// BOOT
// ============================================================
window.closeChatRoom = function () {
  _stopTypingPoll();
  CHAT_curRoom = null;
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  var screenChats    = document.getElementById('screen-chats');
  var screenChatroom = document.getElementById('screen-chatroom');
  if (screenChatroom) { screenChatroom.classList.add('hidden');    screenChatroom.style.display = ''; }
  if (screenChats)    { screenChats.classList.remove('hidden');    screenChats.style.display    = ''; }
  // Reload list if empty
  var area = document.getElementById('chat-list-area');
  if (!area || !area.querySelector('.chat-item-wrap')) loadChatRooms();
};

window.init_chats = function () {
  // If the URL points at a specific chat (e.g. after a refresh), reopen it once
  // the room list is loaded — so refreshing keeps you in the same conversation.
  var m = (location.hash || '').match(/room=([^&]+)/);
  var wantRoom = m ? decodeURIComponent(m[1]) : null;
  loadChatRooms(wantRoom ? function () {
    if (CHAT_rooms.find(function (r) { return r.id === wantRoom; })) window.openChatRoom(wantRoom);
  } : null);
};

// ============================================================
// CHAT LIST
// ============================================================
var CHAT_activeStatusUserIds = new Set();

function loadChatRooms(callback) {
  var el = document.getElementById('chat-list-area');
  if (el) el.innerHTML = '<div class="feed-state"><div class="spinner"></div><div>Loading chats...</div></div>';

  Promise.all([
    api.get('/chat/rooms'),
    api.get('/statuses', true).catch(function () { return { statuses: [] }; }),
  ])
    .then(function (resArr) {
      var res = resArr[0];
      var statusRes = resArr[1];
      CHAT_rooms = res.rooms || [];
      CHAT_activeStatusUserIds = new Set((statusRes.statuses || []).map(function (s) { return s.user_id; }));
      // Ensure content filter is loaded before rendering (blurs bad words in preview)
      if (typeof loadContentFilter === 'function' && !FILTER_loaded) {
        loadContentFilter();
        setTimeout(function () { renderChatList(); }, 800);
      } else {
        renderChatList();
      }
      if (typeof callback === 'function') callback();
    })
    .catch(function (err) {
      if (el) el.innerHTML =
        '<div class="feed-state">' +
          '<div style="font-size:2rem">⚠️</div>' +
          '<div>Could not load chats</div>' +
          '<div style="font-size:.75rem;color:var(--muted)">' + escHtml(err.message) + '</div>' +
          '<button class="feed-retry" onclick="loadChatRooms()">Try Again</button>' +
        '</div>';
    });
}
window.loadChatRooms = loadChatRooms;

function renderChatList() {
  var el = document.getElementById('chat-list-area');
  if (!el) return;

  var filtered = CHAT_rooms.filter(function (c) {
    var tabOk = CHAT_tab === 'all' ||
      (CHAT_tab === 'private'  && c.type === 'private') ||
      (CHAT_tab === 'groups'   && c.type === 'group') ||
      (CHAT_tab === 'channels' && c.type === 'channel');
    var srchOk = !CHAT_search ||
      (c.nick || '').toLowerCase().indexOf(CHAT_search.toLowerCase()) !== -1;
    return tabOk && srchOk;
  });

  // Apply folder filter if active
  if (CHAT_activeFolder) {
    filtered = _applyFolderFilter(filtered);
  }

  // Embedded Telegram channels appear alongside real channels (Channels + All tabs).
  var tgHtml = '';
  if ((CHAT_tab === 'channels' || CHAT_tab === 'all') && !CHAT_activeFolder && CHAT_tgChannels && CHAT_tgChannels.length) {
    var _q = (CHAT_search || '').toLowerCase();
    tgHtml = CHAT_tgChannels.filter(function (t) {
      return !_q || ((t.title || t.username).toLowerCase().indexOf(_q) !== -1);
    }).map(_tgChannelRow).join('');
  }

  if (!filtered.length && !tgHtml) {
    el.innerHTML =
      '<div class="feed-state">' +
        '<div style="font-size:2.5rem">💬</div>' +
        '<div>No chats yet</div>' +
        '<div style="font-size:.75rem;color:var(--muted)">Tap ✏️ to start a chat or 👥 to create a group</div>' +
      '</div>';
    return;
  }

  el.innerHTML = filtered.map(function (c) {
    var initial  = (c.nick || '?').slice(0, 1).toUpperCase();
    var isGroup  = c.type === 'group';
    var hasPhoto = c.photo_url && typeof c.photo_url === 'string' && c.photo_url.length > 5 && !c.photo_url.startsWith('null');
    var _avGrad  = avatarColor(c.other_user_id || c.id);
    // Groups get rounded-square avatar like Telegram, DMs get circle
    var avClass  = 'chat-av' + (isGroup ? ' group chat-av-square' : ' chat-av-round');
    var hasStatus = !isGroup && CHAT_activeStatusUserIds && CHAT_activeStatusUserIds.has(c.other_user_id || c.id);
    if (hasStatus) avClass += ' has-status-ring';
    var avStyle  = hasPhoto
      ? "background-image:url('" + c.photo_url + "'), " + _avGrad + ";background-size:cover;background-position:center;"
      : 'background:' + _avGrad + ';';
    // Always render the initial as a fallback — if the photo URL 404s, the letter
    // stays visible underneath instead of leaving a blank white circle.
    var avatarContent = initial;
    var onlineDot = (!isGroup && c.online && isAnyAdmin()) ? '<div class="online-dot"></div>' : '';
    var previewText = c.preview || '';
    // Filter bad words in preview
    // For preview text: replace bad words with *** (simpler than blur spans in 1-line truncated text)
    var previewHtml = escHtml(previewText);
    if (typeof FILTER_regex !== 'undefined' && FILTER_regex) {
      previewHtml = escHtml(previewText.replace(FILTER_regex, function(m) {
        return '*'.repeat(Math.min(m.length, 5));
      }));
      if (typeof FILTER_phrase_regex !== 'undefined' && FILTER_phrase_regex) {
        previewHtml = escHtml(previewText
          .replace(FILTER_phrase_regex, function(m) { return '*'.repeat(Math.min(m.length, 7)); })
          .replace(FILTER_regex, function(m) { return '*'.repeat(Math.min(m.length, 5)); })
        );
      }
    }
    var timeText = c.last_time ? _fmt12(c.last_time) : '';
    var unreadBadge = c.unread
      ? '<div style="min-width:20px;height:20px;border-radius:10px;background:' + (c.muted ? 'var(--bg3)' : 'var(--blue)') + ';color:' + (c.muted ? 'var(--muted)' : '#fff') + ';font-size:.62rem;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px;flex-shrink:0">' + (c.unread > 99 ? '99+' : c.unread) + '</div>'
      : '';
    var muteIcon = c.muted
      ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/><line x1="2" y1="2" x2="22" y2="22"/></svg>'
      : '';

    var avatarClickAttr = hasStatus ? ' onclick="event.stopPropagation();_viewChatListAvatarStatus(\'' + (c.other_user_id || c.id) + '\')"' : '';
    return '<div class="chat-item-wrap" data-room-id="' + c.id + '">' +
      '<div class="chat-item-delete" onclick="event.stopPropagation();deleteChatRoom(\'' + c.id + '\',\'' + escHtml((c.nick || 'Chat')).replace(/'/g, "\\'") + '\')"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg></div>' +
      '<div class="chat-item' + (c.unread ? ' unread' : '') + '" onclick="_chatItemClick(this,\'' + c.id + '\')">' +
        '<div class="' + avClass + '" style="' + avStyle + '"' + avatarClickAttr + '>' + avatarContent + onlineDot + '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:.18rem;gap:.4rem">' +
            '<div style="font-size:.94rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left;unicode-bidi:plaintext;direction:ltr;flex:1">' + escHtml(c.nick || 'Chat') + '</div>' +
            '<div style="display:flex;align-items:center;gap:.3rem;flex-shrink:0">' + muteIcon + '<div style="font-size:.68rem;color:var(--muted)">' + timeText + '</div></div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:.4rem">' +
            '<div style="font-size:.83rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left;unicode-bidi:plaintext;direction:ltr;flex:1;font-weight:' + (c.unread ? '500' : '400') + '">' + previewHtml + '</div>' +
            unreadBadge +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('') + tgHtml;

  _attachChatSwipeGestures();
}

// ── Embedded Telegram channels (public, read-only) ──
var CHAT_tgChannels = [];
function _loadTgChannels() {
  api.get('/telegram-channels').then(function (res) {
    CHAT_tgChannels = (res && res.channels) || [];
    if (CHAT_tab === 'channels' || CHAT_tab === 'all') renderChatList();
  }).catch(function () {});
}
function _tgChannelRow(t) {
  var title = escHtml(t.title || t.username);
  var uname = escHtml(t.username);
  return '<div class="chat-item-wrap" data-tg="' + uname + '">' +
    '<div class="chat-item" onclick="openTelegramChannel(\'' + uname + '\',\'' + title.replace(/'/g, "\\'") + '\')">' +
      '<div class="chat-av chat-av-square" style="background:#229ED9;color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.1rem">📨</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:.18rem;gap:.4rem">' +
          '<div style="font-size:.94rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1">' + title + '</div>' +
          '<div style="font-size:.6rem;color:#fff;background:#229ED9;border-radius:8px;padding:1px 6px;flex-shrink:0">Telegram</div>' +
        '</div>' +
        '<div style="font-size:.83rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">@' + uname + '</div>' +
      '</div>' +
    '</div>' +
  '</div>';
}

// Open a Telegram channel as a read-only viewer (no composer), embedding the
// channel's live feed straight from Telegram (t.me/s/<username>).
window.openTelegramChannel = function (username, title) {
  var screenChats    = document.getElementById('screen-chats');
  var screenChatroom = document.getElementById('screen-chatroom');
  if (screenChats)    screenChats.classList.add('hidden');
  if (screenChatroom) screenChatroom.classList.remove('hidden');

  CHAT_curRoom = null; // not a real room
  try { history.replaceState(null, '', '#tg=' + encodeURIComponent(username)); } catch (e) {}

  // Header
  var nameEl = document.getElementById('cr-name');
  if (nameEl) nameEl.textContent = title || ('@' + username);
  var statusEl = document.getElementById('cr-status');
  if (statusEl) statusEl.textContent = 'Telegram channel · read-only';
  var avEl = document.getElementById('cr-avatar');
  if (avEl) { avEl.style.background = '#229ED9'; avEl.style.backgroundImage = ''; avEl.textContent = '📨'; }

  // Hide the composer / input bar — this is read-only.
  var bar = document.getElementById('chat-input-bar');
  if (bar) bar.style.display = 'none';

  // Body → Telegram feed via the OFFICIAL widget (t.me/s iframes are X-Frame
  // blocked). Laid out like a chat: oldest at the top, newest at the bottom.
  var msgs = document.getElementById('chat-msgs');
  if (!msgs) return;
  msgs.innerHTML =
    '<div style="height:100%;display:flex;flex-direction:column;position:relative">' +
      '<div id="tg-feed-scroll" style="flex:1;overflow-y:auto;background:var(--tg-bg,#e6ebee);padding:.5rem .35rem">' +
        '<div id="tg-feed-slot" style="max-width:640px;margin:0 auto"></div>' +
        '<div id="tg-feed-state" style="text-align:center;color:var(--muted);font-size:.85rem;padding:2rem 1rem">Loading posts…</div>' +
      '</div>' +
      // Jump-to-latest, like the chat screen. Hidden until you scroll up.
      '<button id="tg-jump" onclick="_tgScrollBottom()" style="display:none;position:absolute;right:12px;bottom:14px;width:44px;height:44px;border-radius:50%;border:none;background:var(--surface);box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:pointer;align-items:center;justify-content:center;color:var(--text)">' +
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>' +
        '<span id="tg-jump-badge" style="display:none;position:absolute;top:-4px;right:-4px;min-width:19px;height:19px;border-radius:10px;background:#229ED9;color:#fff;font-size:.66rem;font-weight:700;line-height:19px;padding:0 5px"></span>' +
      '</button>' +
    '</div>';

  var dark = document.documentElement.classList.contains('dark') || (document.body && document.body.classList.contains('dark'));
  // Two ways to show a channel:
  //  'stored' (default) — render what the sync copied into D1/R2. We build every
  //     post ourselves, so there is no Telegram branding or outbound link, it
  //     matches the app's design, and it's fast.
  //  'widget' — embed Telegram's official post widget. Nothing is stored, but
  //     each post is a separate cross-origin iframe: it carries Telegram's own
  //     links and branding, can't be restyled or shrunk, and is slow.
  var mode = (window.STATE && STATE.settings && STATE.settings.tg_embed_mode) || 'stored';

  api.get('/telegram-ingest?username=' + encodeURIComponent(username)).then(function (res) {
    var slot = document.getElementById('tg-feed-slot');
    var state = document.getElementById('tg-feed-state');
    if (!slot) return;
    var posts = (res && res.posts) || [];
    if (!posts.length) {
      if (state) state.innerHTML = 'No posts here yet.<br><span style="font-size:.75rem">Posts appear once the Telegram sync has run.</span>' +
        '<br><br><a href="https://t.me/' + encodeURIComponent(username) + '" target="_blank" style="color:#229ED9;font-weight:600">Open @' + username + ' in Telegram →</a>';
      return;
    }
    if (state) state.remove();

    // The API hands them back newest-first; a chat reads the other way round.
    var ordered = posts.slice().sort(function (a, b) { return a.tg_msg_id - b.tg_msg_id; });

    if (mode === 'stored') {
      slot.innerHTML = ordered.map(function (p) { return _xPostCard(p, username, title); }).join('');
    } else {
      // Widget mode: one official embed per post, oldest at the top.
      ordered.forEach(function (p) {
        var holder = document.createElement('div');
        holder.style.marginBottom = '.4rem';
        var s = document.createElement('script');
        s.async = true;
        s.src = 'https://telegram.org/js/telegram-widget.js?22';
        s.setAttribute('data-telegram-post', username + '/' + p.tg_msg_id);
        s.setAttribute('data-width', '100%');
        if (dark) s.setAttribute('data-dark', '1');
        holder.appendChild(s);
        slot.appendChild(holder);
      });
    }

    _tgInitScroll(ordered.length);
  }).catch(function (e) {
    var state = document.getElementById('tg-feed-state');
    if (state) state.innerHTML = 'Could not load posts (' + (e && e.message ? e.message : 'error') + ').';
  });
};

// Land at the newest post, and show the jump button once you scroll away from it.
// The widgets load in their own iframes and keep growing after we're done here,
// so re-pin to the bottom for a few seconds rather than scrolling once.
function _tgInitScroll(count) {
  var box = document.getElementById('tg-feed-scroll');
  if (!box) return;
  TG_lastCount = count || 0;
  var pin = setInterval(function () { box.scrollTop = box.scrollHeight; }, 250);
  setTimeout(function () { clearInterval(pin); }, 4000);

  box.onscroll = function () {
    var atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    if (atBottom) { clearInterval(pin); _tgClearNew(); }
    var btn = document.getElementById('tg-jump');
    if (btn) btn.style.display = atBottom ? 'none' : 'flex';
  };
}

window._tgScrollBottom = function () {
  var box = document.getElementById('tg-feed-scroll');
  if (box) box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
  _tgClearNew();
};

var TG_lastCount = 0;
var TG_newCount = 0;
function _tgClearNew() {
  TG_newCount = 0;
  var b = document.getElementById('tg-jump-badge');
  if (b) b.style.display = 'none';
}

// Render one channel post as a Telegram-style bubble.
function _xPostCard(p, username, chTitle) {
  var name = escHtml(p.author_name || chTitle || username);
  var avatar = p.author_avatar
    ? '<div style="width:34px;height:34px;border-radius:50%;background-image:url(' + p.author_avatar + ');background-size:cover;background-position:center;flex-shrink:0"></div>'
    : '<div style="width:34px;height:34px;border-radius:50%;background:#229ED9;color:#fff;display:flex;align-items:center;justify-content:center;font-size:.9rem;font-weight:700;flex-shrink:0">' + (name.slice(0, 1) || 'C') + '</div>';

  // Text: escape, then style mentions and hashtags. Deliberately NOT linked —
  // a @mention would otherwise be a door straight out to t.me.
  var text = '';
  if (p.text) {
    text = escHtml(p.text)
      .replace(/https?:\/\/(?:t|telegram)\.me\/[^\s<]+/gi, '')   // drop bare Telegram links
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:#168acd;text-decoration:none">$1</a>')
      .replace(/(^|\s)(@[a-zA-Z0-9_]+)/g, '$1<span style="color:#168acd">$2</span>')
      .replace(/(^|\s)(#[^\s#<]+)/g, '$1<span style="color:#168acd">$2</span>')
      .replace(/\n/g, '<br>');
  }

  var media = '';
  if (p.media_url) {
    if (p.media_type === 'video') {
      media = '<div style="margin:-.1rem -.1rem .45rem;border-radius:10px;overflow:hidden"><video src="' + p.media_url + '" controls playsinline style="width:100%;display:block;background:#000"></video></div>';
    } else if (p.media_type === 'audio') {
      media = '<div style="margin-bottom:.45rem"><audio src="' + p.media_url + '" controls preload="none" style="width:100%;height:38px"></audio></div>';
    } else if (p.media_type === 'file') {
      media = '<a href="' + p.media_url + '" target="_blank" style="display:flex;align-items:center;gap:.5rem;margin-bottom:.45rem;text-decoration:none;color:#168acd">' +
        '<div style="width:36px;height:36px;border-radius:50%;background:#168acd;color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
        '</div><span style="font-size:.85rem;font-weight:600">Download file</span></a>';
    } else {
      media = '<div style="margin:-.1rem -.1rem .45rem;border-radius:10px;overflow:hidden"><img src="' + p.media_url + '" style="width:100%;display:block" loading="lazy"></div>';
    }
  }

  var when = '';
  try {
    when = new Date(p.posted_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch (e) {}

  var eye = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:.75"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';

  // Telegram channel layout: avatar on the left, one light bubble holding the
  // channel name, the post, and a views + time footer on the right.
  return '<div style="display:flex;align-items:flex-end;gap:.45rem;margin-bottom:.55rem">' +
      avatar +
      '<div style="background:#fff;border-radius:12px;border-bottom-left-radius:4px;padding:.5rem .6rem;max-width:82%;box-shadow:0 1px 1px rgba(0,0,0,.08)">' +
        '<div style="font-weight:600;font-size:.84rem;color:#168acd;margin-bottom:.2rem;unicode-bidi:plaintext">' + name + '</div>' +
        media +
        (text ? '<div style="font-size:.94rem;line-height:1.4;color:#000;white-space:pre-wrap;word-break:break-word;unicode-bidi:plaintext">' + text + '</div>' : '') +
        '<div style="display:flex;align-items:center;justify-content:flex-end;gap:.3rem;margin-top:.25rem;color:#8a9aa5;font-size:.68rem">' +
          eye + '<span>' + _xNum(p.views || 0) + '</span>' +
          '<span style="margin-left:.2rem">' + when + '</span>' +
        '</div>' +      '</div>' +
    '</div>';
}
function _xNum(n) {
  n = parseInt(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

// Swipe-left-to-reveal-delete on each chat row (mirrors the gesture used for
// message swipe-to-reply, but horizontal-only and limited to one row at a time).
function _attachChatSwipeGestures() {
  document.querySelectorAll('.chat-item-wrap').forEach(function (wrap) {
    var item = wrap.querySelector('.chat-item');
    if (item._lpBound) return;
    item._lpBound = true;
    var sx = 0, sy = 0, moved = false, lpTimer = null;

    function reveal() {
      document.querySelectorAll('.chat-item.swiped').forEach(function (o) { if (o !== item) o.classList.remove('swiped'); });
      item.classList.add('swiped');
      if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
    }

    // Long-press reveals the delete action (no more horizontal swipe here, so the
    // list's left/right swipe is free to switch tabs in both directions).
    item.addEventListener('touchstart', function (e) {
      var t = e.touches[0]; sx = t.clientX; sy = t.clientY; moved = false;
      lpTimer = setTimeout(function () { lpTimer = null; if (!moved) reveal(); }, 500);
    }, { passive: true });
    item.addEventListener('touchmove', function (e) {
      var t = e.touches[0];
      if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) { moved = true; if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } }
    }, { passive: true });
    item.addEventListener('touchend', function () { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } });
    item.addEventListener('touchcancel', function () { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } });
    // Desktop: right-click reveals delete too.
    item.addEventListener('contextmenu', function (e) { e.preventDefault(); reveal(); });
  });

  // Tapping anywhere else closes any open delete row.
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.chat-item-wrap')) {
      document.querySelectorAll('.chat-item.swiped').forEach(function (i) { i.classList.remove('swiped'); });
    }
  });
}

// A swiped-open row should close on tap rather than navigate into the chat.
window._chatItemClick = function (el, roomId) {
  if (el.classList.contains('swiped')) {
    el.classList.remove('swiped');
    return;
  }
  openChatRoom(roomId);
};

// Same delete/leave action as the chat-list swipe, but callable from
// inside an already-open chat room (the kebab menu at the top).
// ============================================================
// UNIFIED MEDIA VIEWER (images + videos)
// Supports: swipe left/right = prev/next, swipe down = close
// ============================================================
var _mediaList = [];
var _mediaIdx  = 0;

window._openMediaViewer = function (msgId) {
  // Build list of all image/video messages in this chat
  _mediaList = CHAT_messages.filter(function (m) {
    return m.type === 'media' && m.media_url;
  }).map(function (m) {
    return {
      id:      m.id,
      url:     m.media_url,
      key:     m.media_key || '',
      text:    m.text && m.text !== '__once__' ? m.text : '',
      sender:  m.sender_nick || 'User',
      time:    m.created_at ? _fmt12(m.created_at) : '',
      isVideo: /\.(mp4|webm|mov)$/i.test(m.media_key || ''),
    };
  });
  _mediaIdx = _mediaList.findIndex(function (v) { return v.id === msgId; });
  if (_mediaIdx < 0) { _mediaIdx = 0; }
  _mediaViewerLoad(_mediaIdx);
  document.getElementById('media-viewer').style.display = 'flex';
};

function _mediaViewerLoad(idx) {
  var item = _mediaList[idx];
  if (!item) return;
  _mediaIdx = idx;

  var body = document.getElementById('mv-body');
  if (item.isVideo) {
    body.innerHTML = '<video src="' + item.url + '" controls autoplay playsinline style="max-width:100%;max-height:80vh;object-fit:contain"></video>';
    _mvZoom = 1;
  } else {
    body.innerHTML = '<img id="mv-img" src="' + item.url + '" style="max-width:100%;max-height:80vh;object-fit:contain;border-radius:4px;touch-action:none;will-change:transform" draggable="false">';
    _setupImageZoom();
  }

  document.getElementById('mv-sender').textContent = item.sender;
  document.getElementById('mv-time').textContent   = item.time;
  var capEl = document.getElementById('mv-caption');
  capEl.textContent = item.text;
  capEl.style.display = item.text ? 'block' : 'none';
  var rtl = /[\u0590-\u05FF]/.test(item.text || '');
  capEl.style.direction = rtl ? 'rtl' : 'ltr';

  document.getElementById('mv-prev').style.opacity = idx > 0 ? '1' : '0';
  document.getElementById('mv-next').style.opacity = idx < _mediaList.length - 1 ? '1' : '0';
}

window._mediaViewerClose = function () {
  var vid = document.querySelector('#mv-body video');
  if (vid) vid.pause();
  document.getElementById('media-viewer').style.display = 'none';
  document.getElementById('mv-body').innerHTML = '';
};

window._mvPrev = function () { if (_mediaIdx > 0) _mediaViewerLoad(_mediaIdx - 1); };
window._mvNext = function () { if (_mediaIdx < _mediaList.length - 1) _mediaViewerLoad(_mediaIdx + 1); };

// ── Pinch / double-tap / pan zoom for the full-screen image viewer.
// _mvZoom > 1 means we're zoomed in; the viewer's left/right swipe-navigation
// checks this so panning a zoomed photo doesn't flip to the next one.
var _mvZoom = 1, _mvTX = 0, _mvTY = 0;
function _setupImageZoom() {
  _mvZoom = 1; _mvTX = 0; _mvTY = 0;
  var img = document.getElementById('mv-img');
  if (!img) return;
  function apply() { img.style.transform = 'translate(' + _mvTX + 'px,' + _mvTY + 'px) scale(' + _mvZoom + ')'; }

  var startDist = 0, startZoom = 1, panX = 0, panY = 0, startTX = 0, startTY = 0, lastTap = 0;

  img.addEventListener('touchstart', function (e) {
    if (e.touches.length === 2) {
      // pinch start
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      startDist = Math.hypot(dx, dy);
      startZoom = _mvZoom;
      e.stopPropagation();
    } else if (e.touches.length === 1) {
      // double-tap detection
      var now = Date.now();
      if (now - lastTap < 300) {
        _mvZoom = _mvZoom > 1 ? 1 : 2.5;
        if (_mvZoom === 1) { _mvTX = 0; _mvTY = 0; }
        apply();
        e.preventDefault();
      }
      lastTap = now;
      // pan start (only meaningful when zoomed)
      panX = e.touches[0].clientX; panY = e.touches[0].clientY;
      startTX = _mvTX; startTY = _mvTY;
    }
  }, { passive: false });

  img.addEventListener('touchmove', function (e) {
    if (e.touches.length === 2) {
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      var dist = Math.hypot(dx, dy);
      if (startDist > 0) {
        _mvZoom = Math.min(5, Math.max(1, startZoom * (dist / startDist)));
        if (_mvZoom === 1) { _mvTX = 0; _mvTY = 0; }
        apply();
      }
      e.preventDefault(); e.stopPropagation();
    } else if (e.touches.length === 1 && _mvZoom > 1) {
      // pan the zoomed image; stop the event from reaching the swipe-navigate
      _mvTX = startTX + (e.touches[0].clientX - panX);
      _mvTY = startTY + (e.touches[0].clientY - panY);
      apply();
      e.preventDefault(); e.stopPropagation();
    }
  }, { passive: false });

  img.addEventListener('touchend', function (e) {
    if (e.touches.length === 0) startDist = 0;
  });

  // Desktop: double-click to toggle zoom.
  img.addEventListener('dblclick', function (e) {
    _mvZoom = _mvZoom > 1 ? 1 : 2.5;
    if (_mvZoom === 1) { _mvTX = 0; _mvTY = 0; }
    apply();
    e.preventDefault();
  });
}

window._mvOptions = function () {
  var item = _mediaList[_mediaIdx];
  if (!item) return;
  var menu = document.getElementById('mv-options-menu');
  menu.classList.toggle('open');
};

window._mvForward = function () {
  _safeCls('mv-options-menu','remove','open');
  if (!_mediaList[_mediaIdx]) return;
  CHAT_ctxMsg = CHAT_messages.find(function (m) { return m.id === _mediaList[_mediaIdx].id; });
  _mediaViewerClose();
  ctxForward();
};

window._mvDownload = function () {
  _safeCls('mv-options-menu','remove','open');
  var item = _mediaList[_mediaIdx];
  if (!item) return;
  var name = (item.key.split('/').pop()) || (item.isVideo ? 'video.mp4' : 'image.jpg');
  toast('⬇️ Downloading…');
  // Fetch as a blob (with the session cookie — chat media is member-only) then
  // save via an object URL. Plain <a download> is ignored by mobile browsers for
  // videos, which just open the file instead of saving it.
  fetch(item.url, { credentials: 'include' })
    .then(function (r) { if (!r.ok) throw new Error('Download failed'); return r.blob(); })
    .then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    })
    .catch(function () {
      // Last-resort fallback: open in a new tab so the user can long-press to save.
      window.open(item.url, '_blank');
    });
};

// Swipe gestures on the media viewer body
(function () {
  var startX = 0, startY = 0, startT = 0;
  document.addEventListener('DOMContentLoaded', function () {
    var mv = document.getElementById('media-viewer');
    if (!mv) return;
    mv.addEventListener('touchstart', function (e) {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startT = Date.now();
    }, { passive: true });
    mv.addEventListener('touchend', function (e) {
      if (_mvZoom > 1) return; // panning a zoomed photo — don't navigate/close
      var dx = e.changedTouches[0].clientX - startX;
      var dy = e.changedTouches[0].clientY - startY;
      var dt = Date.now() - startT;
      // Swipe down to close — only a quick flick, so it doesn't fight scrolling.
      if (Math.abs(dy) > Math.abs(dx) && dy > 90 && dt < 600) { _mediaViewerClose(); return; }
      // Horizontal swipe to move between photos/videos — no strict time limit,
      // so a natural, slightly-slower gallery swipe still registers.
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) _mvNext(); else _mvPrev();
      }
    });
  });
}());

// Keep old _openVideoPlayer as alias
window._openVideoPlayer = function (msgId) { window._openMediaViewer(msgId); };

window._handleInviteJoin = function (code) {
  api.get('/invite?code=' + encodeURIComponent(code))
    .then(function (res) {
      var room = res.room;
      var isPrivate = room.visibility === 'private';
      var msg = isPrivate
        ? '🔒 "' + (room.name || 'Group') + '" is a private group.\n\nSend a join request?'
        : 'Join "' + (room.name || 'Group') + '"?\n(' + (room.members || 0) + ' members)';

      ypConfirm(msg, { title: isPrivate ? 'Private group' : 'Join group', okText: isPrivate ? 'Send request' : 'Join' }).then(function (ok) {
        if (!ok) { closeChatRoom(); return; }

        api.post('/invite', { code: code })
          .then(function (joinRes) {
            if (joinRes.status === 'joined' || joinRes.status === 'already_member') {
              toast('✅ Joined! Opening chat...');
              loadChatRooms();
              setTimeout(function () { openChatRoom(joinRes.room_id); }, 600);
            } else if (joinRes.status === 'pending') {
              toast('📨 Join request sent! Waiting for admin approval.');
              navTo('chats');
            } else {
              navTo('chats');
            }
          })
          .catch(function (err) { toast('❌ ' + err.message); navTo('chats'); });
      });
    })
    .catch(function (err) { toast('❌ Invalid invite link'); navTo('chats'); });
};

window.copyInviteLink = function () {
  if (!CHAT_curRoom) return;
  var code = CHAT_curRoom.invite_code;
  if (code) {
    var url = window.location.origin + '/chat?join=' + code;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function () { toast('✅ Invite link copied!'); });
    } else { toast('🔗 ' + url); }
    return;
  }
  // Fallback: fetch if not in local data yet
  api.get('/chat/rooms')
    .then(function (res) {
      var room = (res.rooms || []).find(function (r) { return r.id === CHAT_curRoom.id; });
      code = room && room.invite_code;
      if (code) {
        CHAT_curRoom.invite_code = code;
        var url1 = window.location.origin + '/chat?join=' + code;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(url1).then(function () { toast('✅ Invite link copied!'); });
        } else { toast('🔗 ' + url1); }
        return;
      }
      // Still missing (older room from before invite codes existed) — generate one now.
      return api.put('/chat/rooms', { room_id: CHAT_curRoom.id, generate_invite: true })
        .then(function (res2) {
          CHAT_curRoom.invite_code = res2.invite_code;
          var url2 = window.location.origin + '/chat?join=' + res2.invite_code;
          if (navigator.clipboard) {
            navigator.clipboard.writeText(url2).then(function () { toast('✅ Invite link copied!'); });
          } else { toast('🔗 ' + url2); }
        });
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.toggleMuteCurrentChat = function () {
  if (!CHAT_curRoom) return;
  var newMuted = !CHAT_curRoom.muted;
  api.put('/chat/rooms', { room_id: CHAT_curRoom.id, muted: newMuted })
    .then(function () {
      CHAT_curRoom.muted = newMuted;
      var cached = CHAT_rooms.find(function (r) { return r.id === CHAT_curRoom.id; });
      if (cached) cached.muted = newMuted;
      toast(newMuted ? '🔇 Muted' : '🔊 Unmuted');
      renderChatList();
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.confirmDeleteCurrentChat = function () {
  if (!CHAT_curRoom) return;
  var isGroup = CHAT_curRoom.type === 'group';
  var label = isGroup ? 'Leave "' + CHAT_curRoom.nick + '"?' : 'Delete chat with "' + CHAT_curRoom.nick + '"?';
  ypConfirm(label, { danger: true, okText: isGroup ? 'Leave' : 'Delete' }).then(function (ok) {
    if (!ok) return;
    api.del('/chat/rooms?room_id=' + encodeURIComponent(CHAT_curRoom.id))
      .then(function () {
        toast(isGroup ? '🚪 You left the group.' : '🗑 Chat removed');
        CHAT_curRoom = null;
        navTo('chats');
        loadChatRooms();
      })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
};

window.deleteChatRoom = function (roomId, nick) {
  ypConfirm('Delete chat with "' + nick + '"? This removes it from your list.', { danger: true, okText: 'Delete' }).then(function (ok) {
    if (!ok) return;
    api.del('/chat/rooms?room_id=' + encodeURIComponent(roomId))
      .then(function () {
        toast('🗑 Chat removed');
        if (CHAT_curRoom && CHAT_curRoom.id === roomId) { CHAT_curRoom = null; closeChatRoom(); }
        loadChatRooms();
      })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
};

window.filterChats = function () {
  CHAT_search = document.getElementById('chat-search').value || '';
  renderChatList();
};

var CHAT_TABS = ['all', 'private', 'groups', 'channels'];
window.switchChatTab = function (btn, tab) { _setChatTab(tab); };
function _setChatTab(tab) {
  if (CHAT_TABS.indexOf(tab) === -1) tab = 'all';
  CHAT_tab = tab;
  try { localStorage.setItem('yp_chat_tab', tab); } catch (e) {}
  document.querySelectorAll('.tg-tab').forEach(function (t) {
    var on = t.getAttribute('data-tab') === tab;
    t.classList.toggle('active', on);
    if (on && t.scrollIntoView) { try { t.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); } catch (e) {} }
  });
  renderChatList();
  var fab = document.getElementById('status-fab-btn');
  if (fab) fab.style.display = (tab === 'private') ? 'flex' : 'none';
}
// Restore the last tab on load, and slide the list between tabs with a swipe.
function _restoreChatTab() {
  var t = 'all';
  try { t = localStorage.getItem('yp_chat_tab') || 'all'; } catch (e) {}
  _setChatTab(t);
}
function _initChatTabSwipe() {
  var area = document.getElementById('chat-list-area');
  if (!area || area._swipeBound) return;
  area._swipeBound = true;
  var x0 = 0, y0 = 0, tracking = false;
  area.addEventListener('touchstart', function (e) { var t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; tracking = true; window._chatRowSwipeHandled = false; }, { passive: true });
  area.addEventListener('touchend', function (e) {
    if (!tracking) return; tracking = false;
    if (window._chatRowSwipeHandled) return;                 // a chat row handled this swipe (reveal delete) — don't switch tabs
    var t = e.changedTouches[0];
    var dx = t.clientX - x0, dy = t.clientY - y0;
    if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.6) return; // must be a clear horizontal swipe
    var i = CHAT_TABS.indexOf(CHAT_tab);
    if (dx < 0 && i < CHAT_TABS.length - 1) _setChatTab(CHAT_TABS[i + 1]);      // swipe left → next tab
    else if (dx > 0 && i > 0) _setChatTab(CHAT_TABS[i - 1]);                    // swipe right → prev tab
  }, { passive: true });
}

// ============================================================
// OPEN ROOM
// ============================================================
window.openChatRoom = function (roomId, topicId, topicName) {
  var room = CHAT_rooms.find(function (r) { return r.id === roomId; });
  if (!room) {
    // Rooms not yet loaded — load them first, then open
    loadChatRooms(function () {
      var r2 = CHAT_rooms.find(function (r) { return r.id === roomId; });
      if (r2) window.openChatRoom(roomId, topicId, topicName);
      else toast('⚠ Chat not found');
    });
    return;
  }

  // Topics feature hidden for now — always open groups as a flat chat,
  // skipping the topics list even if a group still has topics on the server.
  if (room.type === 'group' && topicId === undefined) {
    openChatRoom(roomId, null, null);
    return;
  }

  CHAT_curTopicId = (topicId === 'general') ? null : (topicId || null);
  CHAT_curTopicName = topicName || null;

  // Switch screens using only CSS class (no inline styles that override !important)
  var screenChats    = document.getElementById('screen-chats');
  var screenChatroom = document.getElementById('screen-chatroom');
  if (screenChats)    { screenChats.classList.add('hidden');    screenChats.style.display    = ''; }
  if (screenChatroom) { screenChatroom.classList.remove('hidden'); screenChatroom.style.display = ''; }

  CHAT_curRoom   = room;
  CHAT_replyTo   = null;
  CHAT_unreadNew = 0;
  CHAT_atBottom  = true;
  room.unread    = 0;
  // Remember which chat is open so a page refresh returns here instead of the list.
  try { history.replaceState(null, '', '#room=' + encodeURIComponent(roomId)); } catch (e) {}
  if (typeof closeInChatSearch === 'function') closeInChatSearch();
  renderChatList();
  _startTypingPoll();

  // Header
  var isGroup = room.type === 'group';
  var av = document.getElementById('cr-avatar');
  av.className = 'chatroom-avatar' + (isGroup ? ' group' : '');
  if (room.photo_url) {
    av.style.backgroundImage = "url('" + room.photo_url + "')";
    av.textContent = '';
  } else {
    av.style.backgroundImage = '';
    // Use initial letter — no emoji
    av.textContent = (room.nick || '?').slice(0, 1).toUpperCase();
  }

  document.getElementById('cr-name').textContent = CHAT_curTopicName
    ? (room.nick || 'Chat') + ' › ' + CHAT_curTopicName
    : (room.nick || 'Chat');
  document.getElementById('cr-name').onclick = function(){ openChatInfo(); };
  document.getElementById('cr-name').style.cursor = 'pointer';
  document.getElementById('cr-avatar').onclick = function(){ openChatInfo(); };
  document.getElementById('cr-avatar').style.cursor = 'pointer';

  var st = document.getElementById('cr-status');
  var meId = STATE.user && STATE.user.id;
  var isSuperAdmin = STATE.user && (STATE.user.role === 'admin_super' || STATE.user.is_owner);
  if (room.admin_spectating) {
    st.textContent = '👁 Viewing as Admin';
    st.style.color = 'var(--gold-d)';
  } else if (isGroup) {
    var readOnlyTag = room.read_only ? ' · 🔒 Read-only' : '';
    st.textContent = (room.members != null ? room.members + ' members' : 'Group') + readOnlyTag;
    st.style.color = 'var(--muted)';
  } else if (room.online && isAnyAdmin()) {
    st.textContent = 'online';
    st.style.color = 'var(--green)';
  } else {
    st.textContent = 'last seen recently';
    st.style.color = 'var(--muted)';
  }

  // Join banner
  var needsJoin = (!room.joined && isGroup);
  document.getElementById('join-banner').style.display = needsJoin ? 'flex' : 'none';

  // Read-only enforcement: lock input unless the viewer is a group admin or Super Admin.
  var lockedForReadOnly = isGroup && room.read_only && !room.is_group_admin && !isSuperAdmin;
  var inputDisabled = needsJoin || lockedForReadOnly || !!room.admin_spectating;

  var ib = document.getElementById('chat-input-bar');
  ib.style.display = '';   // restore in case a Telegram channel had hidden it
  ib.style.opacity = inputDisabled ? '.4' : '1';
  ib.style.pointerEvents = inputDisabled ? 'none' : 'all';

  // Make a silent lockout impossible to miss — explain exactly why typing/attaching is blocked.
  if (lockedForReadOnly) {
    toast('🔒 This group is read-only. Only admins can send messages.');
  } else if (room.admin_spectating) {
    toast('👁 You are viewing as Admin. Join the group to send messages.');
  }

  // Reply bar
  document.getElementById('reply-bar').style.display = 'none';
  var _st = document.getElementById('sticker-tray'); if (_st) _st.classList.remove('open');
  var _ep = document.getElementById('emoji-panel'); if (_ep) _ep.style.display = 'none';
  document.getElementById('new-arrow').classList.remove('show');

  // Pinned message bar
  CHAT_pinnedMsgId = room.pinned_message_id || null;
  var pinnedBar = document.getElementById('pinned-bar');
  if (pinnedBar) {
    if (CHAT_pinnedMsgId) {
      pinnedBar.style.display = 'flex';
      var pinnedMsg = CHAT_messages.find(function (m) { return m.id === CHAT_pinnedMsgId; });
      var pinnedText = document.getElementById('pinned-bar-text');
      if (pinnedText) {
        pinnedText.textContent = pinnedMsg ? (pinnedMsg.text || '[Media]') : 'Tap to see pinned message';
      }
      var unpinBtn = document.getElementById('pinned-bar-unpin');
      if (unpinBtn) unpinBtn.style.display = (isAnyAdmin() || room.is_group_admin) ? 'flex' : 'none';
    } else {
      pinnedBar.style.display = 'none';
    }
  }

  navTo('chatroom');
  _applyChannelInputState(room);
  loadMessages(true);
  clearInterval(CHAT_pollTimer);
  CHAT_pollTimer = setInterval(function () {
    // Don't poll while the tab is in the background — saves a huge amount of
    // server load at scale. We refresh instantly when the user comes back.
    if (document.hidden) return;
    loadMessages(false);
  }, 8000);

  // Load members list for groups
  if (isGroup) loadGroupMembers(roomId);

  // Let a group's manager know if people are waiting to join.
  var _canMng = isGroup && (room.is_group_admin || (STATE.user && (STATE.user.role === 'admin_super' || STATE.user.is_owner)));
  if (_canMng) {
    api.get('/chat/join-requests?room_id=' + encodeURIComponent(roomId)).then(function (res) {
      if (res.ok && res.requests && res.requests.length && CHAT_curRoom && CHAT_curRoom.id === roomId) {
        toast('📩 ' + res.requests.length + ' join request' + (res.requests.length > 1 ? 's' : '') + ' — tap the group name to review');
      }
    }).catch(function () {});
  }
};

// ============================================================
// MEMBERS LIST
// ============================================================
window.openChatInfo = function () {
  if (!CHAT_curRoom) return;
  var isGroup = CHAT_curRoom.type === 'group';

  var avBig = document.getElementById('info-avatar-big');
  if (CHAT_curRoom.photo_url) {
    avBig.style.backgroundImage = "url('" + CHAT_curRoom.photo_url + "')";
    avBig.textContent = '';
  } else {
    avBig.style.backgroundImage = '';
    avBig.textContent = isGroup ? '👥' : (CHAT_curRoom.nick || '?').slice(0, 1).toUpperCase();
  }
  avBig.onclick = isGroup ? function () { document.getElementById('group-photo-input').click(); } : function () { _viewChatPartnerStatus(); };
  avBig.style.cursor = 'pointer';

  // For 1-on-1 chats, check if the other person has an active status and add a ring
  if (!isGroup && CHAT_curRoom.id) {
    var otherUserId = CHAT_curRoom.other_user_id || CHAT_curRoom.id;
    api.get('/statuses?user_id=' + encodeURIComponent(otherUserId), true)
      .then(function (res) {
        var data = (res.statuses || [])[0];
        avBig.style.boxShadow = (data && data.slides && data.slides.length) ? '0 0 0 3px var(--blue)' : 'none';
      })
      .catch(function () {});
  } else {
    avBig.style.boxShadow = 'none';
  }

  document.getElementById('info-name').textContent = CHAT_curRoom.nick || 'Chat';
  document.getElementById('info-sub').textContent = isGroup
    ? (CHAT_curRoom.members || 0) + ' members'
    : (CHAT_curRoom.online && isAnyAdmin() ? 'online' : 'last seen recently');

  document.getElementById('info-leave-btn').style.display = isGroup ? 'flex' : 'none';
  document.getElementById('info-members-section').style.display = isGroup ? 'block' : 'none';
  document.getElementById('info-bio-card').style.display = 'none';

  // Group admin settings panel — visible to this group's sub-admins and Super Admins.
  var meId = STATE.user && STATE.user.id;
  var isSuperAdmin = STATE.user && (STATE.user.role === 'admin_super' || STATE.user.is_owner);
  var canManageGroup = isGroup && (CHAT_curRoom.is_group_admin || isSuperAdmin);
  document.getElementById('info-admin-settings').style.display = canManageGroup ? 'block' : 'none';

  if (canManageGroup) _loadJoinRequests(CHAT_curRoom.id);

  if (canManageGroup) {
    document.getElementById('group-readonly-toggle').classList.toggle('on', !CHAT_curRoom.read_only);
    document.getElementById('group-visibility-toggle').classList.toggle('on', CHAT_curRoom.visibility === 'public');
    var adLabel = document.getElementById('auto-delete-label');
    if (adLabel) {
      var mins = CHAT_curRoom.auto_delete_minutes;
      adLabel.textContent = mins ? _autoDeleteLabel(mins) : 'Off';
    }
  }

  // Reset tabs to "media"
  var tabs = document.querySelectorAll('#info-media-tabs .userinfo-mtab');
  tabs.forEach(function (t, i) { t.classList.toggle('active', i === 0); });
  _renderInfoTab('media');

  if (isGroup) {
    document.getElementById('info-members-count').textContent = 'Members (' + (CHAT_curRoom.members || 0) + ')';
    loadGroupMembers(CHAT_curRoom.id);
    _renderMembersList();
  }

  navTo('chatinfo');
};
window.openMembersList = window.openChatInfo; // legacy alias

// ── Private-group join requests (managers see & approve/reject) ──
function _loadJoinRequests(roomId) {
  // Ensure a container exists at the top of the admin-settings panel.
  var panel = document.getElementById('info-admin-settings');
  if (!panel) return;
  var box = document.getElementById('join-requests-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'join-requests-box';
    box.style.cssText = 'margin-bottom:1rem';
    panel.insertBefore(box, panel.firstChild);
  }
  box.innerHTML = '';
  api.get('/chat/join-requests?room_id=' + encodeURIComponent(roomId)).then(function (res) {
    if (!res.ok || !res.requests || !res.requests.length) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    var items = res.requests.map(function (r) {
      var av = r.photo_url
        ? '<img src="' + escHtml(r.photo_url) + '" style="width:38px;height:38px;border-radius:50%;object-fit:cover">'
        : '<div style="width:38px;height:38px;border-radius:50%;background:var(--blue);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700">' + escHtml((r.nickname || '?').charAt(0)) + '</div>';
      return '<div style="display:flex;align-items:center;gap:.6rem;padding:.5rem 0;border-bottom:1px solid var(--border)">' +
        av +
        '<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:.9rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" dir="auto">' + escHtml(r.nickname || 'Someone') + '</div>' +
        '<div style="font-size:.7rem;color:var(--muted)">wants to join</div></div>' +
        '<button onclick="_answerJoinReq(\'' + r.id + '\',\'approve\',this)" style="background:var(--blue);color:#fff;border:none;border-radius:8px;padding:.4rem .7rem;font-weight:700;font-size:.8rem;cursor:pointer">Add</button>' +
        '<button onclick="_answerJoinReq(\'' + r.id + '\',\'reject\',this)" style="background:none;color:var(--red);border:none;border-radius:8px;padding:.4rem .5rem;font-size:.8rem;cursor:pointer">✕</button>' +
      '</div>';
    }).join('');
    box.innerHTML = '<div style="font-size:.72rem;font-weight:800;letter-spacing:.06em;color:var(--blue);margin-bottom:.4rem">📩 JOIN REQUESTS (' + res.requests.length + ')</div>' + items;
  }).catch(function () { box.style.display = 'none'; });
}
window._answerJoinReq = function (reqId, action, btn) {
  var row = btn && btn.parentElement;
  if (row) row.style.opacity = '.4';
  api.post('/chat/join-requests', { request_id: reqId, action: action }).then(function (res) {
    if (!res.ok) { toast('❌ ' + (res.error || 'Failed')); if (row) row.style.opacity = '1'; return; }
    toast(action === 'approve' ? '✅ Added to group' : 'Request declined');
    if (row) row.remove();
    if (action === 'approve') { loadGroupMembers(CHAT_curRoom.id); loadMessages(true); }
    _loadJoinRequests(CHAT_curRoom.id);
    _updateJoinReqBadge();
  }).catch(function (e) { toast('❌ ' + e.message); if (row) row.style.opacity = '1'; });
};
// Small badge on the chats list so managers notice new requests without digging.
function _updateJoinReqBadge() {
  api.get('/chat/join-requests?count=1').then(function (res) {
    var el = document.getElementById('join-req-badge');
    if (!el) return;
    if (res.ok && res.count > 0) { el.textContent = res.count; el.style.display = 'flex'; }
    else el.style.display = 'none';
  }).catch(function () {});
}


window.toggleGroupReadOnly = function () {
  if (!CHAT_curRoom) return;
  var toggle = document.getElementById('group-readonly-toggle');
  var nowEveryoneCanWrite = !toggle.classList.contains('on');
  toggle.classList.toggle('on', nowEveryoneCanWrite);

  api.put('/chat/rooms', { room_id: CHAT_curRoom.id, read_only: !nowEveryoneCanWrite })
    .then(function () {
      CHAT_curRoom.read_only = !nowEveryoneCanWrite;
      toast(nowEveryoneCanWrite ? '✍️ Everyone can write now' : '🔒 Group set to admins-only');
    })
    .catch(function (err) {
      toggle.classList.toggle('on', !nowEveryoneCanWrite); // revert on failure
      toast('❌ ' + err.message);
    });
};

window.toggleGroupVisibility = function () {
  if (!CHAT_curRoom) return;
  var toggle = document.getElementById('group-visibility-toggle');
  var nowPublic = !toggle.classList.contains('on');
  toggle.classList.toggle('on', nowPublic);

  api.put('/chat/rooms', { room_id: CHAT_curRoom.id, visibility: nowPublic ? 'public' : 'private' })
    .then(function () {
      CHAT_curRoom.visibility = nowPublic ? 'public' : 'private';
      toast(nowPublic ? '🌍 Group is now public' : '🔒 Group is now private');
    })
    .catch(function (err) {
      toggle.classList.toggle('on', !nowPublic);
      toast('❌ ' + err.message);
    });
};

function _autoDeleteLabel(minutes) {
  if (minutes >= 43200) return '30 days';
  if (minutes >= 10080) return '7 days';
  if (minutes >= 1440)  return '24 hours';
  if (minutes >= 60)    return '1 hour';
  return minutes + ' min';
}

window.openAutoDeleteModal = function () {
  if (!CHAT_curRoom) return;
  var sel = document.getElementById('auto-delete-select');
  if (sel) sel.value = CHAT_curRoom.auto_delete_minutes || '';
  document.getElementById('auto-delete-modal').classList.add('open');
};

window.saveAutoDelete = function () {
  if (!CHAT_curRoom) return;
  var sel = document.getElementById('auto-delete-select');
  var minutes = sel.value ? parseInt(sel.value, 10) : null;

  api.put('/chat/rooms', { room_id: CHAT_curRoom.id, auto_delete_minutes: minutes })
    .then(function () {
      CHAT_curRoom.auto_delete_minutes = minutes;
      var adLabel = document.getElementById('auto-delete-label');
      if (adLabel) adLabel.textContent = minutes ? _autoDeleteLabel(minutes) : 'Off';
      document.getElementById('auto-delete-modal').classList.remove('open');
      toast(minutes ? '⏱️ Auto-delete set to ' + _autoDeleteLabel(minutes) : '⏱️ Auto-delete turned off');
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

// Promote/demote a member to group sub-admin, or remove them — called from the members list.
// Tapping a member's name in the group member list opens a private DM with
// them ONLY if they're an admin (group admin or platform admin) — regular
// members are not DM-able from here, by design.
window._openMemberDM = function (memberId, nickname) {
  var meId = STATE.user && STATE.user.id;
  if (memberId === meId) return; // can't DM yourself

  var member = (CHAT_members || []).find(function (m) { return m.id === memberId; });
  var isAdminMember = member && (
    member.is_group_admin ||
    member.role === 'admin_super' ||
    member.role === 'admin_limited'
  );
  if (!isAdminMember) return; // regular members: name tap does nothing

  toast('💬 Opening private chat with @' + nickname + '...');
  api.post('/chat/rooms', { type: 'private', other_user_id: memberId })
    .then(function (res) {
      loadChatRooms();
      setTimeout(function () { openChatRoomById(res.room_id); }, 300);
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.toggleMemberGroupAdmin = function (memberId, makeAdmin) {
  if (!CHAT_curRoom) return;
  api.put('/chat/rooms', { room_id: CHAT_curRoom.id, member_id: memberId, make_admin: makeAdmin })
    .then(function () {
      toast(makeAdmin ? '🛡 Promoted to group admin' : '➖ Removed group admin');
      loadGroupMembers(CHAT_curRoom.id);
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.removeMemberFromGroup = function (memberId) {
  if (!CHAT_curRoom) return;
  ypConfirm('Remove this member from the group?', { danger: true, okText: 'Remove' }).then(function (ok) {
    if (!ok) return;
    api.put('/chat/rooms', { room_id: CHAT_curRoom.id, member_id: memberId, remove: true })
      .then(function () {
        toast('🚪 Member removed');
        loadGroupMembers(CHAT_curRoom.id);
        loadMessages(true);
      })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
};

function loadGroupMembers(roomId) {
  api.get('/chat/rooms').then(function (res) {
    var room = (res.rooms || []).find(function (r) { return r.id === roomId; });
    if (room && room.member_list) {
      CHAT_members = room.member_list;
      _renderMembersList();
    }
  }).catch(function () {});
}

function _renderMembersList() {
  var list = document.getElementById('members-list');
  if (!list) return;
  if (!CHAT_members.length) {
    list.innerHTML = '<div style="padding:1rem;text-align:center;font-size:.8rem;color:var(--muted)">Loading members...</div>';
    return;
  }
  var meId = STATE.user && STATE.user.id;
  var isSuperAdmin = STATE.user && (STATE.user.role === 'admin_super' || STATE.user.is_owner);
  var canManageGroup = CHAT_curRoom && (CHAT_curRoom.is_group_admin || isSuperAdmin);

  list.innerHTML = CHAT_members.map(function (m) {
    var photoStyle = m.photo_url ? "background-image:url('" + m.photo_url + "');background-size:cover;background-position:center;" : '';
    var isSelf = m.id === meId;
    var controls = '';
    if (canManageGroup && !isSelf) {
      controls = '<div style="display:flex;gap:.3rem;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end">' +
        '<button onclick="event.stopPropagation();promptSetMemberTitle(\'' + m.id + '\',\'' + escHtml(m.title || '').replace(/'/g, "\\'") + '\')" style="background:none;border:1px solid var(--border);border-radius:6px;padding:.2rem .4rem;font-size:.65rem;cursor:pointer;color:var(--text)">🏷 Title</button>' +
        '<button onclick="event.stopPropagation();toggleMemberGroupAdmin(\'' + m.id + '\',' + !m.is_group_admin + ')" style="background:none;border:1px solid var(--border);border-radius:6px;padding:.2rem .4rem;font-size:.65rem;cursor:pointer;color:var(--blue)">' + (m.is_group_admin ? 'Demote' : 'Make Admin') + '</button>' +
        '<button onclick="event.stopPropagation();removeMemberFromGroup(\'' + m.id + '\')" style="background:none;border:1px solid var(--border);border-radius:6px;padding:.2rem .4rem;font-size:.65rem;cursor:pointer;color:var(--red)">Remove</button>' +
      '</div>';
    }
    var isMemberAdmin = m.is_group_admin || m.role === 'admin_super' || m.role === 'admin_limited';
    return '<div class="member-row-admin">' +
      '<div class="member-photo" style="' + photoStyle + '">' +
        (m.photo_url ? '' : (m.nickname || '?').slice(0, 1).toUpperCase()) +
      '</div>' +
      '<div style="flex:1;unicode-bidi:plaintext;text-align:start;' + (isMemberAdmin ? 'cursor:pointer' : '') + '" onclick="_openMemberDM(\'' + m.id + '\',\'' + escHtml(m.nickname || 'User').replace(/'/g, "\\'") + '\')"><div style="font-size:.85rem;font-weight:700">@' + escHtml(m.nickname || 'User') + '</div>' +
      (m.title ? '<div style="font-size:.68rem;color:var(--blue);font-weight:600">' + escHtml(m.title) + '</div>' : '') +
      (m.online && isAnyAdmin() ? '<div style="font-size:.68rem;color:var(--green)">● online</div>' : '') +
      '</div>' +
      (m.role === 'admin_super' || m.role === 'admin_limited' ? '<span style="font-size:.65rem;background:#EAF4FF;color:var(--blue);border:1px solid #BBDEFB;border-radius:6px;padding:.1rem .4rem">Admin</span>' : '') +
      (m.is_group_admin ? '<span style="font-size:.65rem;background:#FFF3E0;color:#E65100;border:1px solid #FFE0B2;border-radius:6px;padding:.1rem .4rem;margin-left:.3rem">Group Admin</span>' : '') +
      controls +
    '</div>';
  }).join('');
}

window.promptSetMemberTitle = function (memberId, currentTitle) {
  if (!CHAT_curRoom) return;
  ypPrompt('Role title for this member (e.g. "Moderator"). Leave blank to remove:', { title: 'Member title', value: currentTitle || '', placeholder: 'Moderator', okText: 'Save' }).then(function (title) {
    if (title === null) return;
    api.put('/chat/rooms', { room_id: CHAT_curRoom.id, member_id: memberId, member_title: title.trim() })
      .then(function () {
        toast(title.trim() ? '✅ Title set!' : '✅ Title removed');
        loadGroupMembers(CHAT_curRoom.id);
      })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
};

window.switchInfoTab = function (btn, tab) {
  document.querySelectorAll('#info-media-tabs .userinfo-mtab').forEach(function (t) { t.classList.remove('active'); });
  btn.classList.add('active');
  _renderInfoTab(tab);
};

function _renderInfoTab(tab) {
  var el = document.getElementById('info-tab-content');
  if (!el || !CHAT_curRoom) return;
  el.innerHTML = '<div class="feed-state"><div class="spinner"></div></div>';

  api.get('/chat?room_id=' + encodeURIComponent(CHAT_curRoom.id))
    .then(function (res) {
      var msgs = res.messages || [];
      var filtered;
      if (tab === 'media') {
        filtered = msgs.filter(function (m) { return m.type === 'media' && m.media_url; });
        if (!filtered.length) { el.innerHTML = _emptyTabMsg('🖼️', 'No media yet'); return; }
        el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px">' +
          filtered.map(function (m) {
            var isVideo = /\.(mp4|webm|mov)$/i.test(m.media_key || '');
            return '<div style="aspect-ratio:1;background:#000;border-radius:4px;overflow:hidden;position:relative">' +
              (isVideo
                ? '<video src="' + m.media_url + '" style="width:100%;height:100%;object-fit:cover"></video><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>'
                : '<img src="' + m.media_url + '" style="width:100%;height:100%;object-fit:cover" loading="lazy">') +
            '</div>';
          }).join('') + '</div>';
      } else if (tab === 'files') {
        filtered = msgs.filter(function (m) { return m.type === 'file' && m.media_url; });
        if (!filtered.length) { el.innerHTML = _emptyTabMsg('📄', 'No files yet'); return; }
        el.innerHTML = filtered.map(function (m) {
          return '<a href="' + m.media_url + '" target="_blank" style="display:flex;align-items:center;gap:.6rem;padding:.6rem 0;border-bottom:1px solid var(--border);text-decoration:none;color:var(--text)">' +
            '<span style="font-size:1.4rem">📄</span><span style="font-size:.85rem">' + escHtml(m.text || 'File') + '</span></a>';
        }).join('');
      } else if (tab === 'links') {
        filtered = msgs.filter(function (m) { return m.type === 'text' && /https?:\/\//.test(m.text || ''); });
        if (!filtered.length) { el.innerHTML = _emptyTabMsg('🔗', 'No links yet'); return; }
        el.innerHTML = filtered.map(function (m) {
          var url = (m.text.match(/https?:\/\/[^\s]+/) || [''])[0];
          return '<a href="' + url + '" target="_blank" style="display:block;padding:.6rem 0;border-bottom:1px solid var(--border);color:var(--blue);font-size:.82rem;word-break:break-all;text-decoration:none">' + escHtml(url) + '</a>';
        }).join('');
      } else if (tab === 'voice') {
        filtered = msgs.filter(function (m) { return m.type === 'voice' && m.media_url; });
        if (!filtered.length) { el.innerHTML = _emptyTabMsg('🎤', 'No voice messages yet'); return; }
        el.innerHTML = filtered.map(function (m) {
          return '<div style="display:flex;align-items:center;gap:.6rem;padding:.6rem 0;border-bottom:1px solid var(--border)">' +
            '<audio src="' + m.media_url + '" controls style="flex:1;height:32px"></audio>' +
            '<span style="font-size:.7rem;color:var(--muted)">' + (m.text || '') + '</span></div>';
        }).join('');
      }
    })
    .catch(function () { el.innerHTML = _emptyTabMsg('⚠️', 'Could not load'); });
}

function _emptyTabMsg(icon, text) {
  return '<div style="text-align:center;padding:2rem 1rem;color:var(--muted)"><div style="font-size:2rem;margin-bottom:.5rem">' + icon + '</div><div style="font-size:.85rem">' + text + '</div></div>';
}

window.confirmLeaveGroup = function () {
  if (!CHAT_curRoom) return;
  ypConfirm('Leave "' + CHAT_curRoom.nick + '"?', { danger: true, okText: 'Leave' }).then(function (ok) {
    if (!ok) return;
    api.del('/chat/rooms?room_id=' + encodeURIComponent(CHAT_curRoom.id))
      .then(function () {
        toast('You left the group.');
        navTo('chats');
        loadChatRooms();
      })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
};

// ============================================================
// LOAD & RENDER MESSAGES
// ============================================================
function loadMessages(scrollToBottom) {
  if (!CHAT_curRoom) return;

  var topicQuery = CHAT_curTopicId ? ('&topic_id=' + encodeURIComponent(CHAT_curTopicId)) : '';
  api.get('/chat?room_id=' + encodeURIComponent(CHAT_curRoom.id) + topicQuery)
    .then(function (res) {
      var msgs    = res.messages || [];
      var prevLen = CHAT_messages.length;
      CHAT_messages = msgs;

      // Count new messages while not at bottom
      if (!scrollToBottom && !CHAT_atBottom && msgs.length > prevLen) {
        CHAT_unreadNew += (msgs.length - prevLen);
        var arrow = document.getElementById('new-arrow');
        if (arrow) {
          arrow.classList.add('show');
          var badge = document.getElementById('new-count');
          if (badge) { badge.textContent = CHAT_unreadNew; badge.style.display = 'flex'; }
        }
      }

      // Only rebuild the message list when something actually changed. The 8s
      // poll was calling renderMessages every time, which rebuilt innerHTML and
      // destroyed any <audio> mid-playback — that was the voice/music "shockt
      // zich op" glitch. Build a lightweight signature of what's visible.
      var newSig = msgs.map(function (m) {
        return m.id + ':' + ((m.text || '').length) + ':' +
          (m.reactions ? JSON.stringify(m.reactions).length : 0) + ':' +
          (m.edited ? 1 : 0) + ':' + (m.read ? 1 : 0) + ':' + (m.opened ? 1 : 0) + ':' + (m.pinned ? 1 : 0);
      }).join('|');

      if (newSig === CHAT_lastRenderSig && !scrollToBottom) {
        // Nothing visible changed — skip the rebuild entirely.
      } else {
        renderMessages(scrollToBottom || CHAT_atBottom);
        CHAT_lastRenderSig = newSig;
        _ypRestoreUI(); // re-assert play/pause icon for any audio still playing
      }

      // Update pinned bar text now that messages are loaded
      if (CHAT_pinnedMsgId) {
        var pinnedMsg = CHAT_messages.find(function (m) { return m.id === CHAT_pinnedMsgId; });
        var pinnedText = document.getElementById('pinned-bar-text');
        if (pinnedText && pinnedMsg) {
          pinnedText.textContent = pinnedMsg.text || '[Media]';
        }
      }

      // Fetch link previews asynchronously
      setTimeout(function () {
        CHAT_messages.forEach(function (m) {
          if (!m.text) return;
          var urlMatch = m.text.match(/(https?:\/\/[^\s]{10,})/);
          if (!urlMatch) return;
          var rawUrl = urlMatch[1];
          var lpEl = document.getElementById('lp-' + m.id);
          if (!lpEl || lpEl.dataset.loaded) return;

          // Internal invite/join links have no useful preview and render as an
          // empty white box — skip them (the link text stays clickable).
          if (/\/chat\?join=|\/invite\b|yidplus\.com\/chat\?/i.test(rawUrl)) { lpEl.dataset.loaded = '1'; return; }

          // Re-renders (e.g. a read-receipt change) replace the message node and
          // wipe the loaded preview; repopulate instantly from cache so it never
          // flickers or "dances".
          if (CHAT_lpCache[m.id]) {
            lpEl.dataset.loaded = '1';
            lpEl.style.cssText = CHAT_lpCache[m.id].css;
            lpEl.innerHTML = CHAT_lpCache[m.id].html;
            lpEl.onclick = CHAT_lpCache[m.id].url ? function () { window.open(CHAT_lpCache[m.id].url, '_blank'); } : null;
            return;
          }
          lpEl.dataset.loaded = '1';

          // YouTube embed
          var ytMatch = rawUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/live\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/);
          if (ytMatch) {
            var vid = ytMatch[1];
            lpEl.style.display = 'block';
            lpEl.innerHTML =
              '<div style="border-radius:12px;overflow:hidden;cursor:pointer;background:#000;position:relative;padding-top:56.25%">' +
                '<iframe src="https://www.youtube.com/embed/' + vid + '?rel=0" ' +
                  'style="position:absolute;top:0;left:0;width:100%;height:100%;border:none" ' +
                  'allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" ' +
                  'allowfullscreen loading="lazy"></iframe>' +
              '</div>';
            CHAT_lpCache[m.id] = { html: lpEl.innerHTML, css: lpEl.style.cssText, url: '' };
            return;
          }
          api.get('/link-preview?url=' + encodeURIComponent(rawUrl))
            .then(function (res) {
              if (!res || !res.ok || !res.title) return;
              var isMe = m.sender_id === (STATE.user && STATE.user.id);
              lpEl.onclick = function () { window.open(rawUrl, '_blank'); };
              lpEl.style.cssText = 'display:block;margin-top:.4rem;border-radius:12px;overflow:hidden;border:1px solid var(--border);cursor:pointer;background:var(--surface);max-width:100%;opacity:0;transition:opacity .25s ease';
              lpEl.innerHTML =
                (res.image
                  ? '<img src="' + escHtml(res.image) + '" onerror="this.style.display=&#39;none&#39;" style="width:100%;aspect-ratio:1.91/1;max-height:150px;object-fit:cover;display:block;background:var(--bg3)" loading="lazy">'
                  : '') +
                '<div style="padding:.5rem .65rem">' +
                  '<div style="font-size:.7rem;color:' + (isMe ? 'rgba(255,255,255,.6)' : 'var(--muted)') + ';margin-bottom:.15rem;text-overflow:ellipsis;overflow:hidden;white-space:nowrap">' + escHtml(new URL(rawUrl).hostname) + '</div>' +
                  '<div style="font-size:.82rem;font-weight:700;color:' + (isMe ? '#fff' : 'var(--text)') + ';line-height:1.3">' + escHtml(res.title.slice(0, 80)) + '</div>' +
                  (res.description ? '<div style="font-size:.72rem;color:' + (isMe ? 'rgba(255,255,255,.75)' : 'var(--muted)') + ';margin-top:.2rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + escHtml(res.description.slice(0, 120)) + '</div>' : '') +
                '</div>';
              lpEl.style.display = 'block';
              CHAT_lpCache[m.id] = { html: lpEl.innerHTML, css: 'display:block;margin-top:.4rem;border-radius:12px;overflow:hidden;border:1px solid var(--border);cursor:pointer;background:var(--surface);max-width:100%;opacity:1', url: rawUrl };
              // Fade in on the next frame instead of popping straight to
              // opacity 1 — softens the sudden appearance once the async
              // preview fetch resolves, since it always lands a beat after
              // the message itself is already rendered and scrolled.
              requestAnimationFrame(function () { lpEl.style.opacity = '1'; });
            })
            .catch(function () {});
        });
      }, 600);

      // Mark as read
      if (CHAT_curRoom.joined !== false) {
        api.post('/chat/read', { room_id: CHAT_curRoom.id }).catch(function () {});
        // Clear the list badge immediately so it doesn't flash back when you
        // return to the chat list before the next server refresh.
        var _cachedRoom = CHAT_rooms.find(function (r) { return r.id === CHAT_curRoom.id; });
        if (_cachedRoom) _cachedRoom.unread = 0;
      }

      // Load reaction summary for this room and re-render once available.
      api.get('/chat/reactions?room_id=' + encodeURIComponent(CHAT_curRoom.id))
        .then(function (rres) {
          CHAT_reactions = rres.reactions || {};
          renderMessages(false);
        })
        .catch(function () {});
    })
    .catch(function () {});
}

function renderMessages(scrollDown) {
  var cont = document.getElementById('chat-msgs');
  if (!cont || !CHAT_curRoom) return;

  if (!CHAT_messages.length) {
    cont.innerHTML =
      '<div class="feed-state" style="height:100%">' +
        '<div style="font-size:2.5rem">💬</div>' +
        '<div>No messages yet — say hello!</div>' +
      '</div>';
    return;
  }

  var meId      = STATE.user && STATE.user.id;
  var isGroup   = CHAT_curRoom.type === 'group';
  var isChannel = CHAT_curRoom.type === 'channel';
  var lastDate  = '';
  // Group consecutive media messages into albums
  var albumGroups = _groupMediaAlbums(CHAT_messages);

  var _htmlArr = CHAT_messages.map(function (m, idx) {
    var isMe = m.sender_id === meId;
    var msgDate = m.created_at ? m.created_at.slice(0, 10) : '';
    var dateSep = '';
    if (msgDate && msgDate !== lastDate) {
      lastDate = msgDate;
      dateSep = '<div class="date-sep"><span>' + _dateLabel(m.created_at) + '</span></div>';
    }

    var time = m.created_at ? _fmt12(m.created_at) : '';
    // Small indicators for scheduled (not yet sent) and disappearing messages.
    if (m._scheduled_pending) time = '🕓 ' + _fmt12(m.scheduled_for) + ' · ' + time;
    else if (m.expires_at) time = '💨 ' + time;
    var tickSvg = m.read
      ? '<svg width="16" height="10" viewBox="0 0 16 10" fill="none" style="display:inline-block;vertical-align:middle;margin-left:2px"><path d="M1 5l3 3 5-7" stroke="rgba(255,255,255,.7)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 5l3 3 5-7" stroke="rgba(255,255,255,.9)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" style="display:inline-block;vertical-align:middle;margin-left:2px"><path d="M1 5l3 3 5-6" stroke="rgba(255,255,255,.6)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var ticks;
    if (isMe && isGroup && typeof m.seen_count === 'number') {
      // Group read receipt: show how many members have seen this message.
      ticks = '<span class="read-ticks" style="font-size:.62rem;opacity:.85">' +
        (m.seen_count > 0 ? ('👁 ' + m.seen_count) : tickSvg) + '</span>';
    } else {
      ticks = isMe ? '<span class="read-ticks">' + tickSvg + '</span>' : '';
    }

    // System messages (e.g. "X joined the group") — centered, no bubble
    if (m.type === 'system') {
      return dateSep + '<div class="sys-msg"><span>' + escHtml(m.text || '') + '</span></div>';
    }

    var isMediaMsg = (m.type === 'media' && m.media_url);
    var isEmojiOnlyMsg = ((m.type === 'text' || !m.type) && _isEmojiOnlyText(m.text));
    var bubbleClass = 'bubble ' + (isMe ? 'me' : 'them') + (isMediaMsg ? ' bubble-media' : '') + (isEmojiOnlyMsg ? ' bubble-emoji' : '');
    var inner = '';

    // Group sender nick
    if (!isMe && isGroup) {
      var titleBadge = m.sender_title
        ? '<span style="margin-right:.35rem;padding:.05rem .4rem;border-radius:8px;background:rgba(31,111,92,.12);color:var(--blue);font-size:.62rem;font-weight:700;vertical-align:middle">' + escHtml(m.sender_title) + '</span>'
        : '';
      inner += '<div class="bubble-nick" style="cursor:pointer"><span onclick="openUserProfile(\'' + m.sender_id + '\')">@' + escHtml(m.sender_nick || '') + '</span>' + titleBadge + '</div>';
    }

    // Reply quote
    if (m.reply_to_id) {
      var quoted = CHAT_messages.find(function (q) { return q.id === m.reply_to_id; });
      if (quoted) {
        var quotedName = escHtml(quoted.sender_id === meId ? 'You' : (quoted.sender_nick || 'User'));
        var quotedIsMedia = quoted.type === 'media' && quoted.media_url;
        var quotedIsVideo = quotedIsMedia && /\.(mp4|webm|mov)$/i.test(quoted.media_key || '');
        var quotedThumb = quotedIsMedia
          ? (quotedIsVideo
              ? '<div style="width:40px;height:40px;border-radius:4px;background:#000;flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden"><video src="' + quoted.media_url + '" style="width:100%;height:100%;object-fit:cover" preload="metadata"></video><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center"><svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></div></div>'
              : '<img src="' + quoted.media_url + '" style="width:40px;height:40px;border-radius:4px;object-fit:cover;flex-shrink:0" loading="lazy">')
          : '';
        var quotedText = quoted.type === 'media' ? (quotedIsVideo ? '🎬 Video' : '🖼 Photo') :
                         quoted.type === 'voice'  ? '🎤 Voice message' :
                         quoted.type === 'sticker' ? quoted.text :
                         escHtml((quoted.text || '[media]').slice(0, 60));
        var quotedNameColor = avatarColor(quoted.sender_id || quoted.sender_nick).match(/#[0-9A-Fa-f]{6}/)[0];
        inner += '<div class="reply-quote" onclick="scrollToMsg(\'' + quoted.id + '\')" style="display:flex;align-items:center;gap:.5rem;border-left-color:' + quotedNameColor + '">' +
          quotedThumb +
          '<div style="min-width:0;flex:1"><strong style="display:block;font-size:.72rem;color:' + quotedNameColor + '">' + quotedName + '</strong>' +
          '<span style="unicode-bidi:plaintext;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + quotedText + '</span></div>' +
        '</div>';
      }
    }

    // Content
    if (m.type === 'poll') {
      return dateSep + '<div class="msg-wrap' + (isMe ? ' me' : '') + '" id="msg-' + m.id + '" data-id="' + m.id + '">' +
        '<div class="bubble ' + (isMe ? 'me' : 'them') + ' poll-bubble-wrap" data-msg-id="' + m.id + '" oncontextmenu="event.preventDefault();showCtx(event,\'' + m.id + '\')">' +
          '<div id="poll-' + m.text + '">' + _renderPollBubble(m, isMe) + '</div>' +
          '<div class="bubble-meta"><span class="bubble-time">' + (m.created_at ? _fmt12(m.created_at) : '') + '</span></div>' +
        '</div>' +
      '</div>';

    } else if (m.type === 'sticker') {
      var stickerUrl = m.text || '';
      // Built-in animated stickers are absolute URLs (https://...); custom
      // stickers uploaded by users are our own relative /api/media/... path.
      // The old check only recognized the absolute case, so a custom
      // sticker's URL fell through to being displayed as literal raw text
      // instead of rendering as an image.
      var isGif = stickerUrl.startsWith('http') || stickerUrl.startsWith('/');
      return dateSep + '<div class="msg-wrap' + (isMe ? ' me' : '') + '" id="msg-' + m.id + '" data-id="' + m.id + '">' +
        '<div class="bubble sticker" data-msg-id="' + m.id + '" ' +
          'oncontextmenu="event.preventDefault();showCtx(event,\'' + m.id + '\')">' +
          (isGif
            ? '<img src="' + escHtml(stickerUrl) + '" style="width:110px;height:110px;border-radius:12px;object-fit:cover;display:block" loading="lazy">'
            : escHtml(stickerUrl || '😊')) +
        '</div>' +
      '</div>';

    } else if (m.type === 'voice') {
      if (m.media_url) {
        var voiceData = _parseVoicePacked(m.text);
        var bars = voiceData.peaks.length ? _renderWaveBars(voiceData.peaks) : _fakeBars(20);
        var isViewOnceVoice = m.view_once && !isMe;
        if (isViewOnceVoice && m.opened) {
          inner += '<div class="voice-msg" style="opacity:.5"><div style="font-size:.8rem;color:var(--muted)">🎤 Voice message opened</div></div>';
        } else if (isViewOnceVoice) {
          inner += '<div class="voice-msg" onclick="_openOnceVoice(\'' + m.id + '\',\'' + m.media_url + '\')" style="cursor:pointer">' +
            '<div class="play-voice" style="background:var(--gold-d)"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 23c-4.97 0-9-3.5-9-8 0-2.3 1-4.3 2.5-6C6 8 6.5 6.5 7 5c1.5 2 2.5 4 2.5 6 0 .8-.2 1.5-.5 2 1.5-1 2.5-2.5 3-4.5 2 1.5 4 4 4 6.5 0 4.5-4.03 8-9 8z"/></svg></div>' +
            '<div style="font-size:.8rem;flex:1">🔥 Tap to play once</div>' +
          '</div>';
        } else {
          inner += '<div class="voice-msg">' +
            '<button class="play-voice" id="pbtn-' + m.id + '" onclick="_playVoice(\'' + m.id + '\',this)">' + ICON_PLAY_SM + '</button>' +
            '<div class="voice-body">' +
              '<div class="voice-bars" id="vbars-' + m.id + '" onclick="_seekVoice(event,\'' + m.id + '\')">' + bars + '</div>' +
              '<div class="voice-meta">' +
                '<div class="voice-dur" id="vdur-' + m.id + '">' + (voiceData.dur || '0:00') + '</div>' +
                '<button class="voice-speed-btn" id="vspeed-' + m.id + '" onclick="_toggleVoiceSpeed(\'' + m.id + '\')">1x</button>' +
              '</div>' +
            '</div>' +
          '</div>';
        }
      } else {
        // The audio file reference is missing (e.g. an upload that failed
        // before today's fixes). Show a clear broken-state instead of
        // dumping the raw waveform-data string as plain text.
        inner += '<div class="voice-msg" style="opacity:.6">' +
          '<div class="play-voice" style="background:var(--muted2)">⚠️</div>' +
          '<div style="font-size:.78rem;flex:1">Voice message unavailable</div>' +
        '</div>';
      }

    } else if (m.type === 'voice_text') {
      // Voice note without actual audio (fallback)
      inner += '<div class="voice-msg">' +
        '<button class="play-voice" onclick="toast(\'Audio not available\')"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>' +
        '<div class="voice-bars">' + _fakeBars(20) + '</div>' +
        '<div class="voice-dur">' + (m.text || '0:00') + '</div>' +
      '</div>';

    } else if (m.type === 'media' && m.media_url) {
      var isVideo = /\.(mp4|webm|mov)$/i.test(m.media_key || '');
      var isOnce  = m.text === '__once__';
      if (isOnce) {
        inner += '<div style="background:rgba(0,0,0,.08);border-radius:10px;padding:.75rem;text-align:center;cursor:pointer" onclick="_openOnce(\'' + m.id + '\',this)">' +
          '<div style="font-size:1.5rem">👁</div>' +
          '<div style="font-size:.78rem;margin-top:.25rem">View once · tap to open</div>' +
        '</div>';
      } else if (isVideo) {
        // Check if part of album
        var albumInfo = albumGroups[m.id];
        if (albumInfo && albumInfo.index > 0) {
          inner = ''; // will be rendered as part of album by first item
        } else if (albumInfo && albumInfo.total > 1) {
          // Render full album grid
          var cols = albumInfo.total === 2 ? 2 : 3;
          inner += '<div class="media-album cols-' + cols + '">';
          albumInfo.ids.forEach(function (aid) {
            var am = CHAT_messages.find(function (x) { return x.id === aid; });
            if (!am || !am.media_url) return;
            var aIsVid = /\.(mp4|webm|mov)$/i.test(am.media_key || '');
            inner += '<div class="media-album-item" onclick="_openMediaViewer(\'' + aid + '\')">' +
              (aIsVid
                ? '<video src="' + am.media_url + '" preload="metadata" playsinline></video>' +
                  '<div class="media-album-play"><div style="width:28px;height:28px;border-radius:50%;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center"><svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></div></div>'
                : '<img src="' + am.media_url + '" loading="lazy">') +
            '</div>';
          });
          inner += '</div>';
        } else {
          inner += '<div class="video-bubble-wrap" onclick="_openMediaViewer(\'' + m.id + '\')">' +
            '<video src="' + m.media_url + '" preload="metadata" playsinline></video>' +
            '<div class="video-bubble-play"><div class="video-bubble-play-btn"><svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></div></div>' +
          '</div>';
        }
      } else {
        inner += '<img src="' + m.media_url + '" onerror="this.style.display=&#39;none&#39;" style="max-width:260px;border-radius:10px;display:block;cursor:pointer;width:100%;aspect-ratio:4/5;object-fit:cover;background:#000" loading="lazy" onclick="_openMediaViewer(\'' + m.id + '\')">';
      }
      if (m.text && m.text !== '__once__') {
        var capRTL = /[\u0590-\u05FF]/.test(m.text);
        inner += '<div style="margin-top:.35rem;font-size:.88rem;unicode-bidi:plaintext;' + (capRTL ? 'direction:rtl;text-align:right' : '') + '">' + _linkify(escHtml(m.text), isMe) + '</div>';
      }

    } else if (m.type === 'file' && m.media_url) {
      var fk = (m.media_key || m.media_url || '').toLowerCase();
      var fname = escHtml(m.text || 'File');
      var isAudioFile = /\.(mp3|m4a|aac|ogg|wav|flac|opus)$/i.test(fk);
      if (isAudioFile) {
        // Telegram/WhatsApp-style music card: round play/pause, title, artist •
        // duration, and a thin progress bar that fills during playback.
        var titleClean = fname.replace(/\.(mp3|m4a|aac|ogg|wav|flac|opus)$/i, '');
        inner += '<div class="music-card">' +
          '<audio id="maud-' + m.id + '" src="' + m.media_url + '" preload="metadata" onloadedmetadata="var t=document.getElementById(\'mtime-' + m.id + '\');if(t&&isFinite(this.duration))t.textContent=_fmtClock(this.duration)"></audio>' +
          '<button class="music-play" id="mplay-' + m.id + '" onclick="_playMusicFile(\'' + m.id + '\',this)">' + ICON_PLAY_SM + '</button>' +
          '<div class="music-info">' +
            '<div class="music-title" dir="auto">' + titleClean + '</div>' +
            '<div class="music-prog" id="mprog-' + m.id + '" onclick="_seekMusic(event,\'' + m.id + '\')"><div class="music-prog-fill" id="mfill-' + m.id + '"></div></div>' +
            '<div class="music-sub"><span id="mtime-' + m.id + '">' + '0:00' + '</span><span class="music-badge">🎵 Audio</span></div>' +
          '</div>' +
        '</div>';
      } else {
        var ficon = /\.pdf$/i.test(fk) ? '📕' : /\.(zip|rar|7z)$/i.test(fk) ? '🗜️' : /\.(doc|docx)$/i.test(fk) ? '📘' : /\.(xls|xlsx|csv)$/i.test(fk) ? '📊' : /\.(ppt|pptx)$/i.test(fk) ? '📙' : '📄';
        inner += '<a href="' + m.media_url + '" target="_blank" download style="display:flex;align-items:center;gap:.6rem;text-decoration:none;color:inherit;min-width:180px">' +
          '<div style="font-size:2rem;flex-shrink:0">' + ficon + '</div>' +
          '<div style="min-width:0"><div style="font-size:.83rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px" dir="auto">' + fname + '</div>' +
          '<div style="font-size:.68rem;opacity:.65;margin-top:.1rem">Tap to download</div></div>' +
        '</a>';
      }

    } else if (m.type === 'text' || !m.type) {
      // Text — detect links, auto-detect RTL for Hebrew/Yiddish
      var isRTL = /[\u0590-\u05FF\uFB1D-\uFB4F]/.test(m.text || '');
      var txtStyle = 'unicode-bidi:plaintext;display:block;word-break:break-word;overflow-wrap:anywhere;' + (isRTL ? 'direction:rtl;text-align:right' : '');
      var filteredTxt = (typeof filterContent === 'function') ? filterContent(_linkify(escHtml(m.text || ''), isMe)) : _linkify(escHtml(m.text || ''), isMe);
      if (isChannel) {
        inner += '<div class="ch-text" style="' + txtStyle + '">' + filteredTxt + '</div>';
      } else {
        inner += '<span style="' + txtStyle + '">' + filteredTxt + '</span>';
      }
      // Link preview — detect join links + regular OG previews
      var urlMatch = (m.text || '').match(/(https?:\/\/[^\s]+)/);
      if (urlMatch) {
        var joinCode = _detectJoinLink(urlMatch[1]);
        if (joinCode) {
          inner += '<div id="lp-' + m.id + '" style="margin-top:.4rem"></div>';
          setTimeout(function () { _loadJoinLinkPreview(m.id, joinCode); }, 100);
        } else {
          inner += '<div class="link-preview" id="lp-' + m.id + '" style="display:none;margin-top:.5rem;border-radius:12px;overflow:hidden;border:1.5px solid ' + (isMe ? 'rgba(255,255,255,.25)' : 'var(--border)') + ';cursor:pointer;max-width:280px"></div>';
        }
      }
    }

    if (m.reply_count) {
      inner += '<div class="reply-thread-pill" onclick="openReplyThread(\'' + m.id + '\')" style="display:flex;align-items:center;gap:.3rem;margin-top:.35rem;padding:.25rem .55rem;background:rgba(31,111,92,.1);border-radius:10px;cursor:pointer;width:fit-content;font-size:.72rem;color:var(--blue);font-weight:600">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>' +
        m.reply_count + (m.reply_count === 1 ? ' reply' : ' replies') +
      '</div>';
    }

    inner += '<div class="bubble-meta">' + (m.edited_at ? '<span class="edited-tag">edited</span>' : '') + '<span class="bubble-time">' + time + '</span>' + ticks + '</div>';

    var myReaction = CHAT_reactions[m.id] && CHAT_reactions[m.id].my_reaction;
    var reactionCounts = (CHAT_reactions[m.id] && CHAT_reactions[m.id].counts) || {};
    var reactionPills = Object.keys(reactionCounts).map(function (emo) {
      return '<span class="reaction-pill' + (emo === myReaction ? ' mine' : '') + '" onclick="event.stopPropagation();toggleReaction(\'' + m.id + '\',\'' + emo + '\')">' + emo + ' ' + reactionCounts[emo] + '</span>';
    }).join('');
    var reactionRow = reactionPills ? '<div class="reaction-row">' + reactionPills + '</div>' : '';

    // ── CHANNEL style (Telegram channel look) ──
    if (isChannel) {
      var selectClass = CHAT_selected[m.id] ? ' msg-selected' : '';
      var viewCnt = m.view_count || 0;
      var shareBtn = '<button class="ch-share-btn" onclick="event.stopPropagation();_shareMsg(\'' + m.id + '\')">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>' +
      '</button>';
      var metaOverlay = '<div class="ch-meta">' +
        (viewCnt ? '<span class="ch-views"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> ' + fmtN(viewCnt) + '</span>' : '') +
        '<span class="ch-time">' + time + '</span>' +
        shareBtn +
      '</div>';
      return dateSep +
        '<div class="ch-post' + selectClass + '" id="msg-' + m.id + '" data-id="' + m.id + '"' +
          ' onclick="_toggleSelect(\'' + m.id + '\')"' +
          ' oncontextmenu="event.preventDefault();showCtx(event,\'' + m.id + '\')"' +
          ' ontouchstart="_ctxTouchStart(event,\'' + m.id + '\')" ontouchend="_ctxClear()" ontouchmove="_ctxClear()">' +
          inner +
          metaOverlay +
          (reactionPills ? '<div class="reaction-row ch-reactions">' + reactionPills + '</div>' : '') +
        '</div>';
    }

    // ── NORMAL (group/DM) style ──
    var miniAv = (!isMe && isGroup)
      ? '<div class="msg-mini-av" style="background:' + avatarColor(m.sender_id || m.sender_nick) + (m.sender_photo ? ';background-image:url(' + m.sender_photo + ');background-size:cover;background-position:center' : '') + '">' + escHtml((m.sender_nick || '?').slice(0, 1).toUpperCase()) + '</div>'
      : '';

    var selectClass2 = CHAT_selected[m.id] ? ' msg-selected' : '';

    return dateSep +
      '<div class="msg-wrap' + (isMe ? ' me' : '') + selectClass2 + '" id="msg-' + m.id + '" data-id="' + m.id + '"' +
        ' onclick="_toggleSelect(\'' + m.id + '\')"' +
        ' oncontextmenu="event.preventDefault();showCtx(event,\'' + m.id + '\')">' +
        miniAv +
        '<div style="display:flex;flex-direction:column;' + (isMe ? 'align-items:flex-end' : 'align-items:flex-start') + '">' +
          '<div class="' + bubbleClass + '" data-msg-id="' + m.id + '">' +
            inner +
            '<div class="swipe-reply-icon ' + (isMe ? 'sri-me' : 'sri-them') + '"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg></div>' +
          '</div>' +
          reactionRow +
        '</div>' +
      '</div>';
  });

  // Build per-message units (id + change-signature + html) and reconcile them
  // against the DOM so we only touch what actually changed — no full rebuild,
  // no flicker, no scroll jump (the WhatsApp/Telegram feel).
  var units = CHAT_messages.map(function (m, i) {
    return { id: String(m.id), sig: _msgSig(m), html: _htmlArr[i] };
  });
  _reconcileMessages(cont, units, scrollDown);
}

// A compact fingerprint of everything that affects how a message renders. If it
// is unchanged, the node is left completely untouched.
function _msgSig(m) {
  return [
    m.id, m.type || 't', (m.text || '').length, m.media_url ? 1 : 0,
    m.read ? 1 : 0, m.edited ? 1 : 0, m.opened ? 1 : 0, m.pinned ? 1 : 0,
    m.seen_count || 0, m.expires_at || '',
    m.reactions ? JSON.stringify(m.reactions) : '',
    m.reply_to ? (m.reply_to.id || m.reply_to) : '',
    m.reply_count || 0, m._scheduled_pending ? 1 : 0
  ].join('~');
}

function _reconcileMessages(cont, units, scrollDown) {
  var inner = cont.querySelector('.chat-msgs-inner');
  var firstRender = !inner;
  if (firstRender) {
    cont.innerHTML = '<div class="chat-msgs-inner"></div>';
    inner = cont.querySelector('.chat-msgs-inner');
  }

  var wasAtBottom = (cont.scrollTop + cont.clientHeight >= cont.scrollHeight - 60);

  // Index existing message nodes by id.
  var existing = {};
  Array.prototype.forEach.call(inner.children, function (ch) {
    if (ch.dataset && ch.dataset.id) existing[ch.dataset.id] = ch;
  });

  // Remove nodes whose message is gone.
  var wanted = {};
  units.forEach(function (u) { wanted[u.id] = 1; });
  Array.prototype.slice.call(inner.children).forEach(function (ch) {
    if (ch.dataset.id && !wanted[ch.dataset.id]) inner.removeChild(ch);
  });

  // Insert / update / reorder in the desired order.
  var cursor = inner.firstChild;
  units.forEach(function (u) {
    var node = existing[u.id];
    if (node) {
      if (node.dataset.sig !== u.sig) {
        node.innerHTML = u.html;
        node.dataset.sig = u.sig;
      }
      if (cursor !== node) inner.insertBefore(node, cursor);
      cursor = node.nextSibling;
    } else {
      var el = document.createElement('div');
      el.className = 'msg-unit';
      el.dataset.id = u.id;
      el.dataset.sig = u.sig;
      el.innerHTML = u.html;
      inner.insertBefore(el, cursor);
    }
  });

  // Scroll: jump to bottom only if asked or the user was already there;
  // otherwise leave the view exactly where it is (new messages append below).
  if (scrollDown || wasAtBottom) {
    cont.scrollTop = cont.scrollHeight;
    CHAT_atBottom = true;
    CHAT_unreadNew = 0;
    var arrow = document.getElementById('new-arrow');
    if (arrow) arrow.classList.remove('show');
  }

  _attachMessageGestures(cont);
}

// Swipe-right-to-reply + long-press-to-context-menu, both on the same bubble.
// Telegram pattern: a horizontal drag past ~50px triggers reply on release;
// a stationary hold past ~500ms opens the context menu instead.
function _attachMessageGestures(cont) {
  cont.querySelectorAll('.bubble[data-msg-id]').forEach(function (bubble) {
    if (bubble.dataset.gbound) return; // already wired (incremental render keeps nodes)
    bubble.dataset.gbound = '1';
    var msgId = bubble.dataset.msgId;
    var startX = 0, startY = 0, dragging = false, longPressTimer = null, moved = false;

    bubble.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      dragging = true;
      moved = false;
      longPressTimer = setTimeout(function () {
        if (!moved) showQuickReact(t, msgId);
      }, 500);
    }, { passive: true });

    bubble.addEventListener('touchmove', function (e) {
      if (!dragging) return;
      var t = e.touches[0];
      var dx = t.clientX - startX;
      var dy = t.clientY - startY;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        moved = true;
        clearTimeout(longPressTimer);
      }
      // If the user is selecting text, let the native selection happen — don't
      // hijack the drag for swipe-reply.
      if (window.getSelection && String(window.getSelection()).length > 0) return;
      // Only allow rightward swipe (reply gesture), clamp the drag distance.
      if (dx > 0 && Math.abs(dy) < 40) {
        var clamped = Math.min(dx, 70);
        bubble.style.transform = 'translateX(' + clamped + 'px)';
        var icon = bubble.querySelector('.swipe-reply-icon');
        if (icon) icon.style.opacity = Math.min(1, clamped / 50);
      }
    }, { passive: true });

    bubble.addEventListener('touchend', function (e) {
      clearTimeout(longPressTimer);
      dragging = false;
      var transform = bubble.style.transform;
      var dx = 0;
      var match = transform.match(/translateX\(([\d.]+)px\)/);
      if (match) dx = parseFloat(match[1]);

      bubble.style.transition = 'transform .2s ease';
      bubble.style.transform = 'translateX(0)';
      setTimeout(function () { bubble.style.transition = ''; }, 220);
      var icon = bubble.querySelector('.swipe-reply-icon');
      if (icon) icon.style.opacity = '0';

      if (dx > 45) {
        if (window.getSelection && String(window.getSelection()).length > 0) return;
        var msg = CHAT_messages.find(function (m) { return m.id === msgId; });
        if (msg) _setReply(msg);
      }
    });

    // A touch can be cancelled mid-swipe (scroll takeover, incoming call,
    // notification, etc.) — without this, touchend never fires and the
    // bubble is left stuck shifted sideways, which reads as "shaking" or
    // flickering the next time the list re-renders.
    bubble.addEventListener('touchcancel', function () {
      clearTimeout(longPressTimer);
      dragging = false;
      bubble.style.transition = 'transform .2s ease';
      bubble.style.transform = 'translateX(0)';
      setTimeout(function () { bubble.style.transition = ''; }, 220);
      var icon = bubble.querySelector('.swipe-reply-icon');
      if (icon) icon.style.opacity = '0';
    });
  });
}

// Track scroll position
function _onMsgsScroll() {
  var cont = document.getElementById('chat-msgs');
  if (!cont) return;
  CHAT_atBottom = (cont.scrollTop + cont.clientHeight >= cont.scrollHeight - 50);
  var arrow = document.getElementById('new-arrow');
  if (!arrow) return;
  if (CHAT_atBottom) {
    CHAT_unreadNew = 0;
    arrow.classList.remove('show');
  } else {
    arrow.classList.add('show');
    var badge = document.getElementById('new-count');
    if (badge) {
      if (CHAT_unreadNew > 0) {
        badge.textContent = CHAT_unreadNew;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    }
  }
}

window.scrollToBottom = function () {
  var cont = document.getElementById('chat-msgs');
  if (cont) { cont.scrollTop = cont.scrollHeight; CHAT_atBottom = true; }
  CHAT_unreadNew = 0;
  var arrow = document.getElementById('new-arrow');
  if (arrow) arrow.classList.remove('show');
};

window.scrollToMsg = function (id) {
  var el = document.getElementById('msg-' + id);
  if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.background = 'rgba(201,168,76,.15)'; setTimeout(function () { el.style.background = ''; }, 1200); }
};

// ============================================================
// SEARCH WITHIN THE CURRENTLY OPEN CHAT
// ============================================================
var _inChatSearchResults = [];
var _inChatSearchIdx = -1;

// Used by global search results: open the room, then once its messages
// have loaded, scroll to and highlight the specific matched message.
window._openChatRoomAtMsg = function (roomId, msgId) {
  openChatRoom(roomId);
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    var el = document.getElementById('msg-' + msgId);
    if (el || tries > 20) {
      clearInterval(timer);
      if (el) scrollToMsg(msgId);
    }
  }, 150);
};

window.openInChatSearch = function () {
  var bar = document.getElementById('in-chat-search-bar');
  if (!bar) return;
  bar.style.display = 'flex';
  var inp = document.getElementById('in-chat-search-inp');
  inp.value = '';
  document.getElementById('in-chat-search-count').textContent = '';
  _inChatSearchResults = [];
  _inChatSearchIdx = -1;
  setTimeout(function () { inp.focus(); }, 50);
};

window.closeInChatSearch = function () {
  var bar = document.getElementById('in-chat-search-bar');
  if (bar) bar.style.display = 'none';
  _inChatSearchResults = [];
  _inChatSearchIdx = -1;
};

window.doInChatSearch = function () {
  var q = (document.getElementById('in-chat-search-inp') || {}).value || '';
  q = q.trim().toLowerCase();
  var countEl = document.getElementById('in-chat-search-count');
  if (q.length < 1) {
    _inChatSearchResults = [];
    _inChatSearchIdx = -1;
    if (countEl) countEl.textContent = '';
    return;
  }
  _inChatSearchResults = CHAT_messages.filter(function (m) {
    return m.text && m.text.toLowerCase().indexOf(q) !== -1;
  });
  _inChatSearchIdx = _inChatSearchResults.length ? _inChatSearchResults.length - 1 : -1;
  if (countEl) countEl.textContent = _inChatSearchResults.length
    ? (_inChatSearchIdx + 1) + ' / ' + _inChatSearchResults.length
    : 'No results';
  if (_inChatSearchIdx >= 0) scrollToMsg(_inChatSearchResults[_inChatSearchIdx].id);
};

// dir: -1 = older/previous match, 1 = newer/next match
window.inChatSearchNav = function (dir) {
  if (!_inChatSearchResults.length) return;
  _inChatSearchIdx -= dir; // messages are stored oldest→newest; "next" moves toward newest
  if (_inChatSearchIdx < 0) _inChatSearchIdx = _inChatSearchResults.length - 1;
  if (_inChatSearchIdx >= _inChatSearchResults.length) _inChatSearchIdx = 0;
  var countEl = document.getElementById('in-chat-search-count');
  if (countEl) countEl.textContent = (_inChatSearchIdx + 1) + ' / ' + _inChatSearchResults.length;
  scrollToMsg(_inChatSearchResults[_inChatSearchIdx].id);
};

// ============================================================
// SEND TEXT MESSAGE
// ============================================================
window.onChatType = function () {
  var inp = document.getElementById('chat-input');
  inp.style.height = 'auto';
  inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';
  var val = inp.value || '';
  var has = val.trim().length > 0;
  document.getElementById('chat-send-btn').style.display  = has ? 'flex' : 'none';
  document.getElementById('voice-rec-btn').style.display  = has ? 'none' : 'flex';
  document.getElementById('attach-sheet').classList.remove('open');

  // Check for bad words while typing
  if (has && typeof checkInputForBadWords === 'function') checkInputForBadWords(val);

  // Auto RTL detection — switch direction when typing Hebrew/Yiddish
  var isRTL = /[\u0590-\u05FF\uFB1D-\uFB4F]/.test(val);
  inp.style.direction  = isRTL ? 'rtl' : 'ltr';
  inp.style.textAlign  = isRTL ? 'right' : 'left';

  // Broadcast "I'm typing" to the server, throttled to once per 2s
  if (has && CHAT_curRoom && !CHAT_typingThrottled) {
    CHAT_typingThrottled = true;
    api.post('/chat/typing', { room_id: CHAT_curRoom.id }).catch(function () {});
    setTimeout(function () { CHAT_typingThrottled = false; }, 2000);
  }

  clearTimeout(CHAT_typingTimer);
  CHAT_typingTimer = setTimeout(function () {}, 2000);
};
var CHAT_typingTimer = null;
var CHAT_typingThrottled = false;
var CHAT_typingPollInterval = null;

// Poll every 2s for "who's typing" in the currently-open room.
function _startTypingPoll() {
  clearInterval(CHAT_typingPollInterval);
  CHAT_typingPollInterval = setInterval(function () {
    if (!CHAT_curRoom) return;
    if (document.hidden) return;
    api.get('/chat/typing?room_id=' + encodeURIComponent(CHAT_curRoom.id))
      .then(function (res) { _renderTypingBar(res.typing || []); })
      .catch(function () {});
  }, 2000);
}
function _stopTypingPoll() {
  clearInterval(CHAT_typingPollInterval);
  CHAT_typingPollInterval = null;
  _renderTypingBar([]);
}

function _renderTypingBar(typingUsers) {
  var bar = document.getElementById('typing-bar');
  var label = document.getElementById('typing-label');
  if (!bar || !label) return;

  if (!typingUsers.length) {
    bar.style.display = 'none';
    return;
  }

  var names = typingUsers.map(function (t) { return t.user_nick || 'Someone'; });
  var text;
  if (names.length === 1) text = names[0] + ' is typing...';
  else if (names.length === 2) text = names[0] + ' and ' + names[1] + ' are typing...';
  else text = names.length + ' people are typing...';

  label.textContent = text;
  bar.style.display = 'flex';
}

window.onChatKey = function (e) {
  if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); sendChatMsg(); }
  // Enter alone = new line (default behavior — do nothing)
};

window.sendChatMsg = function () {
  var inp  = document.getElementById('chat-input');
  var text = (inp.value || '').trim();
  if (!text || !CHAT_curRoom) return;
  if (!CHAT_curRoom.joined && CHAT_curRoom.type === 'group') return;

  var payload = { room_id: CHAT_curRoom.id, type: 'text', text: text };
  if (CHAT_replyTo) payload.reply_to_id = CHAT_replyTo.id;
  if (CHAT_curTopicId) payload.topic_id = CHAT_curTopicId;
  if (CHAT_scheduleFor) payload.scheduled_for = CHAT_scheduleFor;
  if (CHAT_disappearSecs) payload.disappear_seconds = CHAT_disappearSecs;

  var wasScheduled = !!CHAT_scheduleFor;

  // Clear input immediately (feels instant)
  var msgText = text;
  inp.value = '';
  inp.style.height = 'auto';
  document.getElementById('chat-send-btn').style.display = 'none';
  document.getElementById('voice-rec-btn').style.display = 'flex';
  _cancelReply();

  // Optimistic render: show message immediately before server confirms
  var tempId = 'tmp-' + Date.now();
  var me = STATE.user || {};
  var now = new Date().toISOString();
  var tempMsg = {
    id: tempId, room_id: CHAT_curRoom ? CHAT_curRoom.id : '',
    sender_id: me.id, sender_nick: me.nickname || '',
    type: 'text', text: msgText, created_at: now, read: 0,
    _pending: true,
  };
  CHAT_messages.push(tempMsg);
  renderMessages(false);
  scrollToBottom();

  api.post('/chat', payload)
    .then(function () {
      if (wasScheduled) {
        toast('🕓 Message scheduled');
        CHAT_messages = CHAT_messages.filter(function(m){ return m.id !== tempId; });
      }
      _resetMsgOptions();
      loadMessages(true); // get real message from server
    })
    .catch(function (err) {
      toast('❌ ' + err.message);
      inp.value = msgText; // restore text if failed
      CHAT_messages = CHAT_messages.filter(function(m){ return m.id !== tempId; });
      _resetMsgOptions();
      renderMessages(false);
    });
};

// ============================================================
// JOIN GROUP
// ============================================================
window.joinGroup = function () {
  if (!CHAT_curRoom) return;
  api.post('/chat/join', { room_id: CHAT_curRoom.id })
    .then(function () {
      CHAT_curRoom.joined = true;
      document.getElementById('join-banner').style.display = 'none';
      document.getElementById('chat-input-bar').style.opacity = '1';
      document.getElementById('chat-input-bar').style.pointerEvents = 'all';
      toast('✅ Joined ' + CHAT_curRoom.nick + '!');
      loadChatRooms();
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

// ============================================================
// VOICE NOTES (MediaRecorder + real waveform analysis)
// ============================================================
var CHAT_recPeaks    = [];
var CHAT_recAnalyser = null;
var CHAT_recRaf      = null;

window.toggleVoiceRec = function () {
  if (CHAT_isRecording) {
    if (CHAT_mediaRec && CHAT_mediaRec.state !== 'inactive') CHAT_mediaRec.stop();
  } else {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return toast('⚠ Microphone not available in this browser.');
    }
    navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then(function (stream) {
        CHAT_recChunks = [];
        CHAT_recPeaks  = [];
        CHAT_recStart  = Date.now();
        CHAT_isRecording = true;
        CHAT_recCancelled = false;
        CHAT_recLocked = false;
        var btn = document.getElementById('voice-rec-btn');
        if (btn) { btn.textContent = '⏹️'; btn.classList.add('rec'); }
        _showRecordingBar();

        try {
          var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          var source = audioCtx.createMediaStreamSource(stream);
          CHAT_recAnalyser = audioCtx.createAnalyser();
          CHAT_recAnalyser.fftSize = 256;
          source.connect(CHAT_recAnalyser);
          var dataArr = new Uint8Array(CHAT_recAnalyser.frequencyBinCount);

          function sampleLevel() {
            if (!CHAT_isRecording) return;
            CHAT_recAnalyser.getByteFrequencyData(dataArr);
            var sum = 0;
            for (var i = 0; i < dataArr.length; i++) sum += dataArr[i];
            var avg = sum / dataArr.length / 255;
            CHAT_recPeaks.push(avg);
            _updateRecordingBar(avg);
            CHAT_recRaf = requestAnimationFrame(sampleLevel);
          }
          sampleLevel();
        } catch (e) {
          console.warn('[chat] waveform analysis unavailable:', e.message);
        }

        // Pick best supported audio format; prefer explicit codecs so the file
        // decodes at the right speed on Android (bare audio/webm can misbehave).
        var mimeType = 'audio/webm;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          if (MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm';
          else if (MediaRecorder.isTypeSupported('audio/mp4;codecs=mp4a.40.2')) mimeType = 'audio/mp4;codecs=mp4a.40.2';
          else if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
          else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) mimeType = 'audio/ogg;codecs=opus';
          else mimeType = '';
        }
        var ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';

        CHAT_mediaRec = mimeType ? new MediaRecorder(stream, { mimeType: mimeType }) : new MediaRecorder(stream);
        CHAT_mediaRec.ondataavailable = function (e) { if (e.data.size > 0) CHAT_recChunks.push(e.data); };
        CHAT_mediaRec.onstop = function () {
          CHAT_isRecording = false;
          cancelAnimationFrame(CHAT_recRaf);
          _hideRecordingBar();
          var btn2 = document.getElementById('voice-rec-btn');
          if (btn2) { btn2.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>'; btn2.classList.remove('rec'); }
          stream.getTracks().forEach(function (t) { t.stop(); });

          if (CHAT_recCancelled) {
            toast('🗑 Recording discarded');
            return;
          }

          var dur  = Math.round((Date.now() - CHAT_recStart) / 1000);
          var durStr = Math.floor(dur / 60) + ':' + String(dur % 60).padStart(2, '0');

          var peaks = _downsamplePeaks(CHAT_recPeaks, 40);
          var packed = durStr + '|' + peaks.map(function (p) { return Math.round(p * 100); }).join(',');

          var blob = new Blob(CHAT_recChunks, { type: mimeType });
          var file = new File([blob], 'voice_' + Date.now() + '.' + ext, { type: mimeType });

          // Show the voice note immediately (local blob), swap for the server copy on success.
          var _vTmp = 'tmp-' + Date.now();
          var _vUrl = URL.createObjectURL(blob);
          var _vMe = STATE.user || {};
          if (CHAT_curRoom) {
            CHAT_messages.push({
              id: _vTmp, room_id: CHAT_curRoom.id, sender_id: _vMe.id, sender_nick: _vMe.nickname || '',
              type: 'voice', text: packed, media_url: _vUrl, created_at: new Date().toISOString(), read: 0, _pending: true
            });
            renderMessages(false); scrollToBottom();
          }

          var form = new FormData();
          form.append('room_id', CHAT_curRoom.id);
          form.append('type', 'voice');
          form.append('text', packed);
          form.append('file', file);
          api.post('/chat', form, true)
            .then(function () {
              CHAT_messages = CHAT_messages.filter(function (m) { return m.id !== _vTmp; });
              try { URL.revokeObjectURL(_vUrl); } catch (e) {}
              loadMessages(true); loadChatRooms();
            })
            .catch(function (err) {
              toast('❌ ' + err.message);
              CHAT_messages = CHAT_messages.filter(function (m) { return m.id !== _vTmp; });
              renderMessages(false);
            });
        };
        CHAT_mediaRec.start(250); // collect data every 250ms — prevents cutoff on long recordings
      })
      .catch(function (err) {
        var msg = '⚠ Microphone access denied.';
        if (err && err.name === 'NotAllowedError') {
          msg = '🎙️ Please allow microphone in your browser settings, then try again.';
        } else if (err && err.name === 'NotFoundError') {
          msg = '🎙️ No microphone found on this device.';
        }
        toast(msg);
      });
  }
};
window.startVoiceRec = window.toggleVoiceRec;

// ── Slide-to-Lock / Slide-to-Cancel gesture (drag the mic button) ──
var CHAT_recCancelled  = false;
var CHAT_recLocked     = false;
var CHAT_micStartX     = 0;
var CHAT_micStartY     = 0;
var CHAT_micDragActive = false;

window._micTouchStart = function (e) {
  var t = e.touches[0];
  CHAT_micStartX = t.clientX;
  CHAT_micStartY = t.clientY;
  CHAT_micDragActive = true;
  // Begin recording immediately on press (Telegram/WhatsApp behavior),
  // unless there's already text in the input (send button takes over instead).
  var inp = document.getElementById('chat-input');
  if (inp && (inp.value || '').trim().length > 0) { CHAT_micDragActive = false; return; }
  if (!CHAT_isRecording) toggleVoiceRec();
};

window._micTouchMove = function (e) {
  if (!CHAT_micDragActive || !CHAT_isRecording || CHAT_recLocked) return;
  var t = e.touches[0];
  var dx = t.clientX - CHAT_micStartX;
  var dy = t.clientY - CHAT_micStartY;

  // Sliding LEFT past threshold → cancel
  var hint = document.getElementById('rec-live-hint');
  if (dx < -80) {
    if (hint) hint.textContent = '🗑 Release to cancel';
    CHAT_recPendingCancel = true;
  } else {
    if (hint) hint.textContent = '← slide to cancel';
    CHAT_recPendingCancel = false;
  }

  // Sliding UP past threshold → lock (hands-free recording)
  var lockIcon = document.getElementById('rec-lock-icon');
  if (dy < -60) {
    _lockVoiceRecording();
  } else if (lockIcon) {
    lockIcon.style.transform = 'translateY(' + Math.max(dy, -60) + 'px)';
  }
};

window._micTouchEnd = function (e) {
  if (!CHAT_micDragActive) return;
  CHAT_micDragActive = false;

  if (CHAT_recLocked) {
    // Locked — recording continues hands-free, user must tap send/cancel buttons.
    return;
  }
  if (!CHAT_isRecording) return;

  if (CHAT_recPendingCancel) {
    cancelVoiceRec();
  } else {
    toggleVoiceRec(); // stop + send
  }
  CHAT_recPendingCancel = false;
};
var CHAT_recPendingCancel = false;

function _lockVoiceRecording() {
  CHAT_recLocked = true;
  var lockIndicator = document.getElementById('rec-lock-indicator');
  if (lockIndicator) lockIndicator.style.display = 'none';
  var hint = document.getElementById('rec-live-hint');
  if (hint) hint.style.display = 'none';
  var sendBtn = document.getElementById('rec-locked-send-btn');
  var cancelBtn = document.getElementById('rec-locked-cancel-btn');
  if (sendBtn) sendBtn.style.display = 'flex';
  if (cancelBtn) cancelBtn.style.display = 'block';
  toast('🔒 Recording locked — hands-free');
}

window.stopVoiceRecAndSend = function () {
  CHAT_recCancelled = false;
  if (CHAT_mediaRec && CHAT_mediaRec.state !== 'inactive') CHAT_mediaRec.stop();
};

window.cancelVoiceRec = function () {
  CHAT_recCancelled = true;
  if (CHAT_mediaRec && CHAT_mediaRec.state !== 'inactive') CHAT_mediaRec.stop();
};

// ── Recording bar waveform bars ──
var REC_BAR_COUNT = 40;
function _buildRecWaveform() {
  var meter = document.getElementById('rec-live-meter');
  if (!meter) return;
  meter.innerHTML = '';
  for (var i = 0; i < REC_BAR_COUNT; i++) {
    var b = document.createElement('div');
    b.className = 'rec-waveform-bar';
    b.style.height = '4px';
    meter.appendChild(b);
  }
}

function _showRecordingBar() {
  _buildRecWaveform();
  var bar = document.getElementById('rec-live-bar');
  if (bar) bar.classList.add('show');
  var lockIndicator = document.getElementById('rec-lock-indicator');
  if (lockIndicator) lockIndicator.classList.add('show');
  var hint = document.getElementById('rec-live-hint');
  if (hint) { hint.style.display = 'block'; hint.textContent = '← slide to cancel'; }
  var sendBtn = document.getElementById('rec-locked-send-btn');
  var cancelBtn = document.getElementById('rec-locked-cancel-btn');
  if (sendBtn) sendBtn.style.display = 'none';
  if (cancelBtn) cancelBtn.style.display = 'none';
}

function _hideRecordingBar() {
  var bar = document.getElementById('rec-live-bar');
  if (bar) bar.classList.remove('show');
  var lockIndicator = document.getElementById('rec-lock-indicator');
  if (lockIndicator) lockIndicator.classList.remove('show');
  var lockIcon = document.getElementById('rec-lock-icon');
  if (lockIcon) lockIcon.style.transform = 'translateY(0)';
}

// Shift bars left and add new one — like Telegram live waveform
var _recBarVals = new Array(REC_BAR_COUNT).fill(0.05);
function _updateRecordingBar(level) {
  _recBarVals.shift();
  _recBarVals.push(Math.max(0.04, level));
  var meter = document.getElementById('rec-live-meter');
  if (meter) {
    var bars = meter.querySelectorAll('.rec-waveform-bar');
    for (var i = 0; i < bars.length; i++) {
      bars[i].style.height = Math.max(3, Math.round(_recBarVals[i] * 28)) + 'px';
      bars[i].style.opacity = 0.4 + _recBarVals[i] * 1.5;
    }
  }
  var timeEl = document.getElementById('rec-live-time');
  if (timeEl) {
    var elapsed = Math.round((Date.now() - CHAT_recStart) / 1000);
    timeEl.textContent = Math.floor(elapsed / 60) + ':' + String(elapsed % 60).padStart(2, '0');
  }
}

function _downsamplePeaks(peaks, n) {
  if (!peaks.length) return new Array(n).fill(0.1);
  var out = [];
  var step = peaks.length / n;
  for (var i = 0; i < n; i++) {
    var start = Math.floor(i * step);
    var end = Math.floor((i + 1) * step) || start + 1;
    var slice = peaks.slice(start, end);
    var avg = slice.reduce(function (a, b) { return a + b; }, 0) / (slice.length || 1);
    out.push(Math.max(0.08, avg));
  }
  return out;
}

function _parseVoicePacked(text) {
  if (!text) return { dur: '0:00', peaks: [] };
  var parts = text.split('|');
  var dur = parts[0] || '0:00';
  var peaks = parts[1] ? parts[1].split(',').map(function (p) { return parseInt(p, 10) / 100; }) : [];
  return { dur: dur, peaks: peaks };
}

// ============================================================
// STICKERS
// ============================================================
// Stickers replaced by full emoji panel

var EMOJI_RECENT = JSON.parse(localStorage.getItem('yp_emoji_recent') || '[]');

// Animated sticker URLs (Tenor/Giphy CDN public GIFs — Jewish/fun themed)
// Stickers use Google Noto Animated Emoji (reliable, always available)
var STICKER_BASE = 'https://fonts.gstatic.com/s/e/notoemoji/latest/';
var STICKER_PACKS = [
  { id:'s1',  url: STICKER_BASE + '1f600/512.gif', label:'😀 Grinning' },
  { id:'s2',  url: STICKER_BASE + '1f602/512.gif', label:'😂 LOL' },
  { id:'s3',  url: STICKER_BASE + '1f60d/512.gif', label:'😍 Love' },
  { id:'s4',  url: STICKER_BASE + '1f62d/512.gif', label:'😭 Cry' },
  { id:'s5',  url: STICKER_BASE + '1f621/512.gif', label:'😡 Angry' },
  { id:'s6',  url: STICKER_BASE + '1f973/512.gif', label:'🥳 Party' },
  { id:'s7',  url: STICKER_BASE + '1f44f/512.gif', label:'👏 Clap' },
  { id:'s8',  url: STICKER_BASE + '1f525/512.gif', label:'🔥 Fire' },
  { id:'s9',  url: STICKER_BASE + '2764_fe0f/512.gif', label:'❤️ Heart' },
  { id:'s10', url: STICKER_BASE + '1f64f/512.gif', label:'🙏 Pray' },
  { id:'s11', url: STICKER_BASE + '1f44d/512.gif', label:'👍 Thumbs Up' },
  { id:'s12', url: STICKER_BASE + '1f914/512.gif', label:'🤔 Thinking' },
  { id:'s13', url: STICKER_BASE + '1f389/512.gif', label:'🎉 Party Popper' },
  { id:'s14', url: STICKER_BASE + '1f48b/512.gif', label:'💋 Kiss' },
  { id:'s15', url: STICKER_BASE + '1f499/512.gif', label:'💙 Blue Heart' },
  { id:'s16', url: STICKER_BASE + '2728/512.gif',  label:'✨ Sparkles' },
];

var EMOJI_CATS = {
  recent:   function() { return EMOJI_RECENT.length ? EMOJI_RECENT : ['😊','❤️','👍','😂','🙏','🔥','✅','💯']; },
  stickers: 'stickers', // special — handled in _emojiCat
  smileys: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕'],
  people:  ['👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💪','🦾','🦵','🦶','👂','🦻','👃','🧠','🦷','🦴','👀','👁','👅','👄','💋','🧔','👦','👧','🧒','👨','👩','🧑','👴','👵','🧓'],
  animals: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦟','🦗','🕷','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🦭','🐊','🐅','🐆','🦓','🦍'],
  food:    ['🍎','🍊','🍋','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶','🫑','🧄','🧅','🥔','🌽','🥕','🫛','🧆','🥜','🫘','🍞','🥐','🥖','🫓','🥨','🥯','🧀','🍳','🥚','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🫔','🌮','🌯','🥙','🧆','🥚','🍜','🍝','🍠','🍢','🍣','🍤','🍙','🍚','🍛','🍲','🫕','🥘','🍱','🥗','🍿','🧂','🥫'],
  travel:  ['🚗','🚕','🚙','🚌','🚎','🏎','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🛵','🏍','🛺','🚲','🛴','🛹','🚁','✈️','🛸','🚀','🛶','⛵','🚤','🛥','🛳','⛴','🚢','🚞','🚂','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏭','🗼','🗽','🗺','🌋','⛰','🏔','🗻','🏕','🏖','🏜','🏝','🏞','🌅','🌄','🌠','🎇','🌁','🌃','🌆','🌇','🌉','🌌'],
  symbols: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉','✡️','🔯','🛐','🕎','☯️','☦️','✔️','❌','⭕','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔶','🔷','🔸','🔹','🔺','🔻','💠','♾','🔘','▶️','⏩','⏭','⏯','🔼','⏫','⏬','🔽','⏪','⏮','🔁','🔂','🔀','🔔','🔕','🎵','🎶','🔊','🔇'],
  jewish:  ['✡️','🕎','📜','🙏','🕍','🕌','⛪','🔯','🍷','🥂','🎺','🎵','🕯','🌟','⭐','🌙','☀️','📖','✍️','🍞','🫓','🍇','🐑','🐟','🦁','🕊','🌿','🌾','🌺','🌸','🪷','🌻','🌹','💐','🦋','🐝','🌈','⛰','🏔','🌊','🌍','💫','⚡','🌠','🎇','🙌','👑','🎉','🎊','🎁','🎈','🎗','🏆','🥇','🪬','🧿','🪷'],
};

window.toggleStickers = function () {
  var panel = document.getElementById('emoji-panel');
  if (!panel) return; // old HTML version — emoji panel not yet deployed
  var isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) _emojiCat(document.querySelector('.emoji-cat-btn.active') || document.querySelector('.emoji-cat-btn'), 'recent');
};

window._emojiCat = function (btn, cat) {
  document.querySelectorAll('.emoji-cat-btn').forEach(function (b) { b.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  var grid = document.getElementById('emoji-grid');

  if (cat === 'stickers') {
    var isAdmin = window.ADMIN_GATE_SESSION && window.ADMIN_GATE_SESSION.role === 'owner' ||
                  (STATE.user && (STATE.user.role === 'admin_super' || STATE.user.is_owner));
    grid.style.gridTemplateColumns = 'repeat(4, 1fr)';
    var uploadTile = '<div class="sticker-wrap" onclick="document.getElementById(\'custom-sticker-file-inp\').click()" style="display:flex;align-items:center;justify-content:center;background:var(--bg3);border-radius:10px;cursor:pointer;aspect-ratio:1">' +
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
    '</div>';
    grid.innerHTML = uploadTile + STICKER_PACKS.map(function (s) {
      return '<div class="sticker-wrap">' +
        '<img class="sticker-gif" src="' + s.url + '" alt="' + s.label + '" loading="lazy" onclick="_sendSticker(\'' + s.url + '\')" title="' + s.label + '">' +
        (isAdmin ? '<div class="sticker-del" onclick="event.stopPropagation();_deleteSticker(\'' + s.id + '\')">✕</div>' : '') +
      '</div>';
    }).join('') + '<div id="custom-stickers-slot" style="display:contents"></div>';

    // Load custom stickers (uploaded by users) into the grid too
    api.get('/chat/stickers', true).then(function (res) {
      var slot = document.getElementById('custom-stickers-slot');
      if (!slot) return;
      var meId = STATE.user && STATE.user.id;
      slot.innerHTML = (res.stickers || []).map(function (s) {
        var canDelete = isAdmin || s.owner_id === meId;
        return '<div class="sticker-wrap">' +
          '<img class="sticker-gif" src="' + s.url + '" alt="sticker" loading="lazy" onclick="_sendSticker(\'' + s.url + '\')">' +
          (canDelete ? '<div class="sticker-del" onclick="event.stopPropagation();_deleteCustomSticker(\'' + s.id + '\')">✕</div>' : '') +
        '</div>';
      }).join('');
    }).catch(function () {});
    return;
  }
  grid.style.gridTemplateColumns = '';

  var emojis = typeof EMOJI_CATS[cat] === 'function' ? EMOJI_CATS[cat]() : (EMOJI_CATS[cat] || []);
  grid.innerHTML = emojis.map(function (e) {
    return '<span style="font-size:1.55rem;padding:.2rem .3rem;cursor:pointer;border-radius:6px;transition:background .1s" onclick="_insertEmoji(\'' + e + '\')">' + e + '</span>';
  }).join('');
};

window._sendSticker = function (url) {
  if (!CHAT_curRoom) return;
  var panel = document.getElementById('emoji-panel');
  if (panel) panel.style.display = 'none';
  api.post('/chat', { room_id: CHAT_curRoom.id, type: 'sticker', text: url })
    .then(function () { loadMessages(true); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window._deleteSticker = function (stickerId) {
  ypConfirm('Remove this sticker?', { danger: true, okText: 'Remove' }).then(function (ok) {
    if (!ok) return;
    STICKER_PACKS = STICKER_PACKS.filter(function (s) { return s.id !== stickerId; });
    _emojiCat(null, 'stickers');
    toast('✅ Sticker removed');
  });
};

window.uploadCustomSticker = function (file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) return toast('⚠ Please choose an image.');
  toast('📤 Uploading sticker...');
  var form = new FormData();
  form.append('file', file);
  api.post('/chat/stickers', form, true)
    .then(function () {
      toast('✅ Sticker added!');
      _emojiCat(null, 'stickers');
    })
    .catch(function (err) { toast('❌ ' + err.message); })
    .finally(function () { document.getElementById('custom-sticker-file-inp').value = ''; });
};

window._deleteCustomSticker = function (stickerId) {
  ypConfirm('Delete this sticker?', { danger: true, okText: 'Delete' }).then(function (ok) {
    if (!ok) return;
    api.del('/chat/stickers?id=' + encodeURIComponent(stickerId))
      .then(function () { toast('✅ Deleted'); _emojiCat(null, 'stickers'); })
      .catch(function (err) { toast('❌ ' + err.message); });
  });
};


window._insertEmoji = function (emoji) {
  // Update recently used
  EMOJI_RECENT = [emoji].concat(EMOJI_RECENT.filter(function (e) { return e !== emoji; })).slice(0, 24);
  localStorage.setItem('yp_emoji_recent', JSON.stringify(EMOJI_RECENT));

  var inp = document.getElementById('chat-input');
  if (!inp) return;
  var start = inp.selectionStart || inp.value.length;
  var end   = inp.selectionEnd   || inp.value.length;
  inp.value = inp.value.slice(0, start) + emoji + inp.value.slice(end);
  inp.setSelectionRange(start + emoji.length, start + emoji.length);
  inp.focus();
  onChatType();
};

window.toggleStickersOld = window.toggleStickers; // keep alias

// ============================================================
// ATTACHMENTS — Photo / Video / File / Once
// ============================================================
window.toggleAttach = function (e) {
  if (e) e.stopPropagation();
  document.getElementById('attach-sheet').classList.toggle('open');
};

window.triggerMediaPick = function (accept, isOnce) {
  var inp = document.getElementById('chat-media-input');
  inp.setAttribute('accept', accept);
  inp.dataset.once = isOnce ? '1' : '';
  document.getElementById('attach-sheet').classList.remove('open');
  inp.click();
};

// ── Media preview: single = full-screen modal, multiple = inline bar
window.handleChatMedia = function (e) {
  var files = Array.from(e.target.files || []);
  if (!files.length) return;
  if (!CHAT_curRoom) { toast('⚠ No chat is open.'); return; }
  var isOnce = !!e.target.dataset.once;
  e.target.value = '';

  if (files.length === 1) {
    _showSingleMediaPreview(files[0], isOnce);
  } else {
    _showMultiMediaPreview(files);
  }
};

// Single file — full-screen Telegram-style preview
function _showSingleMediaPreview(file, isOnce) {
  var existing = document.getElementById('media-preview-modal');
  if (existing) { existing._pendingFiles = null; existing.remove(); }

  var isVideo = file.type.startsWith('video/');
  var isImage = file.type.startsWith('image/');
  var isAudio = file.type.startsWith('audio/');
  var objectUrl = URL.createObjectURL(file);

  function fmtSize(b) { return b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB'; }
  var previewInner;
  if (isVideo) {
    previewInner = '<video src="' + objectUrl + '" controls playsinline style="max-width:100%;max-height:100%;border-radius:10px"></video>';
  } else if (isImage) {
    previewInner = '<img src="' + objectUrl + '" style="max-width:100%;max-height:100%;border-radius:10px;object-fit:contain">';
  } else {
    // Any other file (music, PDF, doc, zip…) — show a clean file card, not a broken image.
    var icon = isAudio ? '🎵' : /\.pdf$/i.test(file.name) ? '📕' : /\.(zip|rar|7z)$/i.test(file.name) ? '🗜️' : /\.(doc|docx)$/i.test(file.name) ? '📘' : /\.(xls|xlsx|csv)$/i.test(file.name) ? '📊' : '📄';
    previewInner = '<div style="text-align:center;color:#fff;padding:2rem">' +
      '<div style="font-size:4.5rem;margin-bottom:1rem">' + icon + '</div>' +
      '<div style="font-size:1rem;font-weight:700;word-break:break-all;max-width:280px;margin:0 auto">' + escHtml(file.name) + '</div>' +
      '<div style="font-size:.8rem;opacity:.7;margin-top:.4rem">' + fmtSize(file.size) + '</div>' +
      (isAudio ? '<audio src="' + objectUrl + '" controls style="margin-top:1.2rem;width:260px;max-width:80vw"></audio>' : '') +
    '</div>';
  }

  var modal = document.createElement('div');
  modal.id = 'media-preview-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.93);display:flex;flex-direction:column;';
  modal._fileObj = file;
  modal._isOnce = isOnce;
  modal.innerHTML =
    '<div style="display:flex;align-items:center;padding:.65rem .85rem;flex-shrink:0;gap:.5rem">' +
      '<button onclick="_closeMediaPreview()" style="background:none;border:none;color:#fff;cursor:pointer;padding:.35rem;display:flex;align-items:center">' +
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button>' +
      '<div style="flex:1;text-align:center;font-size:.82rem;color:rgba(255,255,255,.85)">' + (isVideo ? 'Video' : isImage ? 'Photo' : isAudio ? 'Audio' : 'File') + '</div>' +
    '</div>' +
    '<div style="flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:.5rem">' +
      previewInner +
    '</div>' +
    '<div style="padding:.5rem .85rem max(.75rem,env(safe-area-inset-bottom));flex-shrink:0">' +
      '<div style="display:flex;align-items:center;gap:.5rem;background:rgba(255,255,255,.13);border-radius:22px;padding:.4rem .85rem;margin-bottom:.55rem">' +
        '<input id="media-caption-input" placeholder="Add a caption..." style="flex:1;background:none;border:none;color:#fff;outline:none;font-size:.88rem;font-family:inherit" autocomplete="off">' +
      '</div>' +
      '<button onclick="_sendSingleMedia()" style="width:100%;padding:.7rem;background:linear-gradient(135deg,#1F6F5C,#2B8A73);border:none;border-radius:22px;color:#fff;font-size:.95rem;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:.5rem;box-shadow:0 2px 10px rgba(31,111,92,.4)">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg> Send' +
      '</button>' +
    '</div>';
  modal._objectUrl = objectUrl;
  document.body.appendChild(modal);
}

window._closeMediaPreview = function () {
  var modal = document.getElementById('media-preview-modal');
  if (modal) {
    if (modal._objectUrl) URL.revokeObjectURL(modal._objectUrl);
    modal.remove();
  }
  var bar = document.getElementById('multi-media-bar');
  if (bar) bar.remove();
};

window._sendSingleMedia = function () {
  var modal = document.getElementById('media-preview-modal');
  if (!modal) return;
  var file = modal._fileObj;
  var isOnce = modal._isOnce;
  var caption = (document.getElementById('media-caption-input') || {}).value || '';
  if (modal._objectUrl) URL.revokeObjectURL(modal._objectUrl);
  modal.remove();
  if (!file) return;
  _uploadOneFile(file, isOnce ? '__once__' : caption);
};

// Multiple files — inline bar at bottom (like Telegram)
function _showMultiMediaPreview(files) {
  var existing = document.getElementById('multi-media-bar');
  if (existing) existing.remove();
  MULTI_MEDIA_FILES = files;

  var bar = document.createElement('div');
  bar.id = 'multi-media-bar';
  bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:9000;background:var(--surface);border-top:1px solid var(--border);padding:.6rem .75rem max(.6rem,env(safe-area-inset-bottom));';
  bar.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem">' +
      '<div style="font-size:.82rem;font-weight:700">' + files.length + ' files selected</div>' +
      '<button onclick="_closeMediaPreview()" style="background:none;border:none;cursor:pointer;color:var(--muted);padding:.2rem">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button>' +
    '</div>' +
    '<div style="display:flex;gap:.4rem;overflow-x:auto;scrollbar-width:none;margin-bottom:.5rem;padding-bottom:.25rem">' +
      files.map(function (f, i) {
        var isVid = f.type.startsWith('video/');
        var isImg = f.type.startsWith('image/');
        if (!isVid && !isImg) {
          var ic = f.type.startsWith('audio/') ? '🎵' : /\.pdf$/i.test(f.name) ? '📕' : /\.(zip|rar|7z)$/i.test(f.name) ? '🗜️' : /\.(doc|docx)$/i.test(f.name) ? '📘' : /\.(xls|xlsx|csv)$/i.test(f.name) ? '📊' : '📄';
          return '<div style="flex-shrink:0;width:64px;height:64px;border-radius:8px;border:2px solid #1F6F5C;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--bg3);padding:2px">' +
            '<div style="font-size:1.6rem;line-height:1">' + ic + '</div>' +
            '<div style="font-size:.5rem;color:var(--muted);max-width:58px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(f.name) + '</div>' +
          '</div>';
        }
        var url = URL.createObjectURL(f);
        return '<div style="position:relative;flex-shrink:0;width:64px;height:64px;border-radius:8px;overflow:hidden;border:2px solid #1F6F5C">' +
          (isVid
            ? '<video src="' + url + '" style="width:100%;height:100%;object-fit:cover" preload="metadata"></video><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35)"><svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></div>'
            : '<img src="' + url + '" style="width:100%;height:100%;object-fit:cover" loading="lazy">') +
        '</div>';
      }).join('') +
    '</div>' +
    '<div style="display:flex;gap:.4rem">' +
      '<div style="flex:1;display:flex;align-items:center;gap:.4rem;background:var(--bg3);border-radius:20px;padding:.35rem .75rem;border:1.5px solid var(--border)">' +
        '<input id="multi-caption-input" placeholder="Add a caption..." style="flex:1;background:none;border:none;color:var(--text);outline:none;font-size:.85rem;font-family:inherit">' +
      '</div>' +
      '<button onclick="_sendMultiMedia()" style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#1F6F5C,#2B8A73);border:none;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;box-shadow:0 2px 8px rgba(31,111,92,.4)">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>' +
      '</button>' +
    '</div>';
  document.body.appendChild(bar);
}

var MULTI_MEDIA_FILES = [];
window._sendMultiMedia = function () {
  var caption = (document.getElementById('multi-caption-input') || {}).value || '';
  var bar = document.getElementById('multi-media-bar');
  if (bar) bar.remove();
  var files = MULTI_MEDIA_FILES;
  MULTI_MEDIA_FILES = [];
  files.forEach(function (f, i) {
    setTimeout(function () { _uploadOneFile(f, i === 0 ? caption : ''); }, i * 300);
  });
};

function _uploadOneFile(file, caption) {
  var isVideo = file.type.startsWith('video/');
  var isImage = file.type.startsWith('image/');
  var type = (isVideo || isImage) ? 'media' : 'file';
  // For non-media files, show the filename if the user didn't add a caption.
  var text = caption || '';
  if (type === 'file' && (!text || text === '__once__') && file.name) text = file.name;

  // Optimistic bubble: show the image/video/file the instant you hit send,
  // using a local preview URL, then swap in the server copy when it lands.
  var tempId = 'tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  var localUrl = URL.createObjectURL(file);
  var me = STATE.user || {};
  if (CHAT_curRoom) {
    CHAT_messages.push({
      id: tempId, room_id: CHAT_curRoom.id, sender_id: me.id, sender_nick: me.nickname || '',
      type: type, text: (type === 'file' ? text : (caption && caption !== '__once__' ? caption : '')),
      media_url: localUrl, created_at: new Date().toISOString(), read: 0, _pending: true
    });
    renderMessages(false);
    scrollToBottom();
  }

  watermarkFile(file).then(function (watermarked) {
    var form = new FormData();
    form.append('room_id', CHAT_curRoom.id);
    form.append('type', type);
    form.append('text', text);
    form.append('file', watermarked);
    if (CHAT_curTopicId) form.append('topic_id', CHAT_curTopicId);
    return api.post('/chat', form, true);
  })
    .then(function () {
      CHAT_messages = CHAT_messages.filter(function (m) { return m.id !== tempId; });
      try { URL.revokeObjectURL(localUrl); } catch (e) {}
      loadMessages(true); loadChatRooms();
    })
    .catch(function (err) {
      toast('❌ ' + err.message);
      CHAT_messages = CHAT_messages.filter(function (m) { return m.id !== tempId; });
      renderMessages(false);
    });
}

// Keep backward compat
window._sendMediaFromPreview = window._sendSingleMedia;

// One-time view: reveal once then replace with "Opened"
window._openOnce = function (msgId, el) {
  var msg = CHAT_messages.find(function (m) { return m.id === msgId; });
  if (!msg || !msg.media_url) return;
  var isVideo = /\.(mp4|webm|mov)$/i.test(msg.media_key || '');
  var wrap = el.closest('.bubble');
  if (!wrap) return;
  var prev = wrap.querySelector('[onclick*="_openOnce"]');
  if (!prev) return;
  if (isVideo) {
    var vid = document.createElement('video');
    vid.src = msg.media_url; vid.controls = true;
    vid.style.cssText = 'max-width:220px;border-radius:10px;display:block';
    vid.onended = function () { vid.src = ''; prev.innerHTML = '<div style="font-size:.78rem;opacity:.5">Opened</div>'; };
    prev.replaceWith(vid);
  } else {
    var img = document.createElement('img');
    img.src = msg.media_url;
    img.style.cssText = 'max-width:220px;border-radius:10px;display:block';
    prev.replaceWith(img);
    setTimeout(function () { img.src = ''; img.replaceWith(document.createTextNode('Opened')); }, 10000);
  }
};

// ============================================================
// REPLY
// ============================================================
function _setReply(msg) {
  CHAT_replyTo = msg;
  var meId = STATE.user && STATE.user.id;
  document.getElementById('reply-nick').textContent = msg.sender_id === meId ? 'You' : (msg.sender_nick || 'User');
  document.getElementById('reply-snip').textContent = (msg.text || '[media]').slice(0, 60);
  document.getElementById('reply-bar').style.display = 'flex';
  document.getElementById('chat-input').focus();
}
function _cancelReply() {
  CHAT_replyTo = null;
  document.getElementById('reply-bar').style.display = 'none';
}
window.cancelReply = _cancelReply;

// ============================================================
// CONTEXT MENU (long press / right click)
// ============================================================
var _ctxTimer = null;
window._ctxTouch = function (e, msgId) {
  var t = e.touches && e.touches[0];
  _ctxStartX = t ? t.clientX : 0;
  _ctxStartY = t ? t.clientY : 0;
  _ctxMoved = false;
  clearTimeout(_ctxTimer);
  _ctxTimer = setTimeout(function () {
    if (_ctxMoved) return;
    showCtx(e.touches[0], msgId);
  }, 500);
};
window._ctxClear = function () { clearTimeout(_ctxTimer); _ctxMoved = false; };

function _buildCtxMenu(msg) {
  var isMe = msg.sender_id === (STATE.user && STATE.user.id);
  var isAdmin = isAnyAdmin();
  var isText = msg.type === 'text' || msg.type === 'sticker';
  var canEdit = isMe && msg.type === 'text';
  var canDelete = isMe || isAdmin;
  var canPin = isAdmin || (CHAT_curRoom && CHAT_curRoom.is_group_admin);

  var SVG = {
    reply:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>',
    copy:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    edit:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>',
    forward: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>',
    pin:     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>',
    report:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
    trash:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
    close:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  };

  function item(svg, label, fn, danger) {
    var cls = 'ctx-item' + (danger ? ' danger' : '');
    var onclick = fn ? 'onclick="' + fn + '"' : '';
    return '<div class="' + cls + '" data-fn="' + (fn || '') + '">' + svg + ' ' + label + '</div>';
  }

  var items = '';
  var SVG_BOOKMARK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
  var SVG_TRANSLATE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
  var SVG_SELECT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';

  items += item(SVG.reply,    'Reply',        'ctxReply()');
  if (msg.type === 'text' || msg.type === 'media') items += item(SVG.copy, 'Copy', 'ctxCopy()');
  if (canEdit)   items += item(SVG.edit,      'Edit',         'ctxEdit()');
  items +=        item(SVG.forward,  'Forward',      'ctxForward()');
  if (canPin)    items += item(SVG.pin,       'Pin',          'ctxPin()');
  items +=        item(SVG_BOOKMARK, 'Save Message', 'bookmarkMessage(CHAT_ctxMsg.id)');
  items +=        item(SVG_TRANSLATE,'Translate',    'translateMessage(CHAT_ctxMsg.id)');
  items +=        item(SVG_SELECT,   'Select',       '_enterSelectMode(CHAT_ctxMsg.id); renderMessages(false);');
  if (!isMe)     items += item(SVG.report,    'Report',       'ctxReport()');
  if (canDelete) items += item(SVG.trash,     'Delete',       'ctxDelete()', true);
  items +=        item(SVG.close,    'Cancel',       'closeCtxMenu()');

  var el = document.getElementById('ctx-menu-items');
  el.innerHTML = items;

  // Wire clicks via a safe dispatch map — never eval(). The data-fn values
  // are fixed internal command names; we look them up instead of executing
  // arbitrary strings.
  var CTX_ACTIONS = {
    'ctxReply()': ctxReply, 'ctxCopy()': ctxCopy, 'ctxForward()': ctxForward,
    'ctxPin()': ctxPin, 'ctxEdit()': ctxEdit, 'ctxReport()': ctxReport,
    'ctxDelete()': ctxDelete,
  };
  el.querySelectorAll('.ctx-item').forEach(function (div) {
    div.addEventListener('click', function () {
      var fn = div.dataset.fn;
      document.getElementById('ctx-menu').classList.remove('open');
      var action = CTX_ACTIONS[fn];
      if (typeof action === 'function') { try { action(); } catch (e) { toast('❌ ' + e.message); } }
    });
  });
}

window.closeCtxMenu = function () {
  var m = document.getElementById('ctx-menu');
  if (m) m.classList.remove('open');
  var qr = document.getElementById('quick-react-bar');
  if (qr) qr.style.display = 'none';
};

window.showCtx = function (e, msgId) {
  CHAT_ctxMsg = CHAT_messages.find(function (m) { return m.id === msgId; });
  if (!CHAT_ctxMsg) return;

  // First build the menu content (so we know what's shown)
  _buildCtxMenu(CHAT_ctxMsg);

  var menu = document.getElementById('ctx-menu');
  menu.classList.add('open');
  var x = (e.clientX || (e.touches && e.touches[0] && e.touches[0].clientX) || 0);
  var y = (e.clientY || (e.touches && e.touches[0] && e.touches[0].clientY) || 0);

  // Measure after making visible (display:block)
  var mh = menu.offsetHeight || 220;
  var mw = menu.offsetWidth  || 170;

  // Flip upward if not enough space below
  var topPos = (y + mh > window.innerHeight - 10) ? Math.max(y - mh, 10) : y;
  var leftPos = Math.min(x, window.innerWidth - mw - 10);

  menu.style.left = leftPos + 'px';
  menu.style.top  = topPos  + 'px';

  // Keep the reaction bar pinned above the menu (never overlapping it).
  requestAnimationFrame(_layoutMsgActions);
};

// Position the quick-react bar directly above the context menu whenever both
// are open, so the emoji row is always on top and never lands in the middle of
// the menu (Android fires the long-press context menu + our react timer together).
function _layoutMsgActions() {
  var menu = document.getElementById('ctx-menu');
  var bar  = document.getElementById('quick-react-bar');
  if (!menu || !bar) return;
  var menuOpen = menu.classList.contains('open');
  var barOpen  = bar.style.display === 'flex';
  if (!menuOpen || !barOpen) return;

  var mTop  = parseFloat(menu.style.top)  || 0;
  var mLeft = parseFloat(menu.style.left) || 0;
  var bh = bar.offsetHeight || 46;
  var bw = bar.offsetWidth  || 250;

  var barTop = mTop - bh - 10;
  if (barTop < 10) {
    // No room above the menu — pin the bar to the top and push the menu down.
    barTop = 10;
    var mh = menu.offsetHeight || 220;
    var newMenuTop = barTop + bh + 10;
    if (newMenuTop + mh > window.innerHeight - 10) {
      newMenuTop = Math.max(window.innerHeight - mh - 10, barTop + bh + 10);
    }
    menu.style.top = newMenuTop + 'px';
  }
  bar.style.top  = barTop + 'px';
  bar.style.left = Math.min(mLeft, window.innerWidth - bw - 10) + 'px';
}

window.toggleReaction = function (msgId, emoji) {
  api.post('/chat/reactions', { message_id: msgId, emoji: emoji })
    .then(function (res) {
      CHAT_reactions[msgId] = { counts: res.reactions, my_reaction: res.my_reaction };
      renderMessages(false);
    })
    .catch(function (err) { toast('❌ ' + err.message); });
  var qr = document.getElementById('quick-react-bar');
  if (qr) qr.style.display = 'none';
  var cm = document.getElementById('ctx-menu');
  if (cm) cm.classList.remove('open');
};

window.showQuickReact = function (e, msgId) {
  var bar = document.getElementById('quick-react-bar');
  if (!bar) return;
  CHAT_ctxMsg = CHAT_messages.find(function (m) { return m.id === msgId; });
  bar.dataset.msgId = msgId;
  var x = (e.clientX || (e.touches && e.touches[0].clientX) || 0);
  var y = (e.clientY || (e.touches && e.touches[0].clientY) || 0);
  bar.style.left = Math.min(x, window.innerWidth - 240) + 'px';
  bar.style.top  = Math.max(y - 50, 10) + 'px';
  bar.style.display = 'flex';
  // If the context menu also opened (mobile long-press), snap the bar above it.
  requestAnimationFrame(_layoutMsgActions);
};

document.addEventListener('click', function (e) {
  if (!e.target.closest('#quick-react-bar')) {
    var qr = document.getElementById('quick-react-bar');
    if (qr) qr.style.display = 'none';
  }
});

window.ctxReply = function () {
  if (CHAT_ctxMsg) _setReply(CHAT_ctxMsg);
  document.getElementById('ctx-menu').classList.remove('open');
};
window.ctxCopy = function () {
  if (CHAT_ctxMsg && CHAT_ctxMsg.text && navigator.clipboard) {
    navigator.clipboard.writeText(CHAT_ctxMsg.text).then(function () { toast('✅ Copied!'); });
  }
  document.getElementById('ctx-menu').classList.remove('open');
};
window.ctxForward = function () {
  document.getElementById('ctx-menu').classList.remove('open');
  if (!CHAT_ctxMsg) return;
  // Show a modal to pick a chat to forward to
  var rooms = CHAT_rooms || [];
  if (!rooms.length) return toast('No chats to forward to.');
  var opts = rooms.map(function (r) {
    return '<div style="display:flex;align-items:center;gap:.75rem;padding:.65rem 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="doForward(\'' + r.id + '\')">' +
      '<div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--blue),#7C4DFF);color:#fff;display:flex;align-items:center;justify-content:center;font-size:.9rem;font-weight:700">' + escHtml((r.nick||'?').slice(0,1).toUpperCase()) + '</div>' +
      '<div style="font-size:.88rem;font-weight:600">' + escHtml(r.nick || 'Chat') + '</div>' +
    '</div>';
  }).join('');
  var modal = document.getElementById('forward-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'forward-modal';
    modal.className = 'modal-overlay';
    modal.onclick = function (e) { if (e.target === modal) modal.classList.remove('open'); };
    modal.innerHTML = '<div class="modal-sheet"><div class="modal-title">Forward to...</div><div id="forward-list" style="max-height:260px;overflow-y:auto"></div><button class="modal-cancel" onclick="document.getElementById(\'forward-modal\').classList.remove(\'open\')">Cancel</button></div>';
    document.body.appendChild(modal);
  }
  document.getElementById('forward-list').innerHTML = opts;
  modal.classList.add('open');
};
window.doForward = function (toRoomId) {
  document.getElementById('forward-modal').classList.remove('open');
  if (!CHAT_ctxMsg) return;
  api.post('/chat', { room_id: toRoomId, type: CHAT_ctxMsg.type || 'text', text: (CHAT_ctxMsg.text || '') + (CHAT_ctxMsg.type === 'text' ? '' : ''), forwarded: true })
    .then(function () { toast('✅ Forwarded!'); })
    .catch(function (err) { toast('❌ ' + err.message); });
};
window.ctxPin = function () {
  document.getElementById('ctx-menu').classList.remove('open');
  if (!CHAT_ctxMsg || !CHAT_curRoom) return;
  api.put('/chat/rooms', { room_id: CHAT_curRoom.id, pinned_message_id: CHAT_ctxMsg.id })
    .then(function () {
      CHAT_pinnedMsgId = CHAT_ctxMsg.id;
      CHAT_curRoom.pinned_message_id = CHAT_ctxMsg.id;
      var bar = document.getElementById('pinned-bar');
      var txt = document.getElementById('pinned-bar-text');
      if (bar) bar.style.display = 'flex';
      if (txt) txt.textContent = CHAT_ctxMsg.text || '[Media]';
      toast('📌 Message pinned!');
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};
window.unpinMessage = function () {
  if (!CHAT_curRoom) return;
  api.put('/chat/rooms', { room_id: CHAT_curRoom.id, pinned_message_id: null })
    .then(function () {
      CHAT_pinnedMsgId = null;
      CHAT_curRoom.pinned_message_id = null;
      var bar = document.getElementById('pinned-bar');
      if (bar) bar.style.display = 'none';
      toast('Message unpinned');
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};
window.ctxEdit = function () {
  document.getElementById('ctx-menu').classList.remove('open');
  if (!CHAT_ctxMsg) return;
  var meId = STATE.user && STATE.user.id;
  if (CHAT_ctxMsg.sender_id !== meId) return toast('⚠ You can only edit your own messages.');
  if (CHAT_ctxMsg.type !== 'text') return toast('⚠ Only text messages can be edited.');

  // Use the edit-modal instead of a blocking prompt()
  var modal = document.getElementById('edit-msg-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'edit-msg-modal';
    modal.className = 'modal-overlay';
    modal.onclick = function (e) { if (e.target === modal) modal.classList.remove('open'); };
    modal.innerHTML = '<div class="modal-sheet"><div class="modal-title">Edit message</div><textarea id="edit-msg-input" style="width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:.75rem;color:var(--text);font-family:inherit;font-size:.9rem;resize:none;outline:none;margin-bottom:1rem" rows="4"></textarea><button class="save-pill" onclick="submitEditMsg()" style="width:100%;padding:.65rem;border-radius:12px;background:var(--blue);border:none;color:#fff;font-weight:700;cursor:pointer;margin-bottom:.5rem">Save</button><button class="modal-cancel" onclick="document.getElementById(\'edit-msg-modal\').classList.remove(\'open\')">Cancel</button></div>';
    document.body.appendChild(modal);
  }
  document.getElementById('edit-msg-input').value = CHAT_ctxMsg.text || '';
  modal.classList.add('open');
  setTimeout(function () { document.getElementById('edit-msg-input').focus(); }, 100);
};
window.submitEditMsg = function () {
  document.getElementById('edit-msg-modal').classList.remove('open');
  var newText = (document.getElementById('edit-msg-input').value || '').trim();
  if (!newText || !CHAT_ctxMsg) return;
  api.put('/chat', { id: CHAT_ctxMsg.id, text: newText })
    .then(function () { loadMessages(false); toast('✅ Message edited'); })
    .catch(function (err) { toast('❌ ' + err.message); });
};
window.ctxReport = function () {
  document.getElementById('ctx-menu').classList.remove('open');
  if (!CHAT_ctxMsg) return;
  api.post('/reports', { target_type: 'message', target_id: CHAT_ctxMsg.id, reason: 'User report' })
    .then(function () { toast('✅ Reported.'); })
    .catch(function (err) { toast('❌ ' + err.message); });
};
window.ctxDelete = function () {
  if (!CHAT_ctxMsg) return;
  var msgId = CHAT_ctxMsg.id;
  document.getElementById('ctx-menu').classList.remove('open');
  // Immediately hide from UI for instant feel
  var el = document.querySelector('[data-msg-id="' + msgId + '"]');
  if (el) {
    el.style.transition = 'opacity .15s, transform .15s';
    el.style.opacity = '0';
    el.style.transform = 'scale(0.95)';
    setTimeout(function () { if (el.parentElement) el.remove(); }, 150);
  }
  // Remove from local cache
  CHAT_messages = CHAT_messages.filter(function(m){ return m.id !== msgId; });
  api.del('/chat?id=' + encodeURIComponent(msgId))
    .then(function () { toast('🗑 Deleted'); loadChatRooms(); })
    .catch(function (err) { toast('❌ ' + err.message); loadMessages(true); });
};

document.addEventListener('click', function (e) {
  if (!e.target.closest('#ctx-menu')) document.getElementById('ctx-menu').classList.remove('open');
  if (!e.target.closest('#attach-sheet') && !e.target.closest('.icon-btn')) {
    var a = document.getElementById('attach-sheet');
    if (a) a.classList.remove('open');
  }
});

// ============================================================
// NEW CHAT / DM
// ============================================================
window.toggleChatFab = function () {
  var menu = document.getElementById('chat-fab-menu');
  if (menu) menu.classList.toggle('open');
};

window.openNewChatModal = function () {
  document.getElementById('new-chat-modal').classList.add('open');
  document.getElementById('new-chat-search').value = '';
  document.getElementById('user-search-results').innerHTML =
    '<div style="padding:1rem;text-align:center;font-size:.8rem;color:var(--muted)">Type to search users...</div>';
};

var _srchTimer = null;
window.searchNewChatUsers = function () {
  clearTimeout(_srchTimer);
  var q  = (document.getElementById('new-chat-search').value || '').trim();
  var el = document.getElementById('user-search-results');
  if (!q) { el.innerHTML = '<div style="padding:1rem;text-align:center;font-size:.8rem;color:var(--muted)">Type to search users...</div>'; return; }
  _srchTimer = setTimeout(function () {
    api.get('/users/search?q=' + encodeURIComponent(q))
      .then(function (res) {
        var users = res.users || [];
        el.innerHTML = !users.length
          ? '<div style="padding:1rem;text-align:center;font-size:.82rem;color:var(--muted)">No users found</div>'
          : users.map(function (u) {
              return '<div style="display:flex;align-items:center;gap:.6rem;padding:.65rem 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="startDM(\'' + u.id + '\')">' +
                '<div style="width:36px;height:36px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:.9rem;font-weight:700;border:1px solid var(--border)">' +
                  (u.nickname || '?').slice(0,1).toUpperCase() +
                '</div>' +
                '<div style="font-size:.85rem;font-weight:700">@' + escHtml(u.nickname || '') + '</div>' +
              '</div>';
            }).join('');
      })
      .catch(function (err) { el.innerHTML = '<div style="padding:1rem;color:var(--red);font-size:.8rem">' + escHtml(err.message) + '</div>'; });
  }, 300);
};

// ============================================================
// ADD MEMBER — invite an existing user into the currently-open group
// ============================================================
window.openAddMemberModal = function () {
  if (!CHAT_curRoom || CHAT_curRoom.type !== 'group') return;
  document.getElementById('add-member-modal').classList.add('open');
  document.getElementById('add-member-search').value = '';
  document.getElementById('add-member-results').innerHTML =
    '<div style="padding:1rem;text-align:center;font-size:.8rem;color:var(--muted)">Type to search users...</div>';
};

var _addMemberSrchTimer = null;
window.searchAddMemberUsers = function () {
  clearTimeout(_addMemberSrchTimer);
  var q  = (document.getElementById('add-member-search').value || '').trim();
  var el = document.getElementById('add-member-results');
  if (!q) { el.innerHTML = '<div style="padding:1rem;text-align:center;font-size:.8rem;color:var(--muted)">Type to search users...</div>'; return; }

  _addMemberSrchTimer = setTimeout(function () {
    api.get('/users/search?q=' + encodeURIComponent(q))
      .then(function (res) {
        var users = res.users || [];
        var existingIds = (CHAT_members || []).map(function (m) { return m.id; });
        var notYetMembers = users.filter(function (u) { return existingIds.indexOf(u.id) === -1; });

        el.innerHTML = !notYetMembers.length
          ? '<div style="padding:1rem;text-align:center;font-size:.82rem;color:var(--muted)">No users found</div>'
          : notYetMembers.map(function (u) {
              return '<div style="display:flex;align-items:center;gap:.6rem;padding:.65rem 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="addMemberToGroup(\'' + u.id + '\')">' +
                '<div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--blue),#7C4DFF);color:#fff;display:flex;align-items:center;justify-content:center;font-size:.9rem;font-weight:700">' +
                  (u.nickname || '?').slice(0,1).toUpperCase() +
                '</div>' +
                '<div style="font-size:.85rem;font-weight:700">@' + escHtml(u.nickname || '') + '</div>' +
              '</div>';
            }).join('');
      })
      .catch(function (err) { el.innerHTML = '<div style="padding:1rem;color:var(--red);font-size:.8rem">' + escHtml(err.message) + '</div>'; });
  }, 300);
};

window.addMemberToGroup = function (userId) {
  if (!CHAT_curRoom) return;
  api.put('/chat/rooms', { room_id: CHAT_curRoom.id, member_id: userId, add: true })
    .then(function () {
      document.getElementById('add-member-modal').classList.remove('open');
      toast('✅ Member added');
      loadGroupMembers(CHAT_curRoom.id);
      loadMessages(true);
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

// Lightweight profile popup for the Chats page — clicking a sender's name in
// a group opens this instead of the full Home profile screen (which needs
// infrastructure — navTo, PROFILE_userId, follow system — not loaded here).
window.openUserProfile = function (userId) {
  if (!userId) return;
  // The full profile (posts, videos, music, status) lives on the main app
  // page. Deep-link there so tapping a name in chat shows the real profile
  // instead of a tiny preview sheet.
  goPage('/?profile=' + encodeURIComponent(userId));
};

window.startDM = function (userId) {
  document.getElementById('new-chat-modal').classList.remove('open');
  api.post('/chat/rooms', { type: 'private', other_user_id: userId })
    .then(function (res) {
      toast('💬 Opening chat...');
      loadChatRooms();
      setTimeout(function () { openChatRoomById(res.room_id); }, 400);
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

function openChatRoomById(roomId) {
  api.get('/chat/rooms').then(function (res) {
    CHAT_rooms = res.rooms || [];
    renderChatList();
    openChatRoom(roomId);
  });
}

// ============================================================
// CREATE GROUP
// ============================================================
window.openNewGroupModal = function () {
  document.getElementById('new-group-modal').classList.add('open');
  document.getElementById('new-group-name').value = '';
};

window.createNewGroup = function () {
  var name = (document.getElementById('new-group-name').value || '').trim();
  var sel  = document.querySelector('input[name="group-emoji"]:checked');
  var emoji = sel ? sel.value : '👥';
  if (name.length < 2) return toast('⚠ Name must be at least 2 characters.');

  var isPublic = document.getElementById('new-group-public-toggle').classList.contains('on');
  var everyoneCanWrite = document.getElementById('new-group-writeall-toggle').classList.contains('on');

  api.post('/chat/rooms', {
    type: 'group',
    name: name,
    emoji: emoji,
    visibility: isPublic ? 'public' : 'private',
    read_only: !everyoneCanWrite,
  })
    .then(function (res) {
      document.getElementById('new-group-modal').classList.remove('open');
      toast('✅ Group "' + name + '" created!');
      loadChatRooms();
      setTimeout(function () { openChatRoomById(res.room_id); }, 400);
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

// ============================================================
// HELPERS
// ============================================================
function _fmt12(iso) {
  if (!iso) return '';
  var d   = new Date(iso);
  var h   = d.getHours();
  var m   = String(d.getMinutes()).padStart(2, '0');
  var ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return h + ':' + m + ' ' + ampm;
}

function _dateLabel(iso) {
  if (!iso) return '';
  var d     = new Date(iso);
  var today = new Date();
  var yest  = new Date(today); yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString())  return 'Yesterday';
  return d.toLocaleDateString('en', { day:'numeric', month:'short', year:'numeric' });
}

function _fakeBars(n) {
  // Deterministic pseudo-waveform (was Math.random(), which made the bars
  // flicker on every re-render). A fixed pattern keeps them stable.
  var bars = '';
  for (var i = 0; i < n; i++) {
    var h = 6 + Math.round(Math.abs(Math.sin(i * 1.7) * 0.6 + Math.sin(i * 0.7) * 0.4) * 20);
    bars += '<div class="vbar" style="height:' + h + 'px"></div>';
  }
  return bars;
}

function _linkify(text, isMe) {
  var c = isMe ? 'rgba(255,255,255,.9)' : 'var(--blue)';
  var out = text.replace(/(https?:\/\/[^\s<>"]+)/g, function (url) {
    return '<a href="' + url + '" target="_blank" style="color:' + c + ';word-break:break-all;text-decoration:underline">' + url + '</a>';
  });
  // Lightweight WhatsApp/Telegram-style inline formatting. Order matters:
  // code first (so *, _, ~ inside a code span are left alone), then bold,
  // then italic, then strikethrough. Each requires non-space content
  // directly against the markers so normal use of * _ ~ in everyday
  // sentences doesn't accidentally trigger formatting.
  out = out.replace(/`([^`\n]+)`/g, '<code style="background:rgba(127,127,127,.18);padding:.05em .35em;border-radius:4px;font-family:\'IBM Plex Mono\',monospace;font-size:.92em">$1</code>');
  out = out.replace(/\*\*([^\s*][^*]*?)\*\*/g, '<b>$1</b>');
  out = out.replace(/(^|[\s(])_([^\s_][^_]*?)_(?=[\s).,!?]|$)/g, '$1<i>$2</i>');
  out = out.replace(/~([^\s~][^~]*?)~/g, '<s>$1</s>');
  return out;
}

// A message that's just one or a few emoji (no other text) renders much
// bigger, the way every mainstream messaging app does it — makes casual
// reactions ("😂😂😂", "❤️") feel intentional instead of tiny and lost.
var _EMOJI_ONLY_RE = /^(?:\p{Extended_Pictographic}\u200d?|\uFE0F|\s){1,6}$/u;
function _isEmojiOnlyText(text) {
  if (!text) return false;
  var t = text.trim();
  return t.length > 0 && t.length <= 24 && _EMOJI_ONLY_RE.test(t);
}

function _renderWaveBars(peaks) {
  return peaks.map(function (p) {
    var h = Math.max(4, Math.round(p * 30));
    return '<div class="vbar" style="height:' + h + 'px"></div>';
  }).join('');
}

window._seekVoice = function (e, msgId) {
  if (YP_play.msgId !== msgId) return;
  var aud = _ypAudioEl();
  var barsEl = document.getElementById('vbars-' + msgId);
  var dur = (isFinite(aud.duration) && aud.duration) ? aud.duration : (YP_play.dur || 0);
  if (!barsEl || !dur) return;
  var rect = barsEl.getBoundingClientRect();
  var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  try { aud.currentTime = pct * dur; } catch (er) {}
};

window._toggleVoiceSpeed = function (msgId) {
  var aud = _ypAudioEl();
  var btn = document.getElementById('vspeed-' + msgId);
  if (YP_play.msgId !== msgId || !btn) return;
  var newRate = aud.playbackRate >= 2 ? 1 : 2;
  aud.playbackRate = newRate;
  btn.textContent = newRate + 'x';
};

window._openOnceVoice = function (msgId, mediaUrl) {
  ypConfirm('This voice message will disappear after you listen to it. Continue?', { okText: 'Listen' }).then(function (ok) {
    if (!ok) return;
    var aud = new Audio(mediaUrl);
    aud.play().catch(function () {});
    var msg = CHAT_messages.find(function (m) { return m.id === msgId; });
    if (msg) msg.opened = true;
    api.put('/chat', { id: msgId, opened: true }).catch(function () {});
    renderMessages(false);
  });
};

// Small SVG icons for voice note buttons (defined here, referenced in render + playback)
var ICON_PLAY_SM  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
var ICON_PAUSE_SM = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';

// ── ONE global audio player that lives OUTSIDE #chat-msgs. Because the message
//    list rebuilds on every poll, any <audio> inside it gets destroyed mid-play
//    (the "shockt zich op" glitch). This element is appended to <body> once and
//    never re-rendered, so voice notes and music play through smoothly — the
//    bubbles only drive it and read its progress. ──
function _fmtClock(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}
var YP_play = { msgId: null, type: null };
// A single audio object kept in a JS variable — NOT in the DOM, so message-list
// re-renders never touch it, AND we make a fresh one per clip so a reused webm
// decoder can't play the next note too fast / wrong-pitched (an Android bug).
var YP_audioObj = null;
function _ypAudioEl() { return YP_audioObj || (YP_audioObj = new Audio()); }
function _ypFreshAudio(url) {
  if (YP_audioObj) { try { YP_audioObj.pause(); } catch (e) {} YP_audioObj.onended = YP_audioObj.ontimeupdate = null; }
  var a = new Audio();
  a.preload = 'auto';
  a.playbackRate = 1;
  // Keep natural pitch/speed — guards against a stuck rate or resampling.
  try { a.preservesPitch = true; a.mozPreservesPitch = true; a.webkitPreservesPitch = true; } catch (e) {}
  a.addEventListener('timeupdate', _ypOnTime);
  a.addEventListener('ended', _ypOnEnded);
  a.src = url;
  YP_audioObj = a;
  return a;
}
// Voice notes pack their real recorded length as "M:SS|peaks"; use it for the
// progress bar because webm/opus files report duration = Infinity.
function _knownDur(msgId, type) {
  if (type !== 'voice') return 0;
  var m = CHAT_messages.find(function (x) { return x.id === msgId; });
  if (!m || !m.text) return 0;
  var ds = String(m.text).split('|')[0];
  var parts = ds.split(':');
  if (parts.length === 2) return (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
  return 0;
}
function _ypAudioElOld() {
  var a = document.getElementById('yp-global-audio');
  if (!a) {
    a = document.createElement('audio');
    a.id = 'yp-global-audio';
    a.preload = 'metadata';
    document.body.appendChild(a);
    a.addEventListener('timeupdate', _ypOnTime);
    a.addEventListener('ended', _ypOnEnded);
  }
  return a;
}
function _msgUrl(msgId) {
  var m = CHAT_messages.find(function (x) { return x.id === msgId; });
  return m ? m.media_url : null;
}
function _ypSetBtn(msgId, type, playing) {
  var b = document.getElementById((type === 'music' ? 'mplay-' : 'pbtn-') + msgId);
  if (b) b.innerHTML = playing ? ICON_PAUSE_SM : ICON_PLAY_SM;
}
function _ypClearUI(msgId, type) {
  _ypSetBtn(msgId, type, false);
  if (type === 'music') {
    var fill = document.getElementById('mfill-' + msgId);
    if (fill) fill.style.width = '0%';
    var time = document.getElementById('mtime-' + msgId);
    var a = _ypAudioEl();
    if (time && isFinite(a.duration)) time.textContent = _fmtClock(a.duration);
  } else {
    var barsEl = document.getElementById('vbars-' + msgId);
    if (barsEl) barsEl.querySelectorAll('.vbar').forEach(function (b) { b.classList.remove('played'); });
  }
}
function _ypOnTime() {
  var a = _ypAudioEl();
  if (!YP_play.msgId) return;
  // webm/opus voice notes report Infinity — fall back to the recorded length.
  var dur = (isFinite(a.duration) && a.duration) ? a.duration : (YP_play.dur || 0);
  if (!dur) return;
  var pct = Math.min(1, a.currentTime / dur);
  if (YP_play.type === 'music') {
    var fill = document.getElementById('mfill-' + YP_play.msgId);
    var time = document.getElementById('mtime-' + YP_play.msgId);
    if (fill) fill.style.width = (pct * 100) + '%';
    if (time) time.textContent = _fmtClock(a.currentTime) + ' / ' + _fmtClock(dur);
  } else {
    var barsEl = document.getElementById('vbars-' + YP_play.msgId);
    if (barsEl) {
      var bars = barsEl.querySelectorAll('.vbar');
      var played = Math.floor(pct * bars.length);
      bars.forEach(function (b, i) { b.classList.toggle('played', i < played); });
    }
    var durEl = document.getElementById('vdur-' + YP_play.msgId);
    if (durEl) durEl.textContent = _fmtClock(dur - a.currentTime);
  }
}
function _ypOnEnded() {
  var finishedId = YP_play.msgId, wasVoice = YP_play.type === 'voice';
  if (YP_play.msgId) _ypClearUI(YP_play.msgId, YP_play.type);
  YP_play = { msgId: null, type: null };
  if (wasVoice) _autoPlayNextVoice(finishedId);
}
// Re-assert the play/pause icon after a re-render (the fresh HTML starts at ▶).
function _ypRestoreUI() {
  var a = _ypAudioEl();
  if (YP_play.msgId && !a.paused) _ypSetBtn(YP_play.msgId, YP_play.type, true);
}
function _ypToggle(msgId, type) {
  if (YP_play.msgId === msgId && YP_audioObj) {   // same clip → pause / resume
    if (YP_audioObj.paused) { YP_audioObj.play().catch(function () {}); _ypSetBtn(msgId, type, true); }
    else { YP_audioObj.pause(); _ypSetBtn(msgId, type, false); }
    return;
  }
  if (YP_play.msgId) _ypClearUI(YP_play.msgId, YP_play.type); // stop previous clip's UI
  var url = _msgUrl(msgId);
  if (!url) { toast('⚠ Audio unavailable'); return; }
  YP_play = { msgId: msgId, type: type, dur: _knownDur(msgId, type) };
  if (type === 'voice') { var sp = document.getElementById('vspeed-' + msgId); if (sp) sp.textContent = '1x'; }
  var a = _ypFreshAudio(url);
  a.play().catch(function (e) { toast('⚠ ' + e.message); });
  _ypSetBtn(msgId, type, true);
}
window._playMusicFile = function (msgId) { _ypToggle(msgId, 'music'); };
window._seekMusic = function (e, msgId) {
  if (YP_play.msgId !== msgId) return;
  var a = _ypAudioEl();
  var prog = document.getElementById('mprog-' + msgId);
  if (!prog || !isFinite(a.duration) || !a.duration) return;
  var rect = prog.getBoundingClientRect();
  a.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * a.duration;
};

window._playVoice = function (msgId, btn) { _ypToggle(msgId, 'voice'); };

// When a voice note finishes, auto-advance to the next voice note in the
// chat (Telegram/WhatsApp-style continuous playback), if there is one.
function _autoPlayNextVoice(msgId) {
  var idx = CHAT_messages.findIndex(function (m) { return m.id === msgId; });
  if (idx === -1) return;
  for (var i = idx + 1; i < CHAT_messages.length; i++) {
    if (CHAT_messages[i].type === 'voice') {
      _playVoice(CHAT_messages[i].id);
      return;
    }
  }
}

var _scrollListenerAdded = false;
var _origNavTo = window.navTo;
window.navTo = function (id) {
  _origNavTo(id);
  if (id === 'chatroom' && !_scrollListenerAdded) {
    var cont = document.getElementById('chat-msgs');
    if (cont) {
      cont.addEventListener('scroll', _onMsgsScroll, { passive: true });
      _scrollListenerAdded = true;
    }
  }
  if (id !== 'chatroom') {
    clearInterval(CHAT_pollTimer);
    _scrollListenerAdded = false;
  }
};

console.log('[YID PLUS] chat.js loaded ✓ (Telegram-style)');

// ============================================================
// POLLS — creation modal, rendering, voting
// ============================================================

var POLL_correctIndices = new Set();

window.openPollModal = function () {
  if (!CHAT_curRoom) return toast('⚠ Open a chat first.');
  if (!STATE.user) return toast('⚠ Please sign in first.');
  POLL_correctIndices = new Set();

  // Reset form
  document.getElementById('poll-question').value = '';
  document.getElementById('poll-description').value = '';
  ['show-who-voted','allow-multiple','allow-add-options','shuffle'].forEach(function(id){
    var el = document.getElementById('poll-toggle-' + id);
    if (el) el.classList.remove('on');
  });
  document.getElementById('poll-toggle-allow-revote').classList.add('on');
  document.getElementById('poll-toggle-quiz-mode').classList.remove('on');
  document.getElementById('poll-toggle-duration').classList.remove('on');
  document.getElementById('poll-duration-input-row').style.display = 'none';

  var list = document.getElementById('poll-options-list');
  list.innerHTML = '';
  addPollOptionRow();
  addPollOptionRow();

  document.getElementById('poll-modal').classList.add('open');
};

window.closePollModal = function () {
  document.getElementById('poll-modal').classList.remove('open');
};

window.addPollOptionRow = function () {
  var list = document.getElementById('poll-options-list');
  var idx = list.children.length;
  var row = document.createElement('div');
  row.className = 'poll-option-row';
  row.dataset.idx = idx;
  row.innerHTML =
    '<div class="poll-correct-toggle" id="poll-correct-' + idx + '" onclick="_toggleCorrect(' + idx + ')" title="Mark as correct answer" style="display:none">✓</div>' +
    '<input type="text" placeholder="Option ' + (idx + 1) + '" maxlength="100">' +
    (idx >= 2 ? '<button class="poll-option-remove" onclick="removePollOptionRow(this)" title="Remove"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' : '<div style="width:28px"></div>');
  list.appendChild(row);
};

window.removePollOptionRow = function (btn) {
  var row = btn.closest('.poll-option-row');
  if (row) row.remove();
  // Re-number placeholders
  var rows = document.querySelectorAll('#poll-options-list .poll-option-row');
  rows.forEach(function(r, i) {
    var inp = r.querySelector('input');
    if (inp) inp.placeholder = 'Option ' + (i + 1);
    r.dataset.idx = i;
  });
};

window._toggleCorrect = function (idx) {
  var btn = document.getElementById('poll-correct-' + idx);
  if (!btn) return;
  if (POLL_correctIndices.has(idx)) {
    POLL_correctIndices.delete(idx);
    btn.classList.remove('on');
  } else {
    POLL_correctIndices.add(idx);
    btn.classList.add('on');
  }
};

window.togglePollQuizMode = function (sw) {
  sw.classList.toggle('on');
  var isOn = sw.classList.contains('on');
  document.querySelectorAll('.poll-correct-toggle').forEach(function(b){
    b.style.display = isOn ? 'flex' : 'none';
  });
};

window.togglePollDuration = function (sw) {
  sw.classList.toggle('on');
  var isOn = sw.classList.contains('on');
  document.getElementById('poll-duration-input-row').style.display = isOn ? 'block' : 'none';
};

window.submitNewPoll = function () {
  if (!CHAT_curRoom) return;
  var question = (document.getElementById('poll-question').value || '').trim();
  if (!question) return toast('⚠ Please enter a question.');

  var rows = document.querySelectorAll('#poll-options-list .poll-option-row');
  var options = [];
  rows.forEach(function(r) { var v = (r.querySelector('input').value || '').trim(); if (v) options.push(v); });
  if (options.length < 2) return toast('⚠ At least 2 options are required.');

  var isQuiz = document.getElementById('poll-toggle-quiz-mode').classList.contains('on');
  var hasDuration = document.getElementById('poll-toggle-duration').classList.contains('on');
  var durationMin = hasDuration ? parseInt(document.getElementById('poll-duration-minutes').value, 10) : null;

  var payload = {
    room_id:          CHAT_curRoom.id,
    question:         question,
    description:      (document.getElementById('poll-description').value || '').trim() || undefined,
    options:          options,
    show_who_voted:   document.getElementById('poll-toggle-show-who-voted').classList.contains('on'),
    allow_multiple:   document.getElementById('poll-toggle-allow-multiple').classList.contains('on'),
    allow_add_options:document.getElementById('poll-toggle-allow-add-options').classList.contains('on'),
    allow_revote:     document.getElementById('poll-toggle-allow-revote').classList.contains('on'),
    shuffle_options:  document.getElementById('poll-toggle-shuffle').classList.contains('on'),
    quiz_mode:        isQuiz,
    duration_minutes: durationMin,
    correct_indices:  isQuiz ? Array.from(POLL_correctIndices) : [],
  };

  closePollModal();
  toast('📊 Creating poll...');

  api.post('/polls', payload)
    .then(function () { loadMessages(true); loadChatRooms(); toast('✅ Poll created!'); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

// ── render poll message bubble ─────────────────────────────
function _renderPollBubble(m, isMe) {
  var pollId = m.text; // poll id is stored in message.text for type=poll
  var html =
    '<div class="poll-bubble" id="poll-' + pollId + '">' +
      '<div style="font-size:.7rem;font-weight:700;color:var(--blue);margin-bottom:.4rem;letter-spacing:.08em";display:flex;align-items:center;gap:.3rem"><svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><line x1=\"12\" y1=\"20\" x2=\"12\" y2=\"10\"/><line x1=\"18\" y1=\"20\" x2=\"18\" y2=\"4\"/><line x1=\"6\" y1=\"20\" x2=\"6\" y2=\"16\"/></svg> POLL</div>' +
      '<div class="poll-question">Loading poll...</div>' +
    '</div>';

  // Async load actual poll data
  setTimeout(function() { _loadAndRenderPoll(pollId); }, 0);

  return html;
}

function _loadAndRenderPoll(pollId) {
  api.get('/polls?id=' + encodeURIComponent(pollId))
    .then(function(res) {
      if (!res.poll) return;
      var el = document.getElementById('poll-' + pollId);
      if (!el) return;
      el.innerHTML = _buildPollHTML(res.poll);
    })
    .catch(function() {});
}

function _buildPollHTML(poll) {
  var meId = STATE.user && STATE.user.id;
  var hasVoted = poll.options.some(function(o) { return o.my_vote; });
  var totalStr = poll.total_voters + ' voter' + (poll.total_voters !== 1 ? 's' : '');

  var closesLabel = '';
  if (poll.closed) {
    closesLabel = '· Closed';
  } else if (poll.closes_at) {
    var diff = new Date(poll.closes_at) - new Date();
    if (diff > 0) {
      var mins = Math.floor(diff / 60000);
      var hrs  = Math.floor(mins / 60);
      closesLabel = hrs > 0 ? '· Closes in ' + hrs + 'h' : '· Closes in ' + mins + 'm';
    }
  }

  var optionsHTML = poll.options.map(function(opt) {
    var isVoted = opt.my_vote;
    var cls = 'poll-opt';
    if (isVoted) cls += ' voted';
    if (poll.quiz_mode && opt.is_correct !== undefined) {
      if (opt.is_correct) cls += ' correct';
      else if (isVoted && !opt.is_correct) cls += ' incorrect-selected';
    }

    var checkIcon = isVoted
      ? (poll.quiz_mode && opt.is_correct !== undefined ? (opt.is_correct ? '✓' : '✗') : '✓')
      : '';
    var votersLine = (poll.show_who_voted && opt.voters && opt.voters.length)
      ? '<div class="poll-voters-line">👁 ' + escHtml(opt.voters.slice(0,3).join(', ')) + (opt.voters.length > 3 ? '...' : '') + '</div>'
      : '';

    var clickHandler = (poll.closed || (!poll.allow_revote && hasVoted && !isVoted))
      ? ''
      : 'onclick="castPollVote(\'' + poll.id + '\',\'' + opt.id + '\',' + !!poll.allow_multiple + ')"';

    return '<div class="' + cls + '" ' + clickHandler + '>' +
      '<div class="poll-opt-fill" style="width:' + (hasVoted || poll.closed ? opt.pct : 0) + '%"></div>' +
      '<div class="poll-opt-row">' +
        '<div class="poll-opt-text">' + escHtml(opt.text) + '</div>' +
        (hasVoted || poll.closed ? '<span class="poll-opt-pct">' + opt.pct + '%</span>' : '') +
        '<div class="poll-opt-check">' + checkIcon + '</div>' +
      '</div>' +
      votersLine +
    '</div>';
  }).join('');

  var footer = '<div class="poll-footer-row">' +
    '<span>' + totalStr + closesLabel + '</span>' +
    (!poll.closed && poll.creator_id === meId
      ? '<button class="poll-close-btn" onclick="closePoll(\'' + poll.id + '\')">Close Poll</button>'
      : '') +
  '</div>';

  var addOptionBtn = (!poll.closed && poll.allow_add_options)
    ? '<button class="poll-add-suggest-btn" onclick="suggestPollOption(\'' + poll.id + '\')">+ Suggest an option</button>'
    : '';

  return '<div style="font-size:.7rem;font-weight:700;color:var(--blue);margin-bottom:.4rem;letter-spacing:.08em";display:flex;align-items:center;gap:.3rem"><svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><line x1=\"12\" y1=\"20\" x2=\"12\" y2=\"10\"/><line x1=\"18\" y1=\"20\" x2=\"18\" y2=\"4\"/><line x1=\"6\" y1=\"20\" x2=\"6\" y2=\"16\"/></svg> POLL' + (poll.quiz_mode ? ' · QUIZ' : '') + '</div>' +
    '<div class="poll-question">' + escHtml(poll.question) + '</div>' +
    (poll.description ? '<div class="poll-description">' + escHtml(poll.description) + '</div>' : '') +
    '<div class="poll-meta-line">' + (poll.anonymous ? '🔒 Anonymous' : '👁 ' + (poll.show_who_voted ? 'Public' : 'Results visible after vote')) + '</div>' +
    optionsHTML +
    addOptionBtn +
    footer;
}

window.castPollVote = function (pollId, optionId, allowMultiple) {
  if (!STATE.user) return toast('⚠ Please sign in first.');

  var el = document.getElementById('poll-' + pollId);
  if (el) {
    var existingVotes = [];
    if (allowMultiple) {
      el.querySelectorAll('.poll-opt.voted').forEach(function(o) {
        var eid = o.dataset.optId;
        if (eid && eid !== optionId) existingVotes.push(eid);
      });
      existingVotes.push(optionId);
    } else {
      existingVotes = [optionId];
    }

    api.put('/polls', { id: pollId, vote: existingVotes })
      .then(function(res) {
        if (res.poll) {
          var el2 = document.getElementById('poll-' + pollId);
          if (el2) el2.innerHTML = _buildPollHTML(res.poll);
        }
      })
      .catch(function(err) { toast('❌ ' + err.message); });
  }
};

window.closePoll = function (pollId) {
  ypConfirm('Close this poll? No more votes will be accepted.', { danger: true, okText: 'Close poll' }).then(function (ok) {
    if (!ok) return;
    api.put('/polls', { id: pollId, close: true })
      .then(function(res) {
        if (res.poll) {
          var el = document.getElementById('poll-' + pollId);
          if (el) el.innerHTML = _buildPollHTML(res.poll);
        }
      })
      .catch(function(err) { toast('❌ ' + err.message); });
  });
};

window.suggestPollOption = function (pollId) {
  ypPrompt('Suggest a new option:', { title: 'New option', placeholder: 'Your option', okText: 'Add' }).then(function (text) {
    if (!text || !text.trim()) return;
    api.put('/polls', { id: pollId, add_option: text.trim() })
    .then(function(res) {
      if (res.poll) {
        var el = document.getElementById('poll-' + pollId);
        if (el) el.innerHTML = _buildPollHTML(res.poll);
      }
    })
    .catch(function(err) { toast('❌ ' + err.message); });
  });
};

/* ══════════════════════════════════
   NEW CHANNEL + CHAT SETTINGS + GROUP PHOTO
══════════════════════════════════ */

window.openNewChannelModal = function () {
  document.getElementById('new-channel-modal').classList.add('open');
};

window.previewNewGroupPhoto = function (e) {
  var file = e.target.files[0];
  if (!file) return;
  var el = document.getElementById('new-group-photo-preview');
  var url = URL.createObjectURL(file);
  el.style.backgroundImage = 'url(' + url + ')';
  el.style.backgroundSize = 'cover';
  el.style.backgroundPosition = 'center';
  el.innerHTML = '';
  el._file = file;
};

window.previewNewChannelPhoto = function (e) {
  var file = e.target.files[0];
  if (!file) return;
  var el = document.getElementById('new-channel-photo-preview');
  var url = URL.createObjectURL(file);
  el.style.backgroundImage = 'url(' + url + ')';
  el.style.backgroundSize = 'cover';
  el.style.backgroundPosition = 'center';
  el.innerHTML = '';
  el._file = file;
};

window.createNewChannel = function () {
  var name = (document.getElementById('new-channel-name') || {}).value || '';
  var desc = (document.getElementById('new-channel-desc') || {}).value || '';
  if (!name.trim()) { toast('Enter a channel name'); return; }

  api.post('/chat/rooms', {
    type: 'channel',
    name: name.trim(),
    description: desc.trim(),
    is_public: true,
    read_only: true,
  })
    .then(function (res) {
      document.getElementById('new-channel-modal').classList.remove('open');
      toast('Channel created!');
      loadChatRooms(function () {
        if (res.room_id) openChatRoom(res.room_id);
      });
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.openChatSettings = function () {
  var isDark = document.documentElement.classList.contains('dark-mode');
  var darkToggle = document.getElementById('cs-dark-toggle');
  if (darkToggle) { if (isDark) darkToggle.classList.add('on'); else darkToggle.classList.remove('on'); }

  // Sync font size
  var savedFont = '';
  try { savedFont = localStorage.getItem('yp_chat_font') || 'md'; } catch(e) { savedFont = 'md'; }
  document.querySelectorAll('.cs-font-btn').forEach(function (b) { b.classList.remove('active'); });
  var activeFont = document.getElementById('cs-font-' + savedFont);
  if (activeFont) activeFont.classList.add('active');

  // Sync read receipts
  var receipts = document.getElementById('cs-receipts-toggle');
  if (receipts) {
    var receiptsOn = true;
    try { receiptsOn = localStorage.getItem('yp_read_receipts') !== '0'; } catch (e) {}
    receipts.classList.toggle('on', receiptsOn);
  }

  document.getElementById('chat-settings-modal').classList.add('open');
};

window.toggleDarkMode = function (toggleEl) {
  toggleEl.classList.toggle('on');
  var isDark = toggleEl.classList.contains('on');
  document.documentElement.classList.toggle('dark-mode', isDark);
  try { localStorage.setItem('yp_dark_mode', isDark ? '1' : '0'); } catch (e) {}
  toast(isDark ? '🌙 Dark mode on' : '☀️ Light mode on');
};

window.toggleReadReceipts = function (toggleEl) {
  toggleEl.classList.toggle('on');
  var on = toggleEl.classList.contains('on');
  try { localStorage.setItem('yp_read_receipts', on ? '1' : '0'); } catch (e) {}
  toast(on ? '✓✓ Read receipts on' : 'Read receipts off');
};

window.setChatFont = function (size, btn) {
  document.querySelectorAll('.cs-font-btn').forEach(function (b) { b.classList.remove('active'); });
  btn.classList.add('active');
  var sizes = { sm: '.88rem', md: '1rem', lg: '1.12rem' };
  var sz = sizes[size] || '1rem';
  // Apply to messages area (container id is 'chat-msgs')
  var msgs = document.getElementById('chat-msgs');
  if (msgs) msgs.style.fontSize = sz;
  try { localStorage.setItem('yp_chat_font', size); } catch (e) {}
  toast('Font size: ' + size);
};

// Admin panel show/hide in hamburger
window._updateHamburgerAdminBtn = function () {
  var sep = document.getElementById('hb-admin-sep');
  var btn = document.getElementById('hb-admin-btn');
  if (sep && btn) {
    var show = isAnyAdmin();
    sep.style.display = show ? 'block' : 'none';
    btn.style.display = show ? 'flex' : 'none';
  }
};

/* ══════════════════════════════════
   CHAT FOLDERS (Telegram-style)
══════════════════════════════════ */
var FOLDER_PRESETS = [
  { id:'__unread__',   name:'Unread',   icon:'🔵', filter:'unread' },
  { id:'__starred__',  name:'Starred',  icon:'⭐', filter:'starred' },
  { id:'__groups__',   name:'Groups',   icon:'👥', filter:'groups' },
  { id:'__channels__', name:'Channels', icon:'📡', filter:'channels' },
  { id:'__private__',  name:'Private',  icon:'💬', filter:'private' },
];

function loadChatFolders() {
  api.get('/chat/folders')
    .then(function (res) {
      CHAT_folders = res.folders || [];
      renderChatFoldersRow();
    })
    .catch(function () {});
}

function renderChatFoldersRow() {
  var row = document.getElementById('chat-folders-row');
  if (!row) return;
  var allFolders = FOLDER_PRESETS.concat(CHAT_folders);
  if (!allFolders.length) { row.style.display = 'none'; return; }
  row.style.display = 'flex';
  row.innerHTML = allFolders.map(function (f) {
    var isActive = CHAT_activeFolder === f.id;
    var unread = _getFolderUnread(f);
    return '<button onclick="setActiveFolder(\'' + f.id + '\')" style="' +
      'display:flex;align-items:center;gap:.3rem;padding:.3rem .7rem;border-radius:16px;border:none;cursor:pointer;font-family:inherit;font-size:.78rem;font-weight:' + (isActive ? '700' : '500') + ';' +
      'background:' + (isActive ? '#1F6F5C' : 'var(--bg3)') + ';' +
      'color:' + (isActive ? '#fff' : 'var(--muted)') + ';white-space:nowrap;flex-shrink:0;transition:all .18s">' +
      '<span>' + f.icon + '</span>' + escHtml(f.name) +
      (unread ? '<span style="background:' + (isActive ? 'rgba(255,255,255,.3)' : '#1F6F5C') + ';color:#fff;border-radius:10px;padding:.05rem .35rem;font-size:.62rem;font-weight:800;min-width:16px;text-align:center">' + (unread > 99 ? '99+' : unread) + '</span>' : '') +
    '</button>';
  }).join('') +
  '<button onclick="openFolderManager()" style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;border:none;background:var(--bg3);color:var(--muted);cursor:pointer;flex-shrink:0;font-size:.9rem;margin-left:.2rem">' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
  '</button>';
}

function _getFolderUnread(f) {
  var rooms = _getFolderRooms(f);
  return rooms.reduce(function (sum, r) { return sum + (r.unread || 0); }, 0);
}

function _getFolderRooms(f) {
  if (f.filter === 'unread') return CHAT_rooms.filter(function (r) { return r.unread > 0; });
  if (f.filter === 'starred') return CHAT_rooms.filter(function (r) { return r.starred; });
  if (f.filter === 'groups') return CHAT_rooms.filter(function (r) { return r.type === 'group'; });
  if (f.filter === 'channels') return CHAT_rooms.filter(function (r) { return r.type === 'channel'; });
  if (f.filter === 'private') return CHAT_rooms.filter(function (r) { return r.type === 'private'; });
  // Custom folder
  var ids = [];
  try { ids = JSON.parse(f.room_ids || '[]'); } catch (e) {}
  return CHAT_rooms.filter(function (r) { return ids.indexOf(r.id) !== -1; });
}

window.setActiveFolder = function (folderId) {
  CHAT_activeFolder = CHAT_activeFolder === folderId ? null : folderId;
  renderChatFoldersRow();
  renderChatList();
};

window.openFolderManager = function () {
  var existing = document.getElementById('folder-manager-modal');
  if (existing) existing.remove();
  var modal = document.createElement('div');
  modal.id = 'folder-manager-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:8000;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;justify-content:center';
  modal.innerHTML =
    '<div style="background:var(--surface);border-radius:20px 20px 0 0;width:100%;max-width:500px;padding:1.25rem;max-height:80vh;overflow-y:auto">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">' +
        '<div style="font-size:.95rem;font-weight:700">📁 Chat Folders</div>' +
        '<button onclick="document.getElementById(\'folder-manager-modal\').remove()" style="background:none;border:none;cursor:pointer;color:var(--muted)">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
      '</div>' +
      '<div style="font-size:.78rem;color:var(--muted);margin-bottom:.75rem">Custom folders help you organize chats, like Telegram.</div>' +
      '<div id="folder-list-items">' +
        CHAT_folders.map(function (f) {
          return '<div style="display:flex;justify-content:space-between;align-items:center;padding:.6rem 0;border-bottom:.5px solid var(--border)">' +
            '<div style="display:flex;align-items:center;gap:.5rem"><span>' + f.icon + '</span><span style="font-size:.85rem">' + escHtml(f.name) + '</span></div>' +
            '<button onclick="deleteFolder(\'' + f.id + '\')" style="background:none;border:none;cursor:pointer;color:#E11D48;padding:.25rem">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>' +
            '</button>' +
          '</div>';
        }).join('') +
      '</div>' +
      '<div style="margin-top:.75rem;display:flex;gap:.5rem">' +
        '<input id="new-folder-name" placeholder="Folder name..." style="flex:1;padding:.5rem .75rem;background:var(--bg3);border:1.5px solid var(--border);border-radius:10px;color:var(--text);font-size:.82rem;outline:none;font-family:inherit">' +
        '<button onclick="createNewFolder()" style="padding:.5rem 1rem;background:#1F6F5C;color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-family:inherit">+ Add</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
  modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
};

window.createNewFolder = function () {
  var name = (document.getElementById('new-folder-name') || {}).value || '';
  if (!name.trim()) return;
  api.post('/chat/folders', { name: name.trim(), icon: '📁', filter: 'custom', room_ids: [], sort_order: CHAT_folders.length })
    .then(function () { loadChatFolders(); document.getElementById('folder-manager-modal').remove(); toast('Folder created!'); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.deleteFolder = function (id) {
  api.del('/chat/folders?id=' + encodeURIComponent(id))
    .then(function () { loadChatFolders(); document.getElementById('folder-manager-modal').remove(); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

/* ══════════════════════════════════
   BOOKMARKS / STARRED MESSAGES
══════════════════════════════════ */
window.bookmarkMessage = function (msgId) {
  if (!CHAT_curRoom) return;
  api.post('/chat/bookmarks', { message_id: msgId, room_id: CHAT_curRoom.id })
    .then(function () { toast('⭐ Bookmarked!'); })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.removeBookmark = function (msgId) {
  api.del('/chat/bookmarks?message_id=' + encodeURIComponent(msgId))
    .then(function () { toast('Removed from bookmarks'); })
    .catch(function () {});
};

window.openBookmarks = function () {
  api.get('/chat/bookmarks')
    .then(function (res) {
      var bms = res.bookmarks || [];
      var modal = document.createElement('div');
      modal.style.cssText = 'position:fixed;inset:0;z-index:8000;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;justify-content:center';
      modal.innerHTML =
        '<div style="background:var(--surface);border-radius:20px 20px 0 0;width:100%;max-width:500px;padding:1.25rem;max-height:80vh;overflow-y:auto">' +
          '<div style="font-size:.95rem;font-weight:700;margin-bottom:.85rem">⭐ Saved Messages</div>' +
          (bms.length ? bms.map(function (b) {
            return '<div style="padding:.6rem 0;border-bottom:.5px solid var(--border)">' +
              '<div style="font-size:.7rem;color:var(--muted);margin-bottom:.2rem">@' + escHtml(b.sender_nick||'') + ' · ' + timeAgo(b.msg_time) + '</div>' +
              '<div style="font-size:.85rem">' + escHtml((b.text||'').slice(0,120)) + '</div>' +
            '</div>';
          }).join('') : '<div style="text-align:center;padding:2rem;color:var(--muted);font-size:.85rem">No saved messages yet</div>') +
          '<button onclick="this.closest(\'div[style*=fixed]\').remove()" style="width:100%;padding:.65rem;background:var(--bg3);border:none;border-radius:10px;cursor:pointer;color:var(--text);font-family:inherit;margin-top:.75rem">Close</button>' +
        '</div>';
      document.body.appendChild(modal);
      modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
    })
    .catch(function () { toast('Could not load bookmarks'); });
};

/* ══════════════════════════════════
   DRAFTS — auto-save
══════════════════════════════════ */
var CHAT_draftTimer = null;
function saveDraft(roomId, text) {
  clearTimeout(CHAT_draftTimer);
  CHAT_draftTimer = setTimeout(function () {
    api.post('/chat/drafts', { room_id: roomId, text: text }).catch(function () {});
    CHAT_drafts[roomId] = text;
  }, 1500);
}

function loadDraft(roomId) {
  var inp = document.getElementById('chat-input');
  if (!inp) return;
  if (CHAT_drafts[roomId]) {
    inp.value = CHAT_drafts[roomId];
    onChatType();
    return;
  }
  api.get('/chat/drafts?room_id=' + encodeURIComponent(roomId))
    .then(function (res) {
      if (res.text && inp) {
        inp.value = res.text;
        CHAT_drafts[roomId] = res.text;
        onChatType();
      }
    }).catch(function () {});
}

/* ══════════════════════════════════
   UNREAD SEPARATOR
══════════════════════════════════ */
function _insertUnreadSeparator(messages) {
  if (!messages.length) return messages;
  var userId = STATE.user && STATE.user.id;
  var firstUnreadIdx = -1;
  for (var i = 0; i < messages.length; i++) {
    if (messages[i].sender_id !== userId && !messages[i].read) {
      firstUnreadIdx = i;
      break;
    }
  }
  if (firstUnreadIdx <= 0) return messages;
  var result = messages.slice();
  result.splice(firstUnreadIdx, 0, { __separator__: true, id: '__unread_sep__' });
  return result;
}

/* ══════════════════════════════════
   GLOBAL SEARCH
══════════════════════════════════ */
var GSEARCH_tab = 'all';
window.openGlobalSearch = function () {
  var existing = document.getElementById('global-search-modal');
  if (existing) existing.remove();
  GSEARCH_tab = 'all';
  var modal = document.createElement('div');
  modal.id = 'global-search-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:8000;background:var(--surface);display:flex;flex-direction:column';
  modal.innerHTML =
    '<div style="display:flex;align-items:center;gap:.5rem;padding:.6rem .75rem;border-bottom:1px solid var(--border);flex-shrink:0">' +
      '<button onclick="document.getElementById(\'global-search-modal\').remove()" style="background:none;border:none;cursor:pointer;color:var(--blue);padding:.3rem">' +
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>' +
      '</button>' +
      '<div style="flex:1;background:var(--bg3);border-radius:10px;display:flex;align-items:center;gap:.4rem;padding:.4rem .75rem">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
        '<input id="global-search-inp" placeholder="Search..." style="flex:1;background:none;border:none;outline:none;font-size:.9rem;color:var(--text);font-family:inherit" oninput="doGlobalSearch()">' +
      '</div>' +
    '</div>' +
    '<div style="display:flex;gap:.3rem;padding:.5rem .65rem;border-bottom:1px solid var(--border);overflow-x:auto;scrollbar-width:none;flex-shrink:0" id="gsearch-tabs">' +
      ['all:All', 'chats:Chats', 'groups:Groups', 'channels:Channels', 'users:Users'].map(function (t) {
        var parts = t.split(':');
        return '<button class="gsearch-tab-btn' + (parts[0] === 'all' ? ' active' : '') + '" data-tab="' + parts[0] + '" onclick="switchGSearchTab(this,\'' + parts[0] + '\')" style="padding:.35rem .85rem;border-radius:14px;border:none;background:' + (parts[0] === 'all' ? 'var(--blue)' : 'var(--bg3)') + ';color:' + (parts[0] === 'all' ? '#fff' : 'var(--muted)') + ';font-size:.78rem;font-weight:600;cursor:pointer;white-space:nowrap">' + parts[1] + '</button>';
      }).join('') +
    '</div>' +
    '<div id="global-search-results" style="flex:1;overflow-y:auto;padding:.5rem">' +
      '<div style="text-align:center;padding:3rem 1rem;color:var(--muted);font-size:.85rem">Type to search across all chats</div>' +
    '</div>';
  document.body.appendChild(modal);
  setTimeout(function () { var i = document.getElementById('global-search-inp'); if (i) i.focus(); }, 100);
};

window.switchGSearchTab = function (btn, tab) {
  GSEARCH_tab = tab;
  document.querySelectorAll('.gsearch-tab-btn').forEach(function (b) {
    var active = b === btn;
    b.classList.toggle('active', active);
    b.style.background = active ? 'var(--blue)' : 'var(--bg3)';
    b.style.color = active ? '#fff' : 'var(--muted)';
  });
  doGlobalSearch();
};

var _globalSearchTimer = null;
window.doGlobalSearch = function () {
  var q = (document.getElementById('global-search-inp') || {}).value || '';
  clearTimeout(_globalSearchTimer);
  var el = document.getElementById('global-search-results');
  if (q.length < 2) {
    if (el) el.innerHTML = '<div style="text-align:center;padding:3rem 1rem;color:var(--muted);font-size:.85rem">Type to search across all chats</div>';
    return;
  }
  el.innerHTML = '<div class="spinner" style="margin:1.5rem auto"></div>';
  _globalSearchTimer = setTimeout(function () { _runGSearch(q); }, 400);
};

function _runGSearch(q) {
  var el = document.getElementById('global-search-results');
  if (!el) return;
  var tab = GSEARCH_tab;
  var qLower = q.toLowerCase();

  var calls = [];
  if (tab === 'all' || tab === 'chats') {
    var localMatches = (CHAT_rooms || []).filter(function (r) {
      return r.joined && (r.nick || '').toLowerCase().indexOf(qLower) !== -1;
    });
    calls.push(Promise.resolve({ kind: 'chats', items: localMatches }));
  }
  if (tab === 'all' || tab === 'groups') {
    calls.push(api.get('/chat/rooms?search=' + encodeURIComponent(q), true)
      .then(function (res) { return { kind: 'groups', items: res.rooms || [] }; })
      .catch(function () { return { kind: 'groups', items: [] }; }));
  }
  if (tab === 'all' || tab === 'channels') {
    calls.push(api.get('/channels?search=' + encodeURIComponent(q), true)
      .then(function (res) { return { kind: 'channels', items: res.channels || [] }; })
      .catch(function () { return { kind: 'channels', items: [] }; }));
  }
  if (tab === 'all' || tab === 'users') {
    calls.push(api.get('/users/search?q=' + encodeURIComponent(q), true)
      .then(function (res) { return { kind: 'users', items: res.users || [] }; })
      .catch(function () { return { kind: 'users', items: [] }; }));
  }
  if (tab === 'all') {
    calls.push(api.get('/chat?search=' + encodeURIComponent(q), true)
      .then(function (res) { return { kind: 'messages', items: res.messages || [] }; })
      .catch(function () { return { kind: 'messages', items: [] }; }));
  }

  Promise.all(calls).then(function (groups) {
    var html = '';
    groups.forEach(function (g) {
      if (!g.items.length) return;
      var label = { chats: 'Your Chats', groups: 'Groups', channels: 'Channels', users: 'Users', messages: 'Messages' }[g.kind];
      html += '<div style="font-size:.68rem;color:var(--muted);font-weight:700;text-transform:uppercase;padding:.5rem .5rem .2rem">' + label + '</div>';
      if (g.kind === 'chats') {
        html += g.items.map(function (r) {
          return '<div style="display:flex;align-items:center;gap:.65rem;padding:.55rem .5rem;cursor:pointer" onclick="document.getElementById(\'global-search-modal\').remove();openChatRoom(\'' + r.id + '\')">' +
            '<div class="chat-av" style="width:38px;height:38px;font-size:.9rem;background:' + avatarColor(r.other_user_id || r.id) + '">' + escHtml((r.nick || '?').slice(0, 1).toUpperCase()) + '</div>' +
            '<div style="font-size:.86rem;font-weight:600">' + escHtml(r.nick || 'Chat') + '</div>' +
          '</div>';
        }).join('');
      } else if (g.kind === 'groups') {
        html += g.items.map(function (r) {
          return '<div style="display:flex;align-items:center;gap:.65rem;padding:.55rem .5rem;cursor:pointer" onclick="document.getElementById(\'global-search-modal\').remove();openChatRoom(\'' + r.id + '\')">' +
            '<div class="chat-av group" style="width:38px;height:38px;font-size:1.1rem;background:' + avatarColor(r.id) + '">' + (r.emoji || '👥') + '</div>' +
            '<div><div style="font-size:.86rem;font-weight:600">' + escHtml(r.nick || 'Group') + '</div><div style="font-size:.68rem;color:var(--muted)">' + (r.members || 0) + ' members</div></div>' +
          '</div>';
        }).join('');
      } else if (g.kind === 'channels') {
        html += g.items.map(function (c) {
          return '<div style="display:flex;align-items:center;gap:.65rem;padding:.55rem .5rem;cursor:pointer" onclick="document.getElementById(\'global-search-modal\').remove();goPage(\'/?channel=\' + encodeURIComponent(\'' + c.owner_id + '\'))">' +
            '<div class="chat-av" style="width:38px;height:38px;font-size:.9rem;background:' + avatarColor(c.owner_id) + '">' + escHtml((c.nickname || '?').slice(0, 1).toUpperCase()) + '</div>' +
            '<div><div style="font-size:.86rem;font-weight:600">@' + escHtml(c.nickname || 'Channel') + '</div><div style="font-size:.68rem;color:var(--muted)">' + fmtN(c.followers || 0) + ' followers</div></div>' +
          '</div>';
        }).join('');
      } else if (g.kind === 'users') {
        html += g.items.map(function (u) {
          return '<div style="display:flex;align-items:center;gap:.65rem;padding:.55rem .5rem;cursor:pointer" onclick="document.getElementById(\'global-search-modal\').remove();openUserProfile(\'' + u.id + '\')">' +
            '<div class="chat-av" style="width:38px;height:38px;font-size:.9rem;background:' + avatarColor(u.id) + '">' + escHtml((u.nickname || '?').slice(0, 1).toUpperCase()) + '</div>' +
            '<div style="font-size:.86rem;font-weight:600">@' + escHtml(u.nickname || 'User') + '</div>' +
          '</div>';
        }).join('');
      } else if (g.kind === 'messages') {
        html += g.items.map(function (m) {
          return '<div style="padding:.65rem .5rem;border-bottom:.5px solid var(--border);cursor:pointer" onclick="document.getElementById(\'global-search-modal\').remove();_openChatRoomAtMsg(\'' + m.room_id + '\',\'' + m.id + '\')">' +
            '<div style="font-size:.7rem;color:var(--muted);margin-bottom:.2rem">@' + escHtml(m.sender_nick||'') + ' in ' + escHtml(m.room_name||'Chat') + ' · ' + timeAgo(m.created_at) + '</div>' +
            '<div style="font-size:.85rem">' + escHtml((m.text||'').slice(0,100)) + '</div>' +
          '</div>';
        }).join('');
      }
    });
    el.innerHTML = html || '<div style="text-align:center;padding:2rem;color:var(--muted);font-size:.85rem">No results found</div>';
  });
}

/* ══════════════════════════════════
   TRANSLATE MESSAGE
══════════════════════════════════ */
window.translateMessage = function (msgId) {
  var msg = CHAT_messages.find(function (m) { return m.id === msgId; });
  if (!msg || !msg.text) { toast('Nothing to translate'); return; }
  var tUrl = 'https://translate.google.com/?sl=auto&tl=en&text=' + encodeURIComponent(msg.text);
  window.open(tUrl, '_blank');
};

/* ══════════════════════════════════
   JUMP TO DATE
══════════════════════════════════ */
window.openJumpToDate = function () {
  if (!CHAT_curRoom) return;
  var existing = document.getElementById('jump-date-modal');
  if (existing) existing.remove();
  var modal = document.createElement('div');
  modal.id = 'jump-date-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:8000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:1.5rem';
  modal.innerHTML =
    '<div style="background:var(--surface);border-radius:16px;padding:1.25rem;width:100%;max-width:320px">' +
      '<div style="font-size:.9rem;font-weight:700;margin-bottom:.85rem">📅 Jump to Date</div>' +
      '<input type="date" id="jump-date-inp" style="width:100%;box-sizing:border-box;padding:.55rem .75rem;background:var(--bg3);border:1.5px solid var(--border);border-radius:10px;color:var(--text);font-size:.9rem;outline:none;margin-bottom:.75rem">' +
      '<div style="display:flex;gap:.5rem">' +
        '<button onclick="doJumpToDate()" style="flex:1;padding:.6rem;background:#1F6F5C;color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-family:inherit">Go</button>' +
        '<button onclick="document.getElementById(\'jump-date-modal\').remove()" style="flex:1;padding:.6rem;background:var(--bg3);border:none;border-radius:10px;cursor:pointer;font-family:inherit">Cancel</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
  modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
};

window.doJumpToDate = function () {
  var dateVal = (document.getElementById('jump-date-inp') || {}).value;
  if (!dateVal) return;
  document.getElementById('jump-date-modal').remove();
  // Find first message on/after that date
  var target = new Date(dateVal).toISOString().split('T')[0];
  var msg = CHAT_messages.find(function (m) { return m.created_at && m.created_at.startsWith(target); });
  if (msg) {
    var el = document.getElementById('msg-' + msg.id);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.background = 'rgba(31,111,92,.1)'; setTimeout(function () { el.style.background = ''; }, 1500); }
    else toast('Message visible — scroll up to find it');
  } else {
    toast('No messages found on that date');
  }
};

/* ══════════════════════════════════
   DISAPPEARING MESSAGES
══════════════════════════════════ */
window.openDisappearingMessages = function () {
  if (!CHAT_curRoom) return;
  var current = CHAT_curRoom.auto_delete_minutes || 0;
  var options = [[0,'Off'],[60,'1 hour'],[1440,'1 day'],[10080,'1 week'],[43200,'1 month']];
  var modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;z-index:8000;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;justify-content:center';
  modal.innerHTML =
    '<div style="background:var(--surface);border-radius:20px 20px 0 0;width:100%;max-width:500px;padding:1.25rem">' +
      '<div style="font-size:.9rem;font-weight:700;margin-bottom:.85rem">⏱ Disappearing Messages</div>' +
      options.map(function (o) {
        return '<div onclick="setAutoDelete(' + o[0] + ',this.closest(\'div[style*=fixed]\')" style="display:flex;align-items:center;justify-content:space-between;padding:.7rem 0;border-bottom:.5px solid var(--border);cursor:pointer">' +
          '<span style="font-size:.88rem">' + o[1] + '</span>' +
          (current === o[0] ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1F6F5C" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '') +
        '</div>';
      }).join('') +
      '<button onclick="this.closest(\'div[style*=fixed]\').remove()" style="width:100%;padding:.6rem;background:var(--bg3);border:none;border-radius:10px;cursor:pointer;font-family:inherit;margin-top:.75rem">Cancel</button>' +
    '</div>';
  document.body.appendChild(modal);
  modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
};

window.setAutoDelete = function (minutes, modalEl) {
  if (!CHAT_curRoom) return;
  api.put('/chat/rooms', { room_id: CHAT_curRoom.id, auto_delete_minutes: minutes })
    .then(function () {
      CHAT_curRoom.auto_delete_minutes = minutes;
      var label = document.getElementById('auto-delete-label');
      if (label) label.textContent = minutes ? (minutes < 60 ? minutes + ' min' : minutes < 1440 ? (minutes/60) + ' hours' : (minutes/1440) + ' days') : 'Off';
      toast(minutes ? '⏱ Auto-delete: ' + (minutes/60 < 1 ? minutes + 'm' : minutes/1440 < 1 ? (minutes/60) + 'h' : (minutes/1440) + 'd') : 'Auto-delete off');
      if (modalEl) modalEl.remove();
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

/* ══════════════════════════════════
   STICKERS — פיקסן CDN לינקס
══════════════════════════════════ */
// Replace broken tenor CDN with working static emoji GIFs via giphy
// STICKER_PACKS defined above

/* ══════════════════════════════════
   FOLDERS FILTER in renderChatList
══════════════════════════════════ */
// Override renderChatList to support folder filtering
var _origRenderChatList = null;

function _applyFolderFilter(rooms) {
  if (!CHAT_activeFolder) return rooms;
  var f = FOLDER_PRESETS.find(function (p) { return p.id === CHAT_activeFolder; }) ||
          CHAT_folders.find(function (f) { return f.id === CHAT_activeFolder; });
  if (!f) return rooms;
  return _getFolderRooms(f).filter(function (r) {
    return rooms.some(function (cr) { return cr.id === r.id; });
  });
}

/* ══════════════════════════════════
   ADD TO CONTEXT MENU
══════════════════════════════════ */
// bookmark + translate are built directly into _buildCtxMenu

/* ══════════════════════════════════
   INIT — load folders on startup
══════════════════════════════════ */
var _origChatInit = window.initChat || function () {};
window.initChat = function () {
  _origChatInit();
  loadChatFolders();
};

/* ══════════════════════════════════
   MULTI-SELECT SYSTEM
══════════════════════════════════ */
var CHAT_selected = {}; // msgId -> true
var CHAT_selectMode = false;

window._toggleSelect = function (msgId) {
  if (!CHAT_selectMode && Object.keys(CHAT_selected).length === 0) return; // only in select mode
  if (CHAT_selected[msgId]) {
    delete CHAT_selected[msgId];
  } else {
    CHAT_selected[msgId] = true;
  }
  var count = Object.keys(CHAT_selected).length;
  if (count === 0) { _exitSelectMode(); return; }
  _updateSelectBar(count);
  // Update visual
  document.querySelectorAll('[data-id]').forEach(function (el) {
    var id = el.dataset.id;
    if (CHAT_selected[id]) el.classList.add('msg-selected');
    else el.classList.remove('msg-selected');
  });
};

function _enterSelectMode(msgId) {
  CHAT_selectMode = true;
  CHAT_selected = {};
  CHAT_selected[msgId] = true;
  _updateSelectBar(1);
  document.querySelectorAll('[data-id="' + msgId + '"]').forEach(function (el) {
    el.classList.add('msg-selected');
  });
}

function _exitSelectMode() {
  CHAT_selectMode = false;
  CHAT_selected = {};
  var bar = document.getElementById('select-action-bar');
  if (bar) bar.style.display = 'none';
  document.querySelectorAll('.msg-selected').forEach(function (el) { el.classList.remove('msg-selected'); });
  var ib = document.getElementById('chat-input-bar');
  if (ib) ib.style.display = 'flex';
}

function _updateSelectBar(count) {
  var bar = document.getElementById('select-action-bar');
  if (!bar) return;
  var ib = document.getElementById('chat-input-bar');
  if (ib) ib.style.display = 'none';
  bar.style.display = 'flex';
  var lbl = document.getElementById('select-count-label');
  if (lbl) lbl.textContent = count + ' message' + (count !== 1 ? 's' : '') + ' selected';
}

window._selectForwardAll = function () {
  var ids = Object.keys(CHAT_selected);
  if (!ids.length) return;
  var msgs = ids.map(function (id) {
    return CHAT_messages.find(function (m) { return m.id === id; });
  }).filter(Boolean);
  _exitSelectMode();
  _showForwardPicker(msgs);
};

function _showForwardPicker(msgs) {
  var modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;justify-content:center';
  var roomList = CHAT_rooms.slice(0, 20).map(function (r) {
    var av = r.photo_url
      ? '<div style="width:40px;height:40px;border-radius:50%;background-image:url(' + r.photo_url + ');background-size:cover;flex-shrink:0"></div>'
      : '<div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--gold),var(--gold-l));display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;flex-shrink:0">' + (r.nick||'?').slice(0,1).toUpperCase() + '</div>';
    return '<div style="display:flex;align-items:center;gap:.65rem;padding:.6rem .85rem;border-bottom:.5px solid var(--border);cursor:pointer" onclick="_forwardMsgsToRoom(\'' + r.id + '\',' + JSON.stringify(msgs.map(function(m){return {type:m.type,text:m.text,media_url:m.media_url};})) + ',this.closest(\'div[style*=fixed]\')">' +
      av +
      '<div style="font-size:.88rem;font-weight:600">' + escHtml(r.nick||'Chat') + '</div>' +
    '</div>';
  }).join('');

  modal.innerHTML =
    '<div style="background:var(--surface);border-radius:20px 20px 0 0;width:100%;max-width:500px;max-height:75vh;display:flex;flex-direction:column">' +
      '<div style="padding:.85rem 1.1rem;border-bottom:1px solid var(--border);font-weight:700;font-size:.92rem">Forward ' + msgs.length + ' message' + (msgs.length>1?'s':'') + ' to...</div>' +
      '<div style="overflow-y:auto;flex:1">' + roomList + '</div>' +
      '<div style="padding:.6rem .75rem;border-top:1px solid var(--border)">' +
        '<button onclick="this.closest(\'div[style*=fixed]\').remove()" style="width:100%;padding:.6rem;background:var(--bg3);border:none;border-radius:10px;cursor:pointer;font-family:inherit">Cancel</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
  modal.addEventListener('click', function(e){ if(e.target===modal) modal.remove(); });
}

window._forwardMsgsToRoom = function (roomId, msgs, modalEl) {
  if (modalEl) modalEl.remove();
  var sent = 0;
  msgs.forEach(function (m, i) {
    setTimeout(function () {
      var payload = { room_id: roomId, type: m.type || 'text', text: (m.text || '') + (sent === 0 ? ' ↩ Forwarded' : '') };
      api.post('/chat', payload)
        .then(function () {
          sent++;
          if (sent === msgs.length) { toast('✅ Forwarded!'); loadChatRooms(); }
        })
        .catch(function () { toast('❌ Forward failed'); });
    }, i * 200);
  });
};

window._selectDeleteAll = function () {
  var ids = Object.keys(CHAT_selected);
  ypConfirm('Delete ' + ids.length + ' messages?', { danger: true, okText: 'Delete' }).then(function (ok) {
    if (!ok) return;
    var promises = ids.map(function (id) {
      return api.del('/chat?id=' + encodeURIComponent(id)).catch(function () {});
    });
    Promise.all(promises).then(function () {
      _exitSelectMode();
      loadMessages(true);
      toast('Deleted ' + ids.length + ' messages');
    });
  });
};

window._selectCopyAll = function () {
  var msgs = Object.keys(CHAT_selected).map(function (id) {
    var m = CHAT_messages.find(function (x) { return x.id === id; });
    return m ? (m.text || '[media]') : '';
  }).filter(Boolean);
  if (navigator.clipboard) navigator.clipboard.writeText(msgs.join('\n'));
  _exitSelectMode();
  toast('Copied!');
};

// Patch long-press to enter select mode — with scroll detection
var _ctxStartX = 0, _ctxStartY = 0, _ctxMoved = false;

// Track touch movement globally to detect scroll
document.addEventListener('touchmove', function (e) {
  if (_ctxTimer) {
    var t = e.touches[0];
    var dx = Math.abs(t.clientX - _ctxStartX);
    var dy = Math.abs(t.clientY - _ctxStartY);
    if (dx > 8 || dy > 8) {
      _ctxMoved = true;
      clearTimeout(_ctxTimer);
      _ctxTimer = null;
    }
  }
}, { passive: true });

var _origCtxTouchStart = window._ctxTouchStart;
window._ctxTouchStart = function (e, msgId) {
  var t = e.touches && e.touches[0];
  _ctxStartX = t ? t.clientX : 0;
  _ctxStartY = t ? t.clientY : 0;
  _ctxMoved = false;

  clearTimeout(_ctxTimer);
  _ctxTimer = setTimeout(function () {
    if (_ctxMoved) return; // user was scrolling — ignore
    if (CHAT_selectMode || Object.keys(CHAT_selected).length > 0) {
      _toggleSelect(msgId);
    } else {
      _enterSelectMode(msgId);
      renderMessages(false);
    }
  }, 500);
};

/* ══════════════════════════════════
   MEDIA ALBUM GROUPING
══════════════════════════════════ */
function _groupMediaAlbums(messages) {
  // Returns map of msgId -> albumInfo {ids, index, total}
  var result = {};
  var i = 0;
  while (i < messages.length) {
    var m = messages[i];
    if (m.type === 'media' && m.media_url && m.text !== '__once__') {
      var group = [m.id];
      var senderId = m.sender_id;
      var j = i + 1;
      while (j < messages.length) {
        var next = messages[j];
        if (next.type === 'media' && next.media_url && next.text !== '__once__' &&
            next.sender_id === senderId &&
            (!next.text || next.text === '') &&
            group.length < 10) {
          group.push(next.id);
          j++;
        } else break;
      }
      if (group.length > 1) {
        group.forEach(function (id, idx) {
          result[id] = { ids: group, index: idx, total: group.length };
        });
        i = j;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }
  return result;
}

/* ══════════════════════════════════
   CHANNEL INPUT BAR HIDE/SHOW
══════════════════════════════════ */
// Patch openChatRoom to hide input for channels (non-admin/non-owner)
var _origOpenChatRoom = window.openChatRoom;
window._applyChannelInputState = function (room) {
  var ib = document.getElementById('chat-input-bar');
  var recBar = document.getElementById('rec-live-bar');
  var recLock = document.getElementById('rec-lock-indicator');
  if (!room || room.type !== 'channel') {
    if (ib) ib.style.display = 'flex';
    return;
  }
  // Channel: only admins and channel admins can post
  var userId = STATE.user && STATE.user.id;
  var channelAdmins = [];
  try { channelAdmins = JSON.parse(room.channel_admins || '[]'); } catch(e) {}
  var canPost = isAnyAdmin() || room.is_group_admin || channelAdmins.indexOf(userId) !== -1;
  if (ib) ib.style.display = canPost ? 'flex' : 'none';
  if (recBar) recBar.classList.remove('show');
  if (recLock) recLock.classList.remove('show');
};

/* ══════════════════════════════════
   SHARE MESSAGE
══════════════════════════════════ */
window._shareMsg = function (msgId) {
  var msg = CHAT_messages.find(function (m) { return m.id === msgId; });
  if (!msg) return;
  var text = msg.text || msg.media_url || '';
  if (navigator.share) {
    navigator.share({ text: text, url: msg.media_url || '' }).catch(function () {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text);
    toast('Copied to clipboard!');
  }
};

/* ══════════════════════════════════
   GROUP JOIN LINK PREVIEW
══════════════════════════════════ */
// Detect yidplus join links and render rich preview
function _detectJoinLink(text) {
  var m = (text || '').match(/yidplus(?:\.com|\.pages\.dev)[^\s]*[?&]join=([a-z0-9-]+)/i);
  return m ? m[1] : null;
}

var _joinLinkCache = {};
function _loadJoinLinkPreview(msgId, inviteCode) {
  if (_joinLinkCache[inviteCode] === 'loading') return;
  _joinLinkCache[inviteCode] = 'loading';
  api.get('/chat/rooms?invite=' + encodeURIComponent(inviteCode))
    .then(function (res) {
      var room = res.room;
      if (!room) return;
      _joinLinkCache[inviteCode] = room;
      var el = document.getElementById('lp-' + msgId);
      if (!el) return;
      var photoHtml = room.photo_url
        ? '<img src="' + escHtml(room.photo_url) + '" style="width:48px;height:48px;border-radius:12px;object-fit:cover;flex-shrink:0" loading="lazy">'
        : '<div style="width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#1F6F5C,#2B8A73);display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.3rem;flex-shrink:0">👥</div>';
      el.style.display = 'block';
      el.innerHTML =
        '<div style="display:flex;align-items:center;gap:.65rem;padding:.65rem;background:var(--bg3);border-radius:10px">' +
          photoHtml +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:.88rem;font-weight:700;color:var(--text)">' + escHtml(room.name || 'Group') + '</div>' +
            '<div style="font-size:.72rem;color:var(--muted);margin-top:.1rem">' + (room.members || 0) + ' members · ' + (room.type || 'group') + '</div>' +
          '</div>' +
          '<button onclick="joinViaInvite(\'' + escHtml(inviteCode) + '\')" style="padding:.35rem .85rem;background:linear-gradient(135deg,#1F6F5C,#2B8A73);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:.78rem;font-weight:700;font-family:inherit;white-space:nowrap">Join</button>' +
        '</div>';
    })
    .catch(function () { _joinLinkCache[inviteCode] = null; });
}

window.joinViaInvite = function (inviteCode) {
  api.post('/chat/join', { invite_code: inviteCode })
    .then(function (res) {
      toast('Joined!');
      loadChatRooms(function () {
        if (res.room_id) openChatRoom(res.room_id);
      });
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window._viewChatPartnerStatus = function () {
  if (!CHAT_curRoom || CHAT_curRoom.type === 'group') return;
  var otherUserId = CHAT_curRoom.other_user_id || CHAT_curRoom.id;
  api.get('/statuses?user_id=' + encodeURIComponent(otherUserId), true)
    .then(function (res) {
      var data = (res.statuses || [])[0];
      if (!data || !data.slides || !data.slides.length) {
        // No status — go to their profile instead
        if (typeof openUserProfile === 'function') openUserProfile(otherUserId);
        return;
      }
      if (typeof HOME_svStatuses !== 'undefined') {
        window.HOME_svStatuses = [data];
        if (typeof openSV === 'function') openSV(0);
      }
    })
    .catch(function () {});
};

window._handleStatusButtonTap = function () {
  if (!STATE.user) { toast('⚠ Please sign in first.'); return; }
  // This button is for writing a new status — always opens the composer.
  // To see statuses already posted, use the "View mine" link inside it,
  // or _viewMyOwnStatus() from elsewhere (e.g. the avatar ring).
  openStatusUpload();
};

// Explicit, separate action: view the statuses I've already posted.
window._viewMyOwnStatus = function () {
  if (!STATE.user) { toast('⚠ Please sign in first.'); return; }
  var url = CONFIG.API_BASE + '/statuses?user_id=' + encodeURIComponent(STATE.user.id);
  fetch(url, { credentials: 'include' })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      var data = (res.statuses || [])[0];
      if (data && data.slides && data.slides.length) {
        HOME_svStatuses = [data];
        openSV(0);
      } else {
        toast('דו האסט נאך נישט קיין סטאטוס');
      }
    })
    .catch(function () { toast('⚠ Could not load your status.'); });
};

window._goAddStatus = function () {
  openStatusUpload();
};

window._viewChatListAvatarStatus = function (userId) {
  api.get('/statuses?user_id=' + encodeURIComponent(userId), true)
    .then(function (res) {
      var data = (res.statuses || [])[0];
      if (!data || !data.slides || !data.slides.length) {
        toast('הסטאטוס איז שוין נישט אקטיוו');
        loadChatRooms(); // refresh so the stale ring disappears
        return;
      }
      HOME_svStatuses = [data];
      openSV(0);
    })
    .catch(function (err) {
      console.error('status open failed:', err);
      toast('קען נישט לאדן: ' + (err && err.message ? err.message : 'unknown error'));
    });
};

// ══════════════════════════════════
// WhatsApp-style segmented status ring SVG
// Draws `count` arc segments around a circle, with gaps between them.
// ══════════════════════════════════
function _svSegments(count, isMine) {
  count = Math.max(1, count || 1);
  var size = 86, cx = size / 2, cy = size / 2, r = size / 2 - 3;
  var gapDeg = count > 1 ? 8 : 0;
  var segDeg = (360 - gapDeg * count) / count;
  var segs = '';
  var startAngle = -90; // start at top
  for (var i = 0; i < count; i++) {
    var a0 = startAngle + i * (segDeg + gapDeg);
    var a1 = a0 + segDeg;
    var rad0 = (a0 * Math.PI) / 180;
    var rad1 = (a1 * Math.PI) / 180;
    var x0 = cx + r * Math.cos(rad0);
    var y0 = cy + r * Math.sin(rad0);
    var x1 = cx + r * Math.cos(rad1);
    var y1 = cy + r * Math.sin(rad1);
    var largeArc = segDeg > 180 ? 1 : 0;
    var color = isMine ? '#999' : 'var(--blue, #1F6F5C)';
    segs += '<path d="M ' + x0.toFixed(2) + ' ' + y0.toFixed(2) +
      ' A ' + r + ' ' + r + ' 0 ' + largeArc + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2) + '" ' +
      'stroke="' + color + '" stroke-width="2.5" fill="none" stroke-linecap="round"/>';
  }
  return segs;
}
window._svSegments = _svSegments;
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

  var nickEl = document.getElementById('sv-nick');
  var timeEl = document.getElementById('sv-time');
  if (nickEl) nickEl.textContent = '@' + (s.nickname || 'User');
  if (timeEl) timeEl.textContent = slide.created_at ? timeAgo(slide.created_at) : 'now';

  // Track view — send to server (only for other people's statuses)
  var myId = STATE.user && STATE.user.id;
  var isMySlide = s.user_id === myId;
  if (slide.id && !isMySlide) {
    api.put('/statuses', { view: true, id: slide.id }).catch(function () {});
    // Increment local view count for immediate feedback
    if (slide.views !== undefined) slide.views = (slide.views || 0) + 1;
  }
  var viewsRow = document.getElementById('sv-views-row');
  var viewsCount = document.getElementById('sv-views-count');
  if (viewsRow) viewsRow.style.display = isMySlide ? 'flex' : 'none';
  if (viewsCount && isMySlide) viewsCount.textContent = fmtN(slide.views || 0);

  // ── Progress bars ──
  var barsEl = document.getElementById('sv-bars');
  if (barsEl) barsEl.innerHTML = s.slides.map(function (_, j) {
    return '<div class="sv-bar"><div class="sv-bar-fill' + (j < HOME_svSlideIdx ? ' done' : '') + '" id="svbar-' + j + '"></div></div>';
  }).join('');

  // ── Like button state ──
  var likeBtn = document.getElementById('sv-like-btn');
  if (likeBtn) likeBtn.textContent = slide.i_reacted ? '❤️' : '🤍';

  // ── Slide content ──
  var el = document.getElementById('sv-slide');
  if (!el) return;
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
  var moreMenu = document.getElementById('sv-more-menu');
  var reactBar = document.getElementById('sv-reaction-bar');
  if (moreMenu) moreMenu.style.display = 'none';
  if (reactBar) reactBar.style.display = 'none';
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
  _safeCls('sv-highlights-modal','add','open');
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
  _safeCls('sv-privacy-modal','add','open');
};
window.setSVPrivacy = function (val) {
  HOME_svPrivacy = val;
};
window.saveSVPrivacy = function () {
  _safeCls('sv-privacy-modal','remove','open');
  toast('🔒 Privacy saved: ' + HOME_svPrivacy);
  svResume();
};

window.svDeleteCurrent = function () {
  var s = HOME_svStatuses[HOME_svUserIdx];
  if (!s) return;
  var slide = s.slides[HOME_svSlideIdx];
  if (!slide || !slide.id) return;
  ypConfirm('Delete this status?', { danger: true, okText: 'Delete' }).then(function (ok) {
    if (!ok) return;

    var slideId = slide.id;

    // Remove from local cache immediately
    s.slides.splice(HOME_svSlideIdx, 1);
    if (!s.slides.length) {
      HOME_svStatuses.splice(HOME_svUserIdx, 1);
      closeSV();
      toast('🗑 Status deleted.');
    } else {
      HOME_svSlideIdx = Math.min(HOME_svSlideIdx, s.slides.length - 1);
      _svShowSlide();
      toast('🗑 Slide deleted.');
    }

    // Delete on server
    api.put('/statuses', { action: 'delete', id: slideId })
      .catch(function (err) { toast('⚠ Could not delete: ' + err.message); });
  });
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

  // Show a quick link to view the status they already posted, if any —
  // keeps this modal purely for writing while still giving one-tap access.
  var viewLink = document.getElementById('st-view-mine-link');
  if (viewLink && STATE.user) {
    api.get('/statuses?user_id=' + encodeURIComponent(STATE.user.id), true)
      .then(function (res) {
        var data = (res.statuses || [])[0];
        viewLink.style.display = (data && data.slides && data.slides.length) ? 'flex' : 'none';
      })
      .catch(function () { viewLink.style.display = 'none'; });
  }
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
      .then(function () { closeStatusModal(); toast('✅ Status posted!'); try { delete _apiCache; } catch(e) {} })
      .catch(function (err) { toast('❌ ' + err.message); });

  } else if (STATUS_selectedFile) {
    var caption = (document.getElementById('status-media-caption') || {}).value || '';
    var privacy2 = (document.getElementById('status-privacy') || {}).value || 'public';
    toast('📤 Preparing...');
    watermarkFile(STATUS_selectedFile).then(function (watermarked) {
      var form = new FormData();
      form.append('type', 'media');
      form.append('media', watermarked);
      form.append('caption', caption);
      form.append('privacy', privacy2);
      return api.post('/statuses', form, true);
    })
      .then(function () { closeStatusModal(); toast('✅ Status posted!'); try { delete _apiCache; } catch(e) {} })
      .catch(function (err) { toast('❌ ' + err.message); });
  } else {
    toast('⚠ Choose Text or Photo/Video first.');
  }
};

// Alias for status reload after posting
window.loadStatuses = function () {
  // Refresh status FAB ring if on private tab
  var fab = document.getElementById('status-fab-btn');
  if (fab) {
    // Brief flash to indicate success
    fab.style.boxShadow = '0 0 0 3px var(--blue)';
    setTimeout(function () { fab.style.boxShadow = ''; }, 1500);
  }
};

// When the user returns to the tab, refresh the open room immediately so they
// see anything that arrived while polling was paused. Bound once.
if (!window._chatVisBound) {
  window._chatVisBound = true;
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && typeof CHAT_curRoom !== 'undefined' && CHAT_curRoom && typeof loadMessages === 'function') {
      loadMessages(false);
    }
  });
}
