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
  TG_curChannel = null;
  if (typeof _tgStopLivePoll === 'function') _tgStopLivePoll();
  var _jb = document.getElementById('tg-join-bar');
  if (_jb) _jb.remove();   // a Telegram channel's Join bar shouldn't outlive it
  // Only rewrite the URL if we're not already being driven BY the URL — when
  // Back fires, the browser has already moved, and touching history here would
  // fight it.
  if (!_navFromPop) { try { history.replaceState(null, '', location.pathname); } catch (e) {} }
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

  if (wantRoom) {
    // Show the chat-room screen right away so a refresh doesn't flash the chat
    // list and then animate back into the room — you just stay inside it.
    var scList = document.getElementById('screen-chats');
    var scRoom = document.getElementById('screen-chatroom');
    if (scList) scList.classList.add('hidden');
    if (scRoom) scRoom.classList.remove('hidden');
    // A quiet loading state so the room screen isn't blank while rooms load.
    var msgsEl = document.getElementById('chat-msgs');
    if (msgsEl) msgsEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted)"><div class="spinner" style="width:26px;height:26px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite"></div></div>';
  }

  loadChatRooms(wantRoom ? function () {
    if (CHAT_rooms.find(function (r) { return r.id === wantRoom; })) {
      window.openChatRoom(wantRoom);
    } else {
      // Room isn't available — fall back to the list instead of a blank screen.
      var scList2 = document.getElementById('screen-chats');
      var scRoom2 = document.getElementById('screen-chatroom');
      if (scList2) scList2.classList.remove('hidden');
      if (scRoom2) scRoom2.classList.add('hidden');
    }
  } : null);
};

// ============================================================
// CHAT LIST
// ============================================================
var CHAT_activeStatusUserIds = new Set();

function loadChatRooms(callback) {
  var el = document.getElementById('chat-list-area');
  // Only show the spinner on the very FIRST load. On background refreshes the
  // list already has data, so replacing it with a spinner every few seconds is
  // what made the whole list visibly "spin"/reload. Keep the current list on
  // screen and let renderChatList patch it only when something changed.
  if (el && !CHAT_rooms.length) el.innerHTML = '<div class="feed-state"><div class="spinner"></div><div>Loading chats...</div></div>';

  Promise.all([
    api.get('/chat/rooms'),
    api.get('/statuses', true).catch(function () { return { statuses: [] }; }),
  ])
    .then(function (resArr) {
      var res = resArr[0];
      var statusRes = resArr[1];
      CHAT_rooms = res.rooms || [];
      if (typeof _applyLocalSeen === 'function') _applyLocalSeen();
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

  // Keep the Chats nav badge in sync with total unread (skip muted chats).
  _refreshChatNavBadge();

  var filtered = CHAT_rooms.filter(function (c) {
    var tabOk = CHAT_tab === 'all' ||
      (CHAT_tab === 'private'  && c.type === 'private') ||
      (CHAT_tab === 'groups'   && c.type === 'group') ||
      (CHAT_tab === 'channels' && c.type === 'channel');
    var srchOk = !CHAT_search ||
      (c.nick || '').toLowerCase().indexOf(CHAT_search.toLowerCase()) !== -1;
    // Hide a private chat that has no messages yet — e.g. you tapped "Message"
    // on someone but never wrote anything. It reappears the moment a message
    // exists. The currently open room is always kept.
    var emptyDM = c.type === 'private' && c.has_messages === false &&
      !(CHAT_curRoom && CHAT_curRoom.id === c.id);
    return tabOk && srchOk && !emptyDM;
  });

  // Apply folder filter if active
  if (CHAT_activeFolder) {
    filtered = _applyFolderFilter(filtered);
  }

  // Embedded Telegram channels sit alongside real ones — but only the ones you
  // joined, the same way Telegram only lists channels you're in. Finding a new
  // one is what the search button is for (it lists them with a Join), or a link
  // shared in a group.
  var tgHtml = '';
  if ((CHAT_tab === 'channels' || CHAT_tab === 'all') && !CHAT_activeFolder && CHAT_tgChannels && CHAT_tgChannels.length) {
    tgHtml = CHAT_tgChannels
      .filter(function (t) { return t.joined; })
      // A channel that just posted belongs at the top, like any other chat.
      .sort(function (a, b) { return (b.last_post_at || '').localeCompare(a.last_post_at || ''); })
      .map(_tgChannelRow).join('');
  }

  if (!filtered.length && !tgHtml) {
    el.innerHTML =
      _aiChatRow() +
      '<div class="feed-state">' +
        '<div style="font-size:2.5rem">💬</div>' +
        '<div>No chats yet</div>' +
        '<div style="font-size:.75rem;color:var(--muted)">Tap ✏️ to start a chat or 👥 to create a group</div>' +
      '</div>';
    return;
  }

  // Only touch the DOM when something actually changed — otherwise the 6s poll
  // would re-render the whole list every time and make it visibly flicker/jump.
  // (online/presence is deliberately excluded so people going on/offline doesn't
  // trigger a re-render.)
  var _sig = CHAT_tab + '|' + (CHAT_search || '') + '|' + (CHAT_activeFolder || '') + '|' + tgHtml.length + '|' +
    filtered.map(function (c) {
      return c.id + ':' + (c.unread || 0) + ':' + (c.preview || '') + ':' + (c.last_time || '') + ':' + (c.muted ? 1 : 0) + ':' + (c.photo_url || '');
    }).join(',');
  if (_sig === window._lastChatListSig && el.children.length) return;
  window._lastChatListSig = _sig;
  var _savedScroll = el.scrollTop;

  el.innerHTML = _aiChatRow() + filtered.map(function (c) {
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
    // Show the initial only when there's no photo. When a photo is set it
    // fills the avatar (with the gradient as a fallback if it fails to load),
    // so we don't want the letter sitting on top of the picture.
    var avatarContent = hasPhoto ? '' : initial;
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
      '<div class="chat-item-delete" onclick="event.stopPropagation();deleteChatRoom(\'' + c.id + '\',\'' + escJs((c.nick || 'Chat')) + '\')"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg></div>' +
      '<div class="chat-item' + (c.unread ? ' unread' : '') + '" onclick="_chatItemClick(this,\'' + c.id + '\')">' +
        '<div class="' + avClass + '" style="' + avStyle + '"' + avatarClickAttr + '>' + avatarContent + onlineDot + '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:.18rem;gap:.4rem">' +
            '<div style="font-size:.94rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;unicode-bidi:plaintext;text-align:left;flex:1">' + escHtml(c.nick || 'Chat') + '</div>' +
            '<div style="display:flex;align-items:center;gap:.3rem;flex-shrink:0">' + muteIcon + '<div style="font-size:.68rem;color:var(--muted)">' + timeText + '</div></div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:.4rem">' +
            '<div style="font-size:.83rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;unicode-bidi:plaintext;text-align:left;flex:1;font-weight:' + (c.unread ? '500' : '400') + '">' + previewHtml + '</div>' +
            unreadBadge +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('') + tgHtml;

  // Keep the user where they were — replacing innerHTML resets scrollTop to 0,
  // which would jump the list to the top whenever a new message arrived.
  if (_savedScroll) el.scrollTop = _savedScroll;

  _attachChatSwipeGestures();
}

// ── Embedded Telegram channels (public, read-only) ──
var CHAT_tgChannels = [];
var CHAT_tgPollTimer = null;
function _loadTgChannels() {
  api.get('/telegram-channels').then(function (res) {
    CHAT_tgChannels = (res && res.channels) || [];
    if (CHAT_tab === 'channels' || CHAT_tab === 'all') renderChatList();
  }).catch(function () {});

  // The worker syncs once a minute, so re-check on that beat — otherwise a new
  // post would sit there with no badge until the page was reloaded. Skip it
  // while a channel is open, since that view marks itself read anyway.
  if (!CHAT_tgPollTimer) {
    CHAT_tgPollTimer = setInterval(function () {
      if (document.hidden || TG_curChannel) return;
      api.get('/telegram-channels').then(function (res) {
        CHAT_tgChannels = (res && res.channels) || [];
        if (CHAT_tab === 'channels' || CHAT_tab === 'all') renderChatList();
      }).catch(function () {});
    }, 60000);
  }
}
function _tgChannelRow(t) {
  var title = escHtml(t.title || t.username);
  var uname = escHtml(t.username);
  var av = t.photo_url
    ? '<div class="chat-av chat-av-square" style="background-image:url(' + t.photo_url + ');background-size:cover;background-position:center"></div>'
    : '<div class="chat-av chat-av-square" style="background:#229ED9;color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.1rem">📨</div>';

  // A row you've joined reads like any other chat: last message and when.
  // A search hit you haven't joined shows what it is and offers to join.
  var preview = t.joined
    ? (t.last_text ? escHtml(t.last_text.slice(0, 60))
       : t.last_media ? ({ photo: '📷 Photo', video: '🎥 Video', audio: '🎵 Audio' }[t.last_media] || '📎 File')
       : _tgMembersLabel(t.members))
    : _tgMembersLabel(t.members);

  var when = '';
  if (t.joined && t.last_post_at) { try { when = _fmt12(t.last_post_at); } catch (e) {} }

  var right = t.unread
    ? '<div style="min-width:20px;height:20px;border-radius:10px;background:var(--blue);color:#fff;font-size:.62rem;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px;flex-shrink:0">' + (t.unread > 99 ? '99+' : t.unread) + '</div>'
    : (!t.joined ? '<button onclick="event.stopPropagation();tgQuickJoin(\'' + uname + '\',this)" style="background:#229ED9;color:#fff;border:none;border-radius:14px;padding:.2rem .7rem;font-size:.68rem;font-weight:700;cursor:pointer;flex-shrink:0">Join</button>' : '');

  return '<div class="chat-item-wrap" data-tg="' + uname + '">' +
    '<div class="chat-item' + (t.unread ? ' unread' : '') + '" onclick="openTelegramChannel(\'' + uname + '\',\'' + escJs(title) + '\')">' +
      av +
      '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:.18rem;gap:.4rem">' +
          '<div style="font-size:.94rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;text-align:left;unicode-bidi:plaintext;direction:ltr">' + title + '</div>' +
          (when ? '<div style="font-size:.68rem;color:var(--muted);flex-shrink:0">' + when + '</div>' : '') +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:.4rem">' +
          '<div style="font-size:.83rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;unicode-bidi:plaintext;font-weight:' + (t.unread ? '500' : '400') + '">' + preview + '</div>' +
          right +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div>';
}

// Join straight from a search hit, without opening the channel first.
window.tgQuickJoin = function (username, btn) {
  btn.disabled = true;
  btn.textContent = '…';
  api.post('/telegram-join', { username: username }).then(function (res) {
    if (res.error) { toast('❌ ' + res.error); btn.disabled = false; btn.textContent = 'Join'; return; }
    for (var i = 0; i < (CHAT_tgChannels || []).length; i++) {
      if (CHAT_tgChannels[i].username === username) {
        CHAT_tgChannels[i].joined = res.joined;
        CHAT_tgChannels[i].members = res.members;
      }
    }
    toast('✅ Joined');
    renderChatList();
  }).catch(function (e) { toast('❌ ' + e.message); btn.disabled = false; btn.textContent = 'Join'; });
};

// Open a Telegram channel as a read-only viewer (no composer), embedding the
// channel's live feed straight from Telegram (t.me/s/<username>).
window.openTelegramChannel = function (username, title) {
  var screenChats    = document.getElementById('screen-chats');
  var screenChatroom = document.getElementById('screen-chatroom');
  if (screenChats)    screenChats.classList.add('hidden');
  if (screenChatroom) screenChatroom.classList.remove('hidden');

  CHAT_curRoom = null; // not a real room
  try {
    if ((location.hash || '').indexOf('#tg=' + username) === -1) {
      history.pushState({ view: 'tg', id: username }, '', '#tg=' + encodeURIComponent(username));
    }
  } catch (e) {}

  // Header — photo, name, and how many people joined here on YID PLUS.
  var meta = null;
  for (var i = 0; i < (CHAT_tgChannels || []).length; i++) {
    if (CHAT_tgChannels[i].username === username) { meta = CHAT_tgChannels[i]; break; }
  }
  var nameEl = document.getElementById('cr-name');
  if (nameEl) nameEl.textContent = (meta && meta.title) || title || ('@' + username);
  var statusEl = document.getElementById('cr-status');
  if (statusEl) statusEl.textContent = _tgMembersLabel(meta ? meta.members : 0);
  var avEl = document.getElementById('cr-avatar');
  if (avEl) {
    if (meta && meta.photo_url) {
      avEl.textContent = '';
      avEl.style.backgroundImage = 'url(' + meta.photo_url + ')';
      avEl.style.backgroundSize = 'cover';
      avEl.style.backgroundPosition = 'center';
    } else {
      avEl.style.background = '#229ED9';
      avEl.style.backgroundImage = '';
      avEl.textContent = '📨';
    }
  }
  TG_curChannel = username;
  TG_curTitle = (meta && meta.title) || title || username;

  // Reactions load alongside the posts so the pills are right on first paint.
  TG_reactions = {};
  api.get('/telegram-reactions?username=' + encodeURIComponent(username))
    .then(function (res) { TG_reactions = (res && res.reactions) || {}; _tgRerender(); })
    .catch(function () {});

  // Opening the channel reads it, exactly like opening a chat does. Clear the
  // cached count first so the list is right the moment you go back, rather than
  // waiting on the round-trip.
  if (meta) meta.unread = 0;
  api.post('/telegram-read', { username: username }).catch(function () {});
  if (typeof renderChatList === 'function') renderChatList();

  // Read-only: no composer. In its place, a Join bar — this is how someone
  // follows the channel here on YID PLUS.
  var bar = document.getElementById('chat-input-bar');
  if (bar) bar.style.display = 'none';
  var _roBar = document.getElementById('readonly-bar');
  if (_roBar) _roBar.style.display = 'none';
  _tgRenderJoinBar(username, meta);

  // Body → Telegram feed via the OFFICIAL widget (t.me/s iframes are X-Frame
  // blocked). Laid out like a chat: oldest at the top, newest at the bottom.
  var msgs = document.getElementById('chat-msgs');
  if (!msgs) return;
  msgs.innerHTML =
    '<div style="height:100%;display:flex;flex-direction:column;position:relative">' +
      '<div id="tg-feed-scroll" style="flex:1;overflow-y:auto;background:linear-gradient(180deg,#c5d3e8 0%,#d7e0ec 100%);background-attachment:local;padding:.6rem .5rem 1rem">' +
        '<div id="tg-feed-slot" style="max-width:640px;margin:0 auto"></div>' +
        '<div id="tg-feed-state" style="text-align:center;color:var(--muted);font-size:.85rem;padding:2rem 1rem">Loading posts…</div>' +
      '</div>' +
      // Jump-to-latest, like the chat screen. Hidden until you scroll up.
      '<button id="tg-jump" onclick="_tgScrollBottom()" style="display:none;position:absolute;right:12px;bottom:14px;width:44px;height:44px;border-radius:50%;border:none;background:var(--surface);box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:pointer;align-items:center;justify-content:center;color:var(--text)">' +
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>' +
        '<span id="tg-jump-badge" style="display:none;position:absolute;top:-4px;right:-4px;min-width:19px;height:19px;border-radius:10px;background:#229ED9;color:#fff;font-size:.66rem;font-weight:700;line-height:19px;padding:0 5px"></span>' +
      '</button>' +
    '</div>';

  // Two ways to show a channel:
  //  'stored' (default) — render what the sync copied into D1/R2. We build every
  //     post ourselves, so there is no Telegram branding or outbound link, it
  api.get('/telegram-ingest?username=' + encodeURIComponent(username)).then(function (res) {
    var slot = document.getElementById('tg-feed-slot');
    var state = document.getElementById('tg-feed-state');
    if (!slot) return;
    var posts = (res && res.posts) || [];
    if (!posts.length) {
      if (state) state.innerHTML = '⏳ <b>Fetching posts from Telegram…</b>' +
        '<br><span style="font-size:.78rem">A newly-added channel takes a few minutes to pull its history. This page updates on its own — no need to refresh.</span>' +
        '<br><span style="font-size:.72rem;color:var(--muted)">Make sure it\'s a public @username (a private t.me/+ link can\'t be synced).</span>' +
        '<br><br><a href="https://t.me/' + encodeURIComponent(username) + '" target="_blank" style="color:#229ED9;font-weight:600">Open @' + username + ' in Telegram →</a>';
      TG_posts = [];
      _tgStartLivePoll(username);   // so the first posts appear live once synced
      return;
    }
    if (state) state.remove();

    // The API hands them back newest-first; a chat reads the other way round.
    var ordered = posts.slice().sort(function (a, b) { return a.tg_msg_id - b.tg_msg_id; });
    TG_posts = ordered;   // the media viewer pages through these

    slot.innerHTML = _tgRenderPosts(ordered, username, title);
    _tgInitScroll(ordered.length);
    _tgLoadLinkPreviews();
    _tgStartLivePoll(username);   // keep the open channel live
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

  // Bold, links and italics come as ranges alongside the text — see _tgFormat.
  var text = p.text ? _tgFormat(p.text, p.entities) : '';

  // Where the file comes from. A stored copy (R2) wins if we have one; if not,
  // stream it straight from Telegram through the worker — the file is never
  // downloaded or stored anywhere, and the player pulls it a slice at a time.
  var src = p.media_url;
  if (!src && p.media_type) {
    var base = (window.STATE && STATE.settings && STATE.settings.tg_stream_base) || TG_STREAM_BASE;
    if (base) src = base.replace(/\/$/, '') + '/media?ch=' + encodeURIComponent(username) + '&id=' + p.tg_msg_id;
  }

  // Channel media is streamed from Telegram, never uploaded here, so the canvas
  // watermark used at upload time can't apply — baking it in would mean
  // re-encoding every file, far past what one request can do. An overlay puts
  // the mark on screen for free. It rides on top rather than being part of the
  // file, so a saved copy won't carry it.
  var stamp = '<div style="position:absolute;right:6px;bottom:6px;background:rgba(0,0,0,.45);color:#fff;font-size:.6rem;font-weight:600;padding:1px 6px;border-radius:7px;pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,.5)">Yidplus.com</div>';

  var media = '';
  if (src) {
    if (p.media_type === 'video') {
      // preload=none. It was 'metadata', to fetch the head on render so the
      // duration showed and the opening seconds warmed up — but that's one
      // request per post, and each of those warms four more, so opening a
      // channel of twenty videos fired ~100 requests at once, each building its
      // own MTProto connection. Telegram answers that with FLOOD_WAIT and the
      // slices start failing at random: some posts play, some don't, and it
      // changes every time.
      //
      // The duration no longer needs probing for — it comes with the post now
      // (media_duration), and the card shows it. So nothing is fetched until
      // someone actually presses play, and then the prefetch has the field to
      // itself.
      // Telegram-style: a poster with a big play button. Tapping opens the
      // fullscreen player (same swipeable viewer as the photos), which actually
      // plays the video — no dead inline player, no link-out.
      var vthumb = src + (src.indexOf('?') > -1 ? '&' : '?') + 'thumb=1&tv=2';
      var vdur = p.media_duration ? '<div style="position:absolute;left:8px;bottom:8px;background:rgba(0,0,0,.6);color:#fff;font-size:.65rem;font-weight:600;padding:1px 6px;border-radius:6px;pointer-events:none">' + _tgDur(p.media_duration) + '</div>' : '';
      media = '<div onclick="_openTgMediaViewer(' + p.tg_msg_id + ')" style="position:relative;margin:0;overflow:hidden;background:#0b0b0b;cursor:pointer;min-height:170px">' +
          '<img src="' + vthumb + '" onerror="this.style.display=&#39;none&#39;" style="width:100%;display:block;max-height:70vh;object-fit:cover">' +
          '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none">' +
            '<div style="width:58px;height:58px;border-radius:50%;background:rgba(0,0,0,.5);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center">' +
              '<svg width="26" height="26" viewBox="0 0 24 24" fill="#fff" style="margin-left:3px"><polygon points="6 4 20 12 6 20 6 4"/></svg>' +
            '</div>' +
          '</div>' +
          vdur + stamp +
        '</div>';
    } else if (p.media_type === 'audio') {
      // Telegram shows a track as a card — name, performer, running time — not a
      // bare player reading 0:00. All of that rides along in the post now, so
      // show it: the title falls back to the file name, and the duration is
      // known up front rather than waiting on the file to load.
      var tTitle = p.media_title || (p.media_name || '').replace(/\.[a-z0-9]+$/i, '') || 'Audio';
      var tSub = p.media_performer || '';
      var tDur = p.media_duration ? _tgDur(p.media_duration) : '';
      // Cover art when the track carries any, otherwise the note icon. Fetched
      // from the same stream endpoint at ?thumb=1 — a few KB, never stored.
      var art = p.media_thumb
        ? '<div style="width:44px;height:44px;border-radius:6px;background-image:url(' + src + '&thumb=1&tv=2);background-size:cover;background-position:center;flex-shrink:0;background-color:#e6ebee"></div>'
        : '<div style="width:44px;height:44px;border-radius:6px;background:#168acd;color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>' +
          '</div>';
      media =
        '<div style="margin-bottom:.45rem;padding:0 .85rem">' +
          '<div style="display:flex;align-items:center;gap:.55rem;margin-bottom:.3rem">' +
            art +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:.86rem;font-weight:600;color:#000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;unicode-bidi:plaintext">' + escHtml(tTitle) + '</div>' +
              '<div style="font-size:.72rem;color:#8a9aa5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;unicode-bidi:plaintext">' +
                escHtml(tSub) + (tSub && tDur ? ' · ' : '') + tDur +
              '</div>' +
            '</div>' +
          '</div>' +
          '<audio src="' + src + '" controls preload="none" class="tg-audio" onended="_tgPlayNext(this)" onplay="_tgSoloPlay(this)" style="display:block;width:100%;min-width:250px;height:38px"></audio>' +
        '</div>';
    } else if (p.media_type === 'file') {
      media = '<a href="' + src + '" target="_blank" style="display:flex;align-items:center;gap:.5rem;margin:.2rem .85rem .45rem;text-decoration:none;color:#168acd">' +
        '<div style="width:36px;height:36px;border-radius:50%;background:#168acd;color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
        '</div><span style="font-size:.85rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(p.media_name || 'Download file') + '</span></a>';
    } else {
      media = '<div style="position:relative;margin:0;overflow:hidden"><img src="' + src + '" onclick="_openTgMediaViewer(' + p.tg_msg_id + ')" onerror="var d=this.closest(&#39;div&#39;);if(d)d.style.display=&#39;none&#39;" style="width:100%;display:block;cursor:pointer;max-height:75vh;object-fit:cover" loading="lazy">' + stamp + '</div>';
    }
  }

  var when = '';
  try {
    when = new Date(p.posted_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch (e) {}

  var eye = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:.75"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';

  // Reactions, using the same pills the chats use so it reads as one app.
  var r = TG_reactions[p.tg_msg_id] || { counts: {}, my_reaction: null };
  var pills = Object.keys(r.counts).map(function (emo) {
    return '<span class="reaction-pill' + (emo === r.my_reaction ? ' mine' : '') + '" onclick="event.stopPropagation();tgReact(' + p.tg_msg_id + ',\'' + emo + '\')">' + emo + ' ' + r.counts[emo] + '</span>';
  }).join('');
  var reactRow =
    '<div style="display:flex;align-items:center;gap:.3rem;flex-wrap:wrap;margin-top:.35rem">' +
      pills +
      '<span class="reaction-pill" onclick="event.stopPropagation();tgOpenReactPicker(' + p.tg_msg_id + ',this)" style="opacity:.6">🙂+</span>' +
    '</div>';

  // Telegram channel bubble: left-aligned, white, rounded with a small tail;
  // media fills the top edge-to-edge (the bubble clips it round), text and a
  // views + time footer sit underneath. No per-post avatar — just like Telegram.
  var canDelete = STATE.user && (STATE.user.role === 'admin_super' || STATE.user.is_owner);
  var delBtn = canDelete
    ? '<span onclick="event.stopPropagation();tgDeletePost(' + p.tg_msg_id + ')" style="cursor:pointer;color:var(--red);font-size:.72rem;margin-right:auto">🗑</span>'
    : '';

  return '<div style="display:flex;justify-content:flex-start;margin-bottom:.35rem">' +
      '<div style="background:#fff;border-radius:14px 14px 14px 5px;max-width:' + (media ? '82%' : '80%') + ';min-width:120px;overflow:hidden;box-shadow:0 1px 1.5px rgba(0,0,0,.14);box-sizing:border-box">' +
        media +
        '<div style="padding:' + (media && !text ? '.35rem .55rem .4rem' : '.45rem .6rem .4rem') + '">' +
          (text ? '<div style="font-size:.95rem;line-height:1.45;color:#000;white-space:pre-wrap;word-break:break-word;unicode-bidi:plaintext">' + text + '</div>' + _tgLpPlaceholder(p) : '') +
          reactRow +
          '<div style="display:flex;align-items:center;justify-content:flex-end;gap:.25rem;margin-top:.15rem;color:#8a9aa5;font-size:.66rem">' +
            delBtn + eye + '<span>' + _xNum(p.views || 0) + '</span>' +
            '<span style="margin-left:.15rem">' + when + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
}
// Audio in a channel behaves like a playlist: only one clip plays at a time,
// and finishing one rolls into the next, scrolling it into view.
window._tgSoloPlay = function (el) {
  document.querySelectorAll('audio.tg-audio').forEach(function (a) {
    if (a !== el && !a.paused) a.pause();
  });
};
window._tgPlayNext = function (el) {
  var all = Array.prototype.slice.call(document.querySelectorAll('audio.tg-audio'));
  var next = all[all.indexOf(el) + 1];
  if (!next) return;
  next.play().then(function () {
    try { next.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
  }).catch(function () { /* browser blocked autoplay — leave it to the user */ });
};

var TG_curChannel = null;

// Tapping the title opens info — a Telegram channel has its own panel, anything
// else falls through to the normal room info the chats already use.
window.crTitleTap = function () {
  try {
    if (typeof TG_curChannel !== 'undefined' && TG_curChannel) { tgOpenInfo(); return; }
    if (typeof openChatInfo === 'function') openChatInfo();
  } catch (e) { try { console.error('crTitleTap failed: ' + (e && e.message)); } catch (_) {} }
};

window.tgOpenInfo = function () {
  if (!TG_curChannel) return;
  var old = document.getElementById('tg-info');
  if (old) old.remove();

  var meta = null;
  for (var i = 0; i < (CHAT_tgChannels || []).length; i++) {
    if (CHAT_tgChannels[i].username === TG_curChannel) { meta = CHAT_tgChannels[i]; break; }
  }
  var av = meta && meta.photo_url
    ? '<div style="width:84px;height:84px;border-radius:50%;background-image:url(' + meta.photo_url + ');background-size:cover;background-position:center;margin:0 auto"></div>'
    : '<div style="width:84px;height:84px;border-radius:50%;background:#229ED9;color:#fff;display:flex;align-items:center;justify-content:center;font-size:2.2rem;margin:0 auto">📨</div>';

  var ov = document.createElement('div');
  ov.id = 'tg-info';
  ov.style.cssText = 'position:fixed;inset:0;z-index:940;background:var(--bg);display:flex;flex-direction:column';
  ov.innerHTML =
    '<div style="display:flex;align-items:center;gap:.6rem;padding:.7rem .8rem;background:var(--brand,#1F6F5C);color:#fff;flex-shrink:0">' +
      '<button onclick="document.getElementById(\'tg-info\').remove()" style="background:none;border:none;color:#fff;font-size:1.3rem;cursor:pointer;padding:0 .3rem">‹</button>' +
      '<div style="font-weight:700;font-size:.98rem">Channel info</div>' +
    '</div>' +
    '<div style="flex:1;overflow-y:auto">' +
      '<div style="text-align:center;padding:1.2rem 1rem;background:var(--surface)">' +
        av +
        '<div style="font-weight:700;font-size:1.05rem;margin-top:.6rem;text-align:center;unicode-bidi:plaintext;direction:ltr">' + escHtml(TG_curTitle || TG_curChannel) + '</div>' +
        '<div style="font-size:.78rem;color:var(--muted);margin-top:.15rem">Telegram channel · read-only</div>' +
        '<div id="tgi-stats" style="font-size:.8rem;color:var(--muted);margin-top:.5rem"></div>' +
      '</div>' +
      '<div style="padding:.8rem 1rem .3rem;font-size:.75rem;font-weight:700;color:var(--muted);letter-spacing:.04em">MEMBERS</div>' +
      '<div id="tgi-members" style="background:var(--surface)"><div style="padding:1.2rem;text-align:center"><div class="spinner"></div></div></div>' +
      '<div style="height:2rem"></div>' +
    '</div>';
  document.body.appendChild(ov);

  api.get('/telegram-info?username=' + encodeURIComponent(TG_curChannel)).then(function (res) {
    var st = document.getElementById('tgi-stats');
    if (st) st.textContent = _tgMembersLabel((res.members || []).length) + ' · ' + (res.post_count || 0) + ' posts';

    var el = document.getElementById('tgi-members');
    if (!el) return;
    var list = res.members || [];
    if (!list.length) {
      el.innerHTML = '<div style="padding:1.2rem;text-align:center;color:var(--muted);font-size:.85rem">Nobody has joined yet.</div>';
      return;
    }
    el.innerHTML = list.map(function (m) {
      var mav = m.photo_url
        ? '<div style="width:40px;height:40px;border-radius:50%;background-image:url(' + m.photo_url + ');background-size:cover;background-position:center;flex-shrink:0"></div>'
        : '<div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--gold),var(--gold-l));color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0">' + escHtml((m.name || '?').charAt(0).toUpperCase()) + '</div>';
      return '<div style="display:flex;align-items:center;gap:.7rem;padding:.55rem 1rem;border-bottom:1px solid var(--border)">' +
        mav +
        '<div style="flex:1;min-width:0"><div style="font-size:.9rem;font-weight:600;unicode-bidi:plaintext;direction:ltr;text-align:left">' + escHtml(m.name) + '</div>' +
        '<div style="font-size:.68rem;color:var(--muted)">Joined ' + (m.joined_at ? new Date(m.joined_at).toLocaleDateString() : '') + '</div></div>' +
        (res.is_admin ? '<button onclick="tgRemoveMember(\'' + m.user_id + '\',this)" style="background:none;border:none;color:var(--red);font-size:.78rem;cursor:pointer">Remove</button>' : '') +
      '</div>';
    }).join('');
  }).catch(function (e) {
    var el = document.getElementById('tgi-members');
    if (el) el.innerHTML = '<div style="padding:1rem;color:var(--muted);font-size:.85rem">Could not load.</div>';
  });
};

window.tgRemoveMember = function (userId, btn) {
  if (!confirm('Remove this member from the channel?')) return;
  btn.disabled = true;
  api.del('/telegram-info?username=' + encodeURIComponent(TG_curChannel) + '&user_id=' + encodeURIComponent(userId))
    .then(function (res) {
      if (res.error) { toast('❌ ' + res.error); btn.disabled = false; return; }
      toast('Removed');
      var row = btn.parentElement; if (row) row.remove();
      // Keep the header and the cached row in step with the new count.
      var s = document.getElementById('cr-status');
      if (s && typeof res.members === 'number') s.textContent = _tgMembersLabel(res.members);
      for (var i = 0; i < (CHAT_tgChannels || []).length; i++) {
        if (CHAT_tgChannels[i].username === TG_curChannel) CHAT_tgChannels[i].members = res.members;
      }
    })
    .catch(function (e) { toast('❌ ' + e.message); btn.disabled = false; });
};

window.tgDeletePost = function (msgId) {
  if (!confirm('Delete this post from YID PLUS? (It stays on Telegram.)')) return;
  api.del('/telegram-info?username=' + encodeURIComponent(TG_curChannel) + '&tg_msg_id=' + msgId)
    .then(function (res) {
      if (res.error) { toast('❌ ' + res.error); return; }
      toast('Deleted');
      TG_posts = TG_posts.filter(function (p) { return p.tg_msg_id !== msgId; });
      _tgRerender();
    })
    .catch(function (e) { toast('❌ ' + e.message); });
};
var TG_curTitle = '';

// Redraw the open channel from what's already loaded — used after a reaction,
// so the pills update without refetching the whole feed.
function _tgRerender() {
  var slot = document.getElementById('tg-feed-slot');
  if (!slot || !TG_posts.length) return;
  slot.innerHTML = _tgRenderPosts(TG_posts, TG_curChannel, TG_curTitle);
  _tgLoadLinkPreviews();
}
var TG_reactions = {};    // { tg_msg_id: { counts:{emoji:n}, my_reaction } }

// The same quick set the chats offer, so reacting feels identical either side.
var TG_QUICK_EMOJI = ['👍', '❤️', '😂', '🔥', '😮', '😢', '🙏', '💯'];

window.tgReact = function (msgId, emoji) {
  if (!TG_curChannel) return;
  // Optimistic: reflect it now, reconcile with whatever the server says.
  var cur = TG_reactions[msgId] || { counts: {}, my_reaction: null };
  api.post('/telegram-reactions', { username: TG_curChannel, tg_msg_id: msgId, emoji: emoji })
    .then(function (res) {
      if (res.error) { toast('❌ ' + res.error); return; }
      TG_reactions[msgId] = { counts: res.counts || {}, my_reaction: res.my_reaction || null };
      _tgRerender();
    })
    .catch(function (e) { toast('❌ ' + e.message); });
};

window.tgOpenReactPicker = function (msgId, anchor) {
  var old = document.getElementById('tg-react-pick');
  if (old) old.remove();
  var box = document.createElement('div');
  box.id = 'tg-react-pick';
  box.style.cssText = 'position:fixed;z-index:960;background:var(--surface);border-radius:22px;padding:.4rem .5rem;box-shadow:0 4px 18px rgba(0,0,0,.25);display:flex;gap:.25rem';
  box.innerHTML = TG_QUICK_EMOJI.map(function (e) {
    return '<span onclick="tgReact(' + msgId + ',\'' + e + '\');document.getElementById(\'tg-react-pick\').remove()" style="font-size:1.35rem;cursor:pointer;padding:.1rem .15rem">' + e + '</span>';
  }).join('');
  document.body.appendChild(box);

  // Sit it above the button, kept inside the screen.
  var r = anchor.getBoundingClientRect();
  var w = box.offsetWidth;
  box.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left - w / 2 + r.width / 2)) + 'px';
  box.style.top = Math.max(8, r.top - box.offsetHeight - 8) + 'px';

  setTimeout(function () {
    document.addEventListener('click', function close(ev) {
      if (!box.contains(ev.target)) { box.remove(); document.removeEventListener('click', close); }
    });
  }, 0);
};
var TG_posts = [];        // what's currently rendered, for the media viewer

// Open a channel photo in the SAME viewer the chats use, so it swipes between
// pictures and behaves identically. The viewer reads _mediaList, so we just
// build that from this channel's posts instead of from CHAT_messages.
window._openTgMediaViewer = function (msgId) {
  if (typeof _mediaList === 'undefined') return;
  var base = (window.STATE && STATE.settings && STATE.settings.tg_stream_base) || TG_STREAM_BASE;
  _mediaList = TG_posts.filter(function (p) {
    return p.media_type === 'photo' || p.media_type === 'video';
  }).map(function (p) {
    // Videos stream straight from the worker, which serves Range/206 so the
    // player can seek and play any size. Photos stream directly too.
    var vurl = p.media_url
      ? p.media_url
      : base.replace(/\/$/, '') + '/media?ch=' + encodeURIComponent(TG_curChannel) + '&id=' + p.tg_msg_id;
    return {
      id: p.tg_msg_id,
      url: vurl,
      key: '',
      text: p.text || '',
      sender: p.author_name || TG_curChannel || '',
      time: p.posted_at ? _fmt12(p.posted_at) : '',
      isVideo: p.media_type === 'video',
    };
  });
  _mediaIdx = _mediaList.findIndex(function (v) { return v.id === msgId; });
  if (_mediaIdx < 0) _mediaIdx = 0;
  _mediaViewerLoad(_mediaIdx);
  var v = document.getElementById('media-viewer');
  if (v) v.style.display = 'flex';
};

// The worker that streams channel files. Overridable from admin settings
// (tg_stream_base) so the URL isn't baked into the client forever.
var TG_STREAM_BASE = 'https://yidplus-telegram-worker.avrumy5872877.workers.dev';

// "1,204 members" — the audience here on YID PLUS, not Telegram's subscriber count.
function _tgMembersLabel(n) {
  n = parseInt(n) || 0;
  return _xNum(n) + (n === 1 ? ' member' : ' members');
}

// The Join bar sits where the composer would be — and only while you haven't
// joined. Once you have, it goes away like it does in Telegram; the member
// count lives under the channel name in the header, not down here.
function _tgRenderJoinBar(username, meta) {
  var old = document.getElementById('tg-join-bar');
  if (old) old.remove();
  var room = document.getElementById('screen-chatroom');
  if (!room) return;
  if (meta && meta.joined) return;   // already joined → no bar at all

  var bar = document.createElement('div');
  bar.id = 'tg-join-bar';
  bar.style.cssText = 'flex-shrink:0;padding:.6rem .8rem;background:var(--surface);border-top:1px solid var(--border);display:flex;justify-content:center';
  bar.innerHTML =
    '<button id="tg-jb-btn" onclick="tgToggleJoin()" style="border:none;border-radius:20px;padding:.55rem 2.4rem;font-weight:700;font-size:.9rem;cursor:pointer;background:#229ED9;color:#fff">Join channel</button>';
  room.appendChild(bar);
}

window.tgToggleJoin = function () {
  var btn = document.getElementById('tg-jb-btn');
  if (!btn || !TG_curChannel) return;
  btn.disabled = true;
  api.post('/telegram-join', { username: TG_curChannel }).then(function (res) {
    if (res.error) { btn.disabled = false; toast('❌ ' + res.error); return; }
    // Joined → the bar's job is done.
    var bar = document.getElementById('tg-join-bar');
    if (bar) bar.remove();
    var s = document.getElementById('cr-status');
    if (s) s.textContent = _tgMembersLabel(res.members);
    // Keep the cached list in step so the row and a re-open agree.
    for (var i = 0; i < (CHAT_tgChannels || []).length; i++) {
      if (CHAT_tgChannels[i].username === TG_curChannel) {
        CHAT_tgChannels[i].joined = res.joined;
        CHAT_tgChannels[i].members = res.members;
      }
    }
  }).catch(function (e) { btn.disabled = false; toast('❌ ' + e.message); });
};

// Seconds -> 3:06 / 10:14 / 1:02:33, the way a track's running time reads.
// Lay the posts out with a date divider wherever the day changes — the way
// Telegram breaks a channel up, so you can tell Thursday from Friday at a
// glance instead of reading timestamps.
// Telegram doesn't send marked-up text — it sends plain text plus a list of
// ranges ("bold from 4 for 9", "this bit is a link to X"). Ignoring them is why
// every post read as flat plain text.
//
// Offsets are UTF-16 code units, which is exactly how JS indexes a string, so
// they line up directly. Escaping is done per code unit and concatenated, which
// leaves surrogate pairs (emoji) intact — escHtml only ever touches ASCII.
function _tgEntityTags(e) {
  var u = e.url || '';
  switch (e._) {
    case 'messageEntityBold':       return ['<b>', '</b>'];
    case 'messageEntityItalic':     return ['<i>', '</i>'];
    case 'messageEntityUnderline':  return ['<u>', '</u>'];
    case 'messageEntityStrike':     return ['<s>', '</s>'];
    case 'messageEntityCode':       return ['<code style="background:rgba(0,0,0,.06);padding:0 3px;border-radius:3px">', '</code>'];
    case 'messageEntityPre':        return ['<pre style="background:rgba(0,0,0,.06);padding:.4rem;border-radius:6px;overflow-x:auto;margin:.3rem 0">', '</pre>'];
    case 'messageEntityBlockquote': return ['<blockquote style="border-left:3px solid #168acd;margin:.3rem 0;padding:.1rem .5rem;opacity:.9">', '</blockquote>'];
    case 'messageEntitySpoiler':    return ['<span onclick="this.style.filter=&#39;none&#39;" style="filter:blur(5px);cursor:pointer;transition:filter .15s">', '</span>'];
    case 'messageEntityTextUrl':
      // A t.me target would be a way back out to Telegram — keep the styling,
      // drop the link, same as bare t.me links elsewhere in a post.
      if (/(?:t|telegram)\.me\//i.test(u)) return ['<span style="color:#168acd">', '</span>'];
      return ['<a href="' + escHtml(u) + '" target="_blank" rel="noopener" style="color:#168acd;text-decoration:none">', '</a>'];
    case 'messageEntityUrl':
      // A bare URL — the link text IS the URL, so open its own text on tap.
      if (/(?:t|telegram)\.me\//i.test(u)) return ['<span style="color:#168acd">', '</span>'];
      return ['<a href="#" onclick="event.preventDefault();event.stopPropagation();var u=this.textContent.trim();window.open(/^https?:/i.test(u)?u:&#39;https://&#39;+u,&#39;_blank&#39;,&#39;noopener&#39;)" style="color:#168acd;text-decoration:none">', '</a>'];
    case 'messageEntityMention':
    case 'messageEntityHashtag':
    case 'messageEntityCashtag':
    case 'messageEntityBotCommand':
      return ['<span style="color:#168acd">', '</span>'];
    default: return null;
  }
}

function _tgFormat(text, entitiesJson) {
  if (!text) return '';
  var ents = [];
  try { ents = JSON.parse(entitiesJson || '[]') || []; } catch (e) { ents = []; }

  // Strip bare Telegram links first — but only when there's no formatting to
  // keep aligned, since removing characters would shift every later offset.
  if (!ents.length) {
    return escHtml(text.replace(/https?:\/\/(?:t|telegram)\.me\/[^\s]+/gi, ''))
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:#168acd;text-decoration:none">$1</a>')
      .replace(/(^|\s)([@#][^\s<]+)/g, '$1<span style="color:#168acd">$2</span>')
      .replace(/\n/g, '<br>');
  }

  var opens = {}, closes = {};
  ents.forEach(function (e) {
    var tags = _tgEntityTags(e);
    if (!tags) return;
    var a = e.offset, b = e.offset + e.length;
    if (!(a >= 0) || !(b > a)) return;
    (opens[a] = opens[a] || []).push(tags[0]);
    // Close in reverse order so nested ranges nest properly.
    (closes[b] = closes[b] || []).unshift(tags[1]);
  });

  var out = '';
  for (var i = 0; i <= text.length; i++) {
    if (closes[i]) out += closes[i].join('');
    if (opens[i]) out += opens[i].join('');
    if (i < text.length) out += escHtml(text[i]);
  }
  return out.replace(/\n/g, '<br>');
}

function _tgRenderPosts(list, username, title) {
  var out = '';
  var lastDay = '';
  var i = 0;
  while (i < list.length) {
    var p = list[i];

    var day = '';
    try { day = p.posted_at ? new Date(p.posted_at).toDateString() : ''; } catch (e) {}
    if (day && day !== lastDay) {
      lastDay = day;
      out += '<div style="display:flex;justify-content:center;margin:.5rem 0 .6rem">' +
               '<span style="background:rgba(0,0,0,.16);color:#fff;font-size:.7rem;font-weight:600;padding:.15rem .7rem;border-radius:11px;backdrop-filter:blur(2px)">' +
                 escHtml(_dateLabel(p.posted_at)) +
               '</span>' +
             '</div>';
    }

    // Fold an album back into one bubble. Telegram sends it as several separate
    // messages sharing a grouped_id, so one-per-bubble — what we were doing —
    // turns a five-photo post into five posts. They arrive together, so a run
    // of matching ids is the whole album. Each card is wrapped so a single
    // malformed post can never throw and blank the entire channel.
    try {
      if (p.grouped_id) {
        var group = [p];
        var j = i + 1;
        while (j < list.length && list[j].grouped_id === p.grouped_id) { group.push(list[j]); j++; }
        if (group.length > 1) { out += _tgAlbumCard(group, username, title); i = j; continue; }
      }
      out += _xPostCard(p, username, title);
    } catch (e) { /* skip a bad post rather than lose the whole feed */ }
    i++;
  }
  return out;
}

// One bubble for an album: a grid of its pictures, plus the caption from
// whichever message carries it — Telegram puts it on only one of them.
function _tgAlbumCard(group, username, chTitle) {
  var lead = group[0];
  var withText = group.filter(function (p) { return p.text; })[0];
  var base = (window.STATE && STATE.settings && STATE.settings.tg_stream_base) || TG_STREAM_BASE;

  var name = escHtml(lead.author_name || chTitle || username);
  var avatar = lead.author_avatar
    ? '<div style="width:34px;height:34px;border-radius:50%;background-image:url(' + lead.author_avatar + ');background-size:cover;background-position:center;flex-shrink:0"></div>'
    : '<div style="width:34px;height:34px;border-radius:50%;background:#229ED9;color:#fff;display:flex;align-items:center;justify-content:center;font-size:.9rem;font-weight:700;flex-shrink:0">' + (name.slice(0, 1) || 'C') + '</div>';

  var stamp = '<div style="position:absolute;right:4px;bottom:4px;background:rgba(0,0,0,.45);color:#fff;font-size:.55rem;font-weight:600;padding:1px 5px;border-radius:6px;pointer-events:none">Yidplus.com</div>';

  // Two across, with an odd one out spanning the full width — close to how
  // Telegram tiles an album without reimplementing its exact geometry.
  var cells = group.map(function (p, idx) {
    var src = p.media_url || (base.replace(/\/$/, '') + '/media?ch=' + encodeURIComponent(username) + '&id=' + p.tg_msg_id);
    var span = (group.length % 2 === 1 && idx === group.length - 1) ? 'grid-column:1/-1;' : '';
    var inner;
    if (p.media_type === 'video') {
      // Poster + play; tap opens the fullscreen viewer, which plays via the
      // R2-caching proxy so any size works.
      inner = '<div onclick="_openTgMediaViewer(' + p.tg_msg_id + ')" style="width:100%;height:100%;position:relative;background:#000;cursor:pointer">' +
          '<img src="' + src + '&thumb=1&tv=2" onerror="this.style.display=&#39;none&#39;" style="width:100%;height:100%;object-fit:cover;display:block">' +
          '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none"><div style="width:40px;height:40px;border-radius:50%;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center"><svg width="18" height="18" viewBox="0 0 24 24" fill="#fff" style="margin-left:2px"><polygon points="6 4 20 12 6 20 6 4"/></svg></div></div>' +
        '</div>';
    } else {
      inner = '<img src="' + src + '" onclick="_openTgMediaViewer(' + p.tg_msg_id + ')" style="width:100%;height:100%;object-fit:cover;display:block;cursor:pointer" loading="lazy">';
    }
    return '<div style="position:relative;' + span + 'aspect-ratio:1;overflow:hidden">' + inner + stamp + '</div>';
  }).join('');

  var text = withText ? _tgFormat(withText.text, withText.entities) : '';
  var when = '';
  try { when = new Date(lead.posted_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) {}
  var eye = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:.75"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  var canDelete = STATE.user && (STATE.user.role === 'admin_super' || STATE.user.is_owner);
  var delBtn = canDelete
    ? '<span onclick="event.stopPropagation();tgDeletePost(' + lead.tg_msg_id + ')" style="cursor:pointer;color:var(--red);font-size:.72rem;margin-right:auto">🗑</span>'
    : '';

  return '<div style="display:flex;justify-content:flex-start;margin-bottom:.35rem">' +
      '<div style="background:#fff;border-radius:14px 14px 14px 5px;max-width:82%;overflow:hidden;box-shadow:0 1px 1.5px rgba(0,0,0,.14);box-sizing:border-box">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px">' + cells + '</div>' +
        '<div style="padding:.45rem .6rem .4rem">' +
          (text ? '<div style="font-size:.95rem;line-height:1.45;color:#000;white-space:pre-wrap;word-break:break-word;unicode-bidi:plaintext">' + text + '</div>' + _tgLpPlaceholder(withText) : '') +
          '<div style="display:flex;align-items:center;justify-content:flex-end;gap:.25rem;margin-top:.15rem;color:#8a9aa5;font-size:.66rem">' +
            delBtn + eye + '<span>' + _xNum(lead.views || 0) + '</span>' +
            '<span style="margin-left:.15rem">' + when + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
}

function _tgDur(s) {
  s = parseInt(s) || 0;
  var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  var pad = function (n) { return n < 10 ? '0' + n : String(n); };
  return h ? h + ':' + pad(m) + ':' + pad(x) : m + ':' + pad(x);
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
  // Build list of all image/video messages in this chat — including files that
  // are actually images/videos, so they open in the viewer like normal photos.
  _mediaList = CHAT_messages.filter(function (m) {
    if (!m.media_url) return false;
    if (m.type === 'media') return true;
    if (m.type === 'file') {
      var k = ((m.text || '') + ' ' + (m.media_key || '')).toLowerCase();
      return /\.(jpe?g|png|gif|webp|bmp|heic|heif|mp4|webm|mov|mkv|m4v|avi)(\?|$|\s)/i.test(k);
    }
    return false;
  }).map(function (m) {
    return {
      id:      m.id,
      url:     m.media_url,
      key:     m.media_key || '',
      text:    m.text && m.text !== '__once__' ? m.text : '',
      sender:  m.sender_nick || 'User',
      time:    m.created_at ? _fmt12(m.created_at) : '',
      isVideo: /\.(mp4|webm|mov|mkv|m4v|avi)(\?|$|\s)/i.test(((m.text || '') + ' ' + (m.media_key || '')).toLowerCase()),
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
    body.innerHTML =
      '<div style="position:relative;width:100%;display:flex;align-items:center;justify-content:center">' +
        '<video src="' + item.url + '" controls autoplay playsinline webkit-playsinline preload="auto" ' +
          'controlsList="nodownload noremoteplayback noplaybackrate" disablePictureInPicture ' +
          'style="max-width:100%;max-height:82vh;object-fit:contain;background:#000;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,.5)" ' +
          'onwaiting="var s=this.parentNode.querySelector(\'.mv-spin\');if(s)s.style.display=\'flex\'" ' +
          'onplaying="var s=this.parentNode.querySelector(\'.mv-spin\');if(s)s.style.display=\'none\'" ' +
          'oncanplay="var s=this.parentNode.querySelector(\'.mv-spin\');if(s)s.style.display=\'none\'">Your browser cannot play this video.</video>' +
        '<div class="mv-spin" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none"><div style="width:46px;height:46px;border:3px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite"></div></div>' +
      '</div>';
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
    var _startInCaption = false;
    mv.addEventListener('touchstart', function (e) {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startT = Date.now();
      // A touch that begins inside the caption is a read-scroll — let it scroll
      // natively and never treat it as a swipe to close or change photo.
      _startInCaption = !!(e.target && e.target.closest && e.target.closest('#mv-caption'));
    }, { passive: true });
    mv.addEventListener('touchend', function (e) {
      if (_startInCaption) { _startInCaption = false; return; }
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
  // A Telegram channel has no room and no invite code — it's public, so the
  // link is simply the one that opens it. Handled first because CHAT_curRoom is
  // null for these, which is why this used to do nothing at all.
  if (TG_curChannel) {
    // /c/<name> rather than /chat#tg=<name>: a fragment never reaches the
    // server, so a shared link had no title or picture to unfurl with. That
    // route renders the preview tags and then opens the channel.
    var tgUrl = window.location.origin + '/c/' + encodeURIComponent(TG_curChannel);
    if (navigator.share) {
      navigator.share({ title: TG_curTitle || TG_curChannel, url: tgUrl }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(tgUrl).then(function () { toast('✅ Invite link copied!'); });
    } else {
      toast('🔗 ' + tgUrl);
    }
    return;
  }

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
  // pushState, not replaceState: Back needs an entry to return to. Everything
  // used replaceState, which is why the browser's Back button walked out of
  // the app instead of closing the chat.
  try {
    if ((location.hash || '').indexOf('#room=' + roomId) === -1) {
      history.pushState({ view: 'room', id: roomId }, '', '#room=' + encodeURIComponent(roomId));
    }
  } catch (e) {}
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

  // Join banner — never for guests: they're only looking, and joining needs
  // an account. They sign in from the Sign In button in the top bar.
  var _guestViewing = !!(window.GUEST_MODE || room.guest_view) && !(window.STATE && STATE.user);
  var needsJoin = (!room.joined && isGroup && !_guestViewing);
  document.getElementById('join-banner').style.display = needsJoin ? 'flex' : 'none';

  // Read-only enforcement: lock input unless the viewer is a group admin or Super Admin.
  var lockedForReadOnly = isGroup && room.read_only && !room.is_group_admin && !isSuperAdmin;
  var inputDisabled = needsJoin || lockedForReadOnly || !!room.admin_spectating;

  var ib = document.getElementById('chat-input-bar');
  var roBar = document.getElementById('readonly-bar');
  var _jb = document.getElementById('tg-join-bar');
  if (_jb) _jb.remove();   // ...and drop that channel's Join bar

  var _isGuest = !!(window.GUEST_MODE || room.guest_view) && !(window.STATE && STATE.user);
  if (_isGuest || lockedForReadOnly) {
    // Nothing to write with, so show nothing at all: the composer and the
    // notice bar are both removed, and the messages run to the bottom of the
    // screen. (Guests, and members of an admins-only group. The server also
    // rejects their posts, so this can't be bypassed.)
    ib.style.display = 'none';
    if (roBar) { roBar.style.display = 'none'; roBar.onclick = null; }
  } else {
    if (roBar) roBar.style.display = 'none';
    ib.style.display = '';   // restore in case a Telegram channel/read-only hid it
    // needsJoin / admin-spectating still dim the composer but leave it visible.
    var softDisabled = needsJoin || !!room.admin_spectating;
    ib.style.opacity = softDisabled ? '.4' : '1';
    ib.style.pointerEvents = softDisabled ? 'none' : 'all';
  }

  // Explain the other (non-read-only) lockouts.
  if (room.admin_spectating && !_isGuest) {
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
    // Don't poll while the tab is in the background — saves server load. We
    // refresh instantly when the user comes back. 3s keeps incoming messages
    // (text, photos, video, files) arriving quickly for everyone.
    if (document.hidden) return;
    loadMessages(false);
  }, 3000);

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
  // Channels get the same owner/admin controls as groups (photo, settings).
  var isGroupOrChannel = isGroup || CHAT_curRoom.type === 'channel';

  var avBig = document.getElementById('info-avatar-big');
  if (CHAT_curRoom.photo_url) {
    avBig.style.backgroundImage = "url('" + CHAT_curRoom.photo_url + "')";
    avBig.textContent = '';
  } else {
    avBig.style.backgroundImage = '';
    avBig.textContent = isGroup ? '👥' : (CHAT_curRoom.nick || '?').slice(0, 1).toUpperCase();
  }
  avBig.onclick = isGroupOrChannel ? function () { document.getElementById('group-photo-input').click(); } : function () { _viewChatPartnerStatus(); };
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
  var canManageGroup = isGroupOrChannel && (CHAT_curRoom.is_group_admin || isSuperAdmin);
  // The old inline "GROUP SETTINGS" toggles are replaced by the clean Edit
  // screen (pencil button). Keep the info screen tidy — never show them here.
  var _adminBox = document.getElementById('info-admin-settings');
  if (_adminBox) _adminBox.style.display = 'none';
  var _editBtn = document.getElementById('info-edit-btn');
  if (_editBtn) _editBtn.style.display = canManageGroup ? 'flex' : 'none';
  var _fab = document.getElementById('info-fab-add');
  if (_fab) _fab.style.display = canManageGroup ? 'flex' : 'none';

  // Make the "change photo" affordance obvious for admins.
  if (avBig) {
    var oldCam = avBig.querySelector('.av-cam-badge');
    if (oldCam) oldCam.remove();
    if (canManageGroup) {
      avBig.style.position = 'relative';
      avBig.title = 'Tap to change photo';
      var cam = document.createElement('div');
      cam.className = 'av-cam-badge';
      cam.style.cssText = 'position:absolute;right:0;bottom:0;width:30px;height:30px;border-radius:50%;background:var(--accent,#1F6F5C);color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;border:2px solid var(--surface,#fff);box-shadow:0 1px 4px rgba(0,0,0,.25);pointer-events:none';
      cam.textContent = '📷';
      avBig.appendChild(cam);
    }
  }

  if (canManageGroup) _loadJoinRequests(CHAT_curRoom.id);

  if (canManageGroup) {
    document.getElementById('group-readonly-toggle').classList.toggle('on', !CHAT_curRoom.read_only);
    document.getElementById('group-visibility-toggle').classList.toggle('on', CHAT_curRoom.visibility === 'public');
    // "Show to everyone" is owner-only.
    var featRow = document.getElementById('group-featured-row');
    if (featRow) {
      var isOwner = !!(window.STATE && STATE.user && STATE.user.is_owner);
      featRow.style.display = isOwner ? 'flex' : 'none';
      if (isOwner) document.getElementById('group-featured-toggle').classList.toggle('on', !!CHAT_curRoom.featured);
    }
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

window.toggleGroupFeatured = function () {
  if (!CHAT_curRoom) return;
  var toggle = document.getElementById('group-featured-toggle');
  var nowFeatured = !toggle.classList.contains('on');
  toggle.classList.toggle('on', nowFeatured);

  api.put('/chat/rooms', { room_id: CHAT_curRoom.id, featured: nowFeatured })
    .then(function () {
      CHAT_curRoom.featured = nowFeatured;
      toast(nowFeatured ? '⭐ Everyone will see this group' : 'Group hidden from discovery — reachable by search or link');
    })
    .catch(function (err) {
      toggle.classList.toggle('on', !nowFeatured); // revert on failure
      toast('❌ ' + ((err && err.message) || 'Could not update'));
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

  toast('💬 Opening private chat with @' + nickname + '...');
  api.post('/chat/rooms', { type: 'private', other_user_id: memberId })
    .then(function (res) {
      var rid = res && (res.room_id || (res.room && res.room.id));
      loadChatRooms();
      setTimeout(function () { if (rid) openChatRoom(rid); }, 350);
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
    list.innerHTML = '<div style="padding:1rem;text-align:center;font-size:.8rem;color:var(--muted)">Loading members…</div>';
    return;
  }
  var meId = STATE.user && STATE.user.id;
  var isSuperAdmin = STATE.user && (STATE.user.role === 'admin_super' || STATE.user.is_owner);
  var canManageGroup = CHAT_curRoom && (CHAT_curRoom.is_group_admin || isSuperAdmin);

  list.innerHTML = CHAT_members.map(function (m) {
    var photoStyle = m.photo_url ? "background-image:url('" + m.photo_url + "');background-size:cover;background-position:center;" : '';
    var nick = escHtml(m.nickname || 'User');
    var isSelf = m.id === meId;
    var badge = '';
    // Only show group-specific roles. A platform owner/super-admin stays
    // discreet — they appear as a normal member unless they actually created
    // this group or were made a group admin here.
    var isRealOwner = CHAT_curRoom && CHAT_curRoom.created_by && m.id === CHAT_curRoom.created_by;
    if (isRealOwner) badge = '<span style="font-size:.68rem;color:var(--accent,#1F6F5C);font-weight:700">owner</span>';
    else if (m.is_group_admin) badge = '<span style="font-size:.68rem;color:var(--accent,#1F6F5C);font-weight:700">admin</span>';
    // Tapping: admins get the action sheet, everyone else opens the member.
    var tap = (canManageGroup && !isSelf)
      ? "_openMemberActions('" + m.id + "','" + escJs(nick) + "'," + (m.is_group_admin ? 'true' : 'false') + ",'" + escJs(m.title || '') + "')"
      : "_openMemberDM('" + m.id + "','" + escJs(nick) + "')";
    var sub = m.title
      ? '<div style="font-size:.74rem;color:var(--accent,#1F6F5C);font-weight:600">' + escHtml(m.title) + '</div>'
      : (m.online && isAnyAdmin() ? '<div style="font-size:.74rem;color:#16A34A">online</div>' : '');
    var initial = (m.nickname || '?').slice(0, 1).toUpperCase();
    var avatar = '<div style="width:46px;height:46px;border-radius:50%;flex-shrink:0;position:relative;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:1.05rem;background:linear-gradient(135deg,var(--accent,#1F6F5C),#2B8A73);overflow:hidden">' +
      initial +
      (m.photo_url ? '<img src="' + escHtml(m.photo_url) + '" onerror="this.style.display=\'none\'" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%">' : '') +
    '</div>';
    return '<div onclick="' + tap + '" style="display:flex;align-items:center;gap:.8rem;padding:.7rem 1.1rem;cursor:pointer;border-bottom:1px solid var(--border)">' +
        avatar +
        '<div style="flex:1;min-width:0;unicode-bidi:plaintext;text-align:start">' +
          '<div style="font-size:.95rem;font-weight:600">' + nick + '</div>' + sub +
        '</div>' + badge +
        (canManageGroup && !isSelf ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left:.5rem;flex-shrink:0;opacity:.6"><polyline points="9 18 15 12 9 6"/></svg>' : '') +
      '</div>';
  }).join('');
}

// Clean bottom-sheet of actions for a member (admins only).
window._openMemberActions = function (memberId, nickname, isGroupAdmin, title) {
  var old = document.getElementById('member-actions-sheet'); if (old) old.remove();
  var ov = document.createElement('div');
  ov.id = 'member-actions-sheet';
  ov.style.cssText = 'position:fixed;inset:0;z-index:100070;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center';
  ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
  function item(label, color, onclick) {
    return '<div onclick="' + onclick + '" style="padding:1rem 1.25rem;font-size:.95rem;font-weight:600;color:' + (color || 'var(--text)') + ';cursor:pointer;border-top:1px solid var(--border)">' + label + '</div>';
  }
  ov.innerHTML = '<div style="background:var(--surface);width:100%;max-width:500px;border-radius:18px 18px 0 0;overflow:hidden;padding-bottom:env(safe-area-inset-bottom)">' +
      '<div style="padding:1rem 1.25rem;font-weight:800;font-size:1rem">@' + nickname + '</div>' +
      item('💬 Message', '', "document.getElementById('member-actions-sheet').remove();_openMemberDM('" + memberId + "','" + escJs(nickname) + "')") +
      item('🏷 Set title', '', "document.getElementById('member-actions-sheet').remove();promptSetMemberTitle('" + memberId + "','" + escJs(title || '') + "')") +
      item(isGroupAdmin ? '⬇ Dismiss as admin' : '⭐ Make admin', 'var(--accent,#1F6F5C)', "document.getElementById('member-actions-sheet').remove();toggleMemberGroupAdmin('" + memberId + "'," + (!isGroupAdmin) + ")") +
      item('🚫 Remove from group', '#DC2626', "document.getElementById('member-actions-sheet').remove();removeMemberFromGroup('" + memberId + "')") +
      '<div onclick="document.getElementById(\'member-actions-sheet\').remove()" style="padding:1rem 1.25rem;text-align:center;font-weight:700;color:var(--muted);border-top:8px solid var(--bg);cursor:pointer">Cancel</div>' +
    '</div>';
  document.body.appendChild(ov);
};

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
            var isVideo = _isVid(m.media_key);
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
                  '<div style="font-size:.7rem;color:' + (isMe ? '#4c8a63' : 'var(--muted)') + ';margin-bottom:.15rem;text-overflow:ellipsis;overflow:hidden;white-space:nowrap">' + escHtml(new URL(rawUrl).hostname) + '</div>' +
                  '<div style="font-size:.82rem;font-weight:700;color:' + (isMe ? '#12241d' : 'var(--text)') + ';line-height:1.3">' + escHtml(res.title.slice(0, 80)) + '</div>' +
                  (res.description ? '<div style="font-size:.72rem;color:' + (isMe ? '#3f7a58' : 'var(--muted)') + ';margin-top:.2rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + escHtml(res.description.slice(0, 120)) + '</div>' : '') +
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

      // Clear the local unread badge whenever you OPEN a room — including one
      // you're only spectating — so the badge goes down the moment you view it.
      var _cachedRoom = CHAT_rooms.find(function (r) { return r.id === CHAT_curRoom.id; });
      if (_cachedRoom) _cachedRoom.unread = 0;
      // Remember locally that we've seen this room up to now, so the badge stays
      // down on later server polls (for spectated chats the server never marks
      // them read, so without this the count would keep coming back).
      _markRoomSeenLocally(CHAT_curRoom.id);
      if (typeof _refreshChatNavBadge === 'function') _refreshChatNavBadge();
      // Only tell the SERVER for rooms you're actually a member of — spectating
      // must stay invisible and leave no read trace.
      if (CHAT_curRoom.joined !== false) {
        api.post('/chat/read', { room_id: CHAT_curRoom.id }).catch(function () {});
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

function _isVid(key) { return /\.(mp4|webm|mov|mkv|avi|m4v|3gp|3g2|ogv|qt|mpeg|mpg|wmv|flv|ts|mts|m2ts|divx)$/i.test(key || ''); }

function renderMessages(scrollDown) {
  if (typeof applyChatWallpaper === 'function') applyChatWallpaper();
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
    // Telegram-style grouping: consecutive messages from the same sender within
    // a few minutes are one visual group — name on the first, avatar on the
    // last, tighter spacing between.
    var _prevM = CHAT_messages[idx - 1];
    var _nextM = CHAT_messages[idx + 1];
    var _grpGap = 5 * 60 * 1000;
    var _sameGrp = function (a, b) {
      if (!a || !b) return false;
      if (a.sender_id !== b.sender_id) return false;
      if (a.type === 'system' || b.type === 'system') return false;
      if ((a.created_at || '').slice(0, 10) !== (b.created_at || '').slice(0, 10)) return false;
      var ta = new Date(a.created_at).getTime(), tb = new Date(b.created_at).getTime();
      return Math.abs(tb - ta) < _grpGap;
    };
    var firstInGroup = !_sameGrp(_prevM, m);
    var lastInGroup  = !_sameGrp(m, _nextM);
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
      ? '<svg width="16" height="10" viewBox="0 0 16 10" fill="none" style="display:inline-block;vertical-align:middle;margin-left:2px"><path d="M1 5l3 3 5-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 5l3 3 5-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" style="display:inline-block;vertical-align:middle;margin-left:2px"><path d="M1 5l3 3 5-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
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

    // Skip empty/contentless bubbles: a media/file/voice message whose file
    // never arrived and that carries no real text is just a stray icon +
    // timestamp. These are the blank download bubbles that tagged along when
    // several files were sent — hide them entirely.
    var _mTxt = (m.text || '').trim();
    var _mHasText = _mTxt && _mTxt !== '__once__';
    if ((m.type === 'media' || m.type === 'file' || m.type === 'voice') && !m.media_url && !_mHasText) {
      return '';
    }

    var isMediaMsg = (m.type === 'media' && m.media_url);
    var isEmojiOnlyMsg = ((m.type === 'text' || !m.type) && _isEmojiOnlyText(m.text));
    var bubbleClass = 'bubble ' + (isMe ? 'me' : 'them') + (isMediaMsg ? ' bubble-media' : '') + (isEmojiOnlyMsg ? ' bubble-emoji' : '');
    var inner = '';

    // Group sender nick
    if (!isMe && isGroup && firstInGroup) {
      var titleBadge = m.sender_title
        ? '<span style="margin-right:.35rem;padding:.05rem .4rem;border-radius:8px;background:rgba(31,111,92,.12);color:var(--blue);font-size:.62rem;font-weight:700;vertical-align:middle">' + escHtml(m.sender_title) + '</span>'
        : '';
      inner += '<div class="bubble-nick" style="cursor:pointer;color:' + nameColor(m.sender_id || m.sender_nick) + '"><span onclick="openUserProfile(\'' + m.sender_id + '\')">' + escHtml(m.sender_nick || '') + '</span>' + titleBadge + '</div>';
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
        var quotedNameColor = nameColor(quoted.sender_id || quoted.sender_nick);
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
        var bars = voiceData.peaks.length ? _renderWaveBars(voiceData.peaks) : _fakeBars(28);
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
        '<div class="voice-bars">' + _fakeBars(28) + '</div>' +
        '<div class="voice-dur">' + (m.text || '0:00') + '</div>' +
      '</div>';

    } else if (m.type === 'media' && m.media_url) {
      var isOnce  = m.text === '__once__';
      var albumInfo = albumGroups[m.id];
      if (isOnce) {
        inner += '<div style="background:rgba(0,0,0,.08);border-radius:10px;padding:.75rem;text-align:center;cursor:pointer" onclick="_openOnce(\'' + m.id + '\',this)">' +
          '<div style="font-size:1.5rem">👁</div>' +
          '<div style="font-size:.78rem;margin-top:.25rem">View once · tap to open</div>' +
        '</div>';
      } else if (albumInfo && albumInfo.index > 0) {
        inner = ''; // rendered as part of the album by the first item
      } else if (albumInfo && albumInfo.total > 1) {
        // Album grid — handles a mix of photos AND videos, whatever the first
        // item is (previously the grid only rendered when the first item was a
        // video, so image-first albums left the videos as empty bubbles).
        var cols = albumInfo.total === 2 ? 2 : 3;
        inner += '<div class="media-album cols-' + cols + '">';
        albumInfo.ids.forEach(function (aid) {
          var am = CHAT_messages.find(function (x) { return x.id === aid; });
          if (!am || !am.media_url) return;
          var aIsVid = _isVid(am.media_key);
          inner += '<div class="media-album-item" onclick="_openMediaViewer(\'' + aid + '\')">' +
            (aIsVid
              ? '<video src="' + am.media_url + '" preload="metadata" playsinline></video>' +
                '<div class="media-album-play"><div style="width:28px;height:28px;border-radius:50%;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center"><svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></div></div>'
              : '<img src="' + am.media_url + '" loading="lazy">') +
          '</div>';
        });
        inner += '</div>';
      } else if (_isVid(m.media_key)) {
        inner += '<div class="video-bubble-wrap" onclick="_openMediaViewer(\'' + m.id + '\')">' +
          '<video src="' + m.media_url + '" preload="metadata" playsinline></video>' +
          '<div class="video-bubble-play"><div class="video-bubble-play-btn"><svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></div></div>' +
        '</div>';
      } else {
        inner += '<img src="' + m.media_url + '" onerror="_imgRetry(this)" style="max-width:260px;border-radius:10px;display:block;cursor:pointer;width:100%;aspect-ratio:4/5;object-fit:cover;background:#000" loading="lazy" onclick="_openMediaViewer(\'' + m.id + '\')">';
      }
      if (m.text && m.text !== '__once__') {
        var capRTL = /[\u0590-\u05FF]/.test(m.text);
        inner += '<div style="margin-top:.35rem;font-size:.88rem;unicode-bidi:plaintext;' + (capRTL ? 'direction:rtl;text-align:right' : '') + '">' + _linkify(escHtml(m.text), isMe) + '</div>';
      }

    } else if ((m.type === 'media' || m.type === 'file' || m.type === 'voice') && !m.media_url) {
      // A media message whose file never arrived (e.g. a Telegram video over
      // the Bot API's 20MB limit, or a failed upload). Show a clear note
      // instead of an empty bubble with a stray download icon.
      inner += '<div style="display:flex;align-items:center;gap:.5rem;font-size:.82rem;opacity:.7;min-width:150px">' +
        '<span style="font-size:1.3rem">📎</span>' +
        '<span dir="auto">' + escHtml(m.text && m.text !== '__once__' ? m.text : 'Media unavailable') + '</span>' +
      '</div>';

    } else if (m.type === 'file' && m.media_url) {
      var fk = (m.media_key || m.media_url || '').toLowerCase();
      var fname = escHtml(m.text || 'File');
      var nameKey = ((m.text || '') + ' ' + fk).toLowerCase();
      var isAudioFile = /\.(mp3|m4a|aac|ogg|wav|flac|opus)(\?|$|\s)/i.test(nameKey);
      var isImageFile = /\.(jpe?g|png|gif|webp|bmp|heic|heif)(\?|$|\s)/i.test(nameKey);
      var isVideoFile = /\.(mp4|webm|mov|mkv|m4v|avi)(\?|$|\s)/i.test(nameKey);
      if (isImageFile) {
        // An image that came through as a "file" — show it inline and open it
        // in the full-screen viewer on tap, exactly like a normal photo.
        inner += '<img src="' + m.media_url + '" onerror="_imgRetry(this)" style="max-width:260px;width:100%;max-height:340px;border-radius:10px;display:block;cursor:pointer;object-fit:contain;background:#000" loading="lazy" onclick="_openMediaViewer(\'' + m.id + '\')">';
        if (m.text && !/\.(jpe?g|png|gif|webp|bmp|heic|heif)\s*$/i.test((m.text || '').trim())) {
          var _ic = /[\u0590-\u05FF]/.test(m.text);
          inner += '<div style="margin-top:.3rem;font-size:.85rem;unicode-bidi:plaintext;' + (_ic ? 'direction:rtl;text-align:right' : '') + '">' + _linkify(escHtml(m.text), isMe) + '</div>';
        }
      } else if (isVideoFile) {
        // A video that came through as a "file" — tap to play in the viewer,
        // just like a normal video message.
        inner += '<div class="video-bubble-wrap" onclick="_openMediaViewer(\'' + m.id + '\')">' +
          '<video src="' + m.media_url + '" preload="metadata" playsinline></video>' +
          '<div class="video-bubble-play"><div class="video-bubble-play-btn"><svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></div></div>' +
        '</div>';
        if (m.text && !/\.(mp4|webm|mov|mkv|m4v|avi)\s*$/i.test((m.text || '').trim())) {
          var _vc = /[\u0590-\u05FF]/.test(m.text);
          inner += '<div style="margin-top:.3rem;font-size:.85rem;unicode-bidi:plaintext;' + (_vc ? 'direction:rtl;text-align:right' : '') + '">' + _linkify(escHtml(m.text), isMe) + '</div>';
        }
      } else if (isAudioFile) {
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
        inner += '<a href="' + m.media_url + '" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:.6rem;text-decoration:none;color:inherit;min-width:180px">' +
          '<div style="font-size:2rem;flex-shrink:0">' + ficon + '</div>' +
          '<div style="min-width:0"><div style="font-size:.83rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px" dir="auto">' + fname + '</div>' +
          '<div style="font-size:.68rem;opacity:.65;margin-top:.1rem">Tap to open</div></div>' +
        '</a>';
      }

    } else if (m.type === 'text' || !m.type) {
      // Text — detect links, auto-detect RTL for Hebrew/Yiddish
      var isRTL = /[\u0590-\u05FF\uFB1D-\uFB4F]/.test(m.text || '');
      var txtStyle = 'unicode-bidi:plaintext;display:block;overflow-wrap:break-word;word-break:keep-all;' + (isRTL ? 'direction:rtl;text-align:right' : '');
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
      ? (lastInGroup
          ? '<div class="msg-mini-av" style="background:' + avatarColor(m.sender_id || m.sender_nick) + (m.sender_photo ? ';background-image:url(' + m.sender_photo + ');background-size:cover;background-position:center' : '') + '">' + escHtml((m.sender_nick || '?').slice(0, 1).toUpperCase()) + '</div>'
          : '<div class="msg-mini-av-spacer"></div>')
      : '';

    var selectClass2 = CHAT_selected[m.id] ? ' msg-selected' : '';

    return dateSep +
      '<div class="msg-wrap' + (isMe ? ' me' : '') + selectClass2 + (!lastInGroup ? ' grp-tight' : '') + '" id="msg-' + m.id + '" data-id="' + m.id + '"' +
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
  }).filter(function (u) { return u.html && u.html.trim(); });
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
      // Only allow LEFTWARD swipe (right-to-left) for reply, so it never
      // fights the left-to-right edge-swipe that goes Back. Clamp the drag.
      if (dx < 0 && Math.abs(dy) < 40) {
        var clamped = Math.max(dx, -70);
        bubble.style.transform = 'translateX(' + clamped + 'px)';
        var icon = bubble.querySelector('.swipe-reply-icon');
        if (icon) icon.style.opacity = Math.min(1, Math.abs(clamped) / 50);
      }
    }, { passive: true });

    bubble.addEventListener('touchend', function (e) {
      clearTimeout(longPressTimer);
      dragging = false;
      var transform = bubble.style.transform;
      var dx = 0;
      var match = transform.match(/translateX\((-?[\d.]+)px\)/);
      if (match) dx = parseFloat(match[1]);

      bubble.style.transition = 'transform .2s ease';
      bubble.style.transform = 'translateX(0)';
      setTimeout(function () { bubble.style.transition = ''; }, 220);
      var icon = bubble.querySelector('.swipe-reply-icon');
      if (icon) icon.style.opacity = '0';

      // Far enough LEFT → open reply.
      if (dx < -45) {
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
  inp.style.height = Math.min(inp.scrollHeight, 150) + 'px';
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
    sender_photo: me.photo_url || null,
    type: 'text', text: msgText, created_at: now, read: 0,
    reply_to_id: payload.reply_to_id || null,
    _pending: true,
  };
  CHAT_messages.push(tempMsg);
  renderMessages(false);
  scrollToBottom();

  api.post('/chat', payload)
    .then(function (res) {
      if (wasScheduled) {
        toast('🕓 Message scheduled');
        CHAT_messages = CHAT_messages.filter(function(m){ return m.id !== tempId; });
        renderMessages(false);
      } else if (res && res.message) {
        // Swap the optimistic message for the real one (real id, confirmed) —
        // no full reload, so it's instant and the reply quote stays put.
        var real = res.message;
        if (real.media_key && !real.media_url) real.media_url = '/api/media/' + encodeURIComponent(real.media_key);
        real.sender_nick = real.sender_nick || tempMsg.sender_nick;
        real.sender_photo = real.sender_photo || tempMsg.sender_photo;
        var i = CHAT_messages.findIndex(function (m) { return m.id === tempId; });
        if (i !== -1) CHAT_messages[i] = real; else CHAT_messages.push(real);
        renderMessages(false);
      } else {
        loadMessages(true);
      }
      _resetMsgOptions();
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
  if (!files.length) return;
  // Upload ONE FILE AT A TIME. Firing all of them at once (the old behavior)
  // overwhelmed the browser's connection pool and the server, so when someone
  // sent ~10 files several would silently fail and leave blank bubbles. Chain
  // them so each waits for the previous to finish, then refresh once at the end.
  var i = 0;
  function next() {
    if (i >= files.length) {
      // Single refresh after the whole batch, not once per file.
      loadMessages(true); loadChatRooms();
      return;
    }
    var f = files[i];
    var cap = i === 0 ? caption : '';
    i++;
    _uploadOneFile(f, cap, next); // next() runs when this one settles
  }
  next();
};

function _uploadOneFile(file, caption, done) {
  // done() is an optional callback fired (on success OR failure) once this
  // file has settled — used to chain a multi-file batch sequentially.
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

  // The request is capped at 105MB before it ever reaches the handler, so a
  // bigger file is a long upload that can only end in a rejection.
  if (!checkFileSize(file, 100, 'File')) { if (done) done(); return; }

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
      // Revoke the local preview only AFTER the re-render has swapped in the
      // server copy — revoking immediately can break the still-showing <img>
      // (a "failed to load blob:" error) during the transition.
      setTimeout(function () { try { URL.revokeObjectURL(localUrl); } catch (e) {} }, 6000);
      // In a batch, the caller refreshes once at the very end; only refresh
      // here when this is a standalone single send.
      if (done) { done(); } else { loadMessages(true); loadChatRooms(); }
    })
    .catch(function (err) {
      toast('❌ ' + err.message);
      CHAT_messages = CHAT_messages.filter(function (m) { return m.id !== tempId; });
      renderMessages(false);
      if (done) done();
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
    vid.onended = function () { vid.removeAttribute('src'); vid.load(); prev.innerHTML = '<div style="font-size:.78rem;opacity:.5">Opened</div>'; };
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
  var rn = document.getElementById('reply-nick');
  rn.textContent = msg.sender_id === meId ? 'You' : (msg.sender_nick || 'User');
  var col = (typeof nameColor === 'function') ? nameColor(msg.sender_id || msg.sender_nick) : 'var(--accent,#1F6F5C)';
  rn.style.color = col;
  var body = document.querySelector('.reply-bar-body');
  if (body) body.style.borderInlineStartColor = col;
  var snip = msg.text || (msg.type === 'voice' ? '🎤 Voice message'
    : msg.type === 'media' ? '📷 Photo'
    : msg.type === 'file' ? '📎 File'
    : msg.type === 'sticker' ? 'Sticker'
    : '[media]');
  document.getElementById('reply-snip').textContent = String(snip).slice(0, 80);
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
  var SVG_SHARE_APPS = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>';

  items += item(SVG.reply,    'Reply',        'ctxReply()');
  // If the group admin turned off "Allow saving content", regular members can't
  // copy / forward / save / share messages out of the room.
  var _isSuperA = STATE.user && (STATE.user.role === 'admin_super' || STATE.user.is_owner);
  var _canSave = !CHAT_curRoom || CHAT_curRoom.allow_saving !== false ||
    (CHAT_curRoom.is_group_admin || _isSuperA);
  if (_canSave && (msg.type === 'text' || msg.type === 'media')) items += item(SVG.copy, 'Copy', 'ctxCopy()');
  if (canEdit)   items += item(SVG.edit,      'Edit',         'ctxEdit()');
  if (_canSave)  items +=        item(SVG.forward,  'Forward',      'ctxForward()');
  if (canPin)    items += item(SVG.pin,       'Pin',          'ctxPin()');
  if (_canSave)  items +=        item(SVG_BOOKMARK, 'Save Message', 'bookmarkMessage(CHAT_ctxMsg.id)');
  if (_canSave)  items +=        item(SVG_SHARE_APPS, 'Share to apps', 'ctxShare()');
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
    'ctxDelete()': ctxDelete, 'ctxShare()': ctxShare,
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
  // Natural-looking pseudo-waveform (deterministic so it doesn't flicker on
  // re-render). Clear height variation so it reads as a waveform, not dots.
  var bars = '';
  for (var i = 0; i < n; i++) {
    var v = Math.abs(Math.sin(i * 1.3) * 0.5 + Math.sin(i * 0.6 + 1) * 0.3 + Math.sin(i * 2.7) * 0.2);
    var h = 3 + Math.round(v * 21); // 3..24px
    bars += '<div class="vbar" style="height:' + h + 'px"></div>';
  }
  return bars;
}

function _linkify(text, isMe) {
  var c = isMe ? '#0d6b50' : 'var(--blue)';
  var mkA = function (href, label) {
    return '<a href="' + href + '" target="_blank" rel="noopener" style="color:' + c + ';overflow-wrap:break-word;text-decoration:underline">' + label + '</a>';
  };
  // Full URLs first.
  var out = text.replace(/(https?:\/\/[^\s<>"]+)/g, function (url) { return mkA(url, url); });
  // Then bare domains like "Yidplus.com" or "www.site.org/x" (not already linked).
  out = out.replace(/(^|[\s(>])((?:www\.)?[a-z0-9-]+\.(?:com|org|net|co|io|me|il|info|gov|edu|app|shop|news|xyz|online)(?:\/[^\s<]*)?)/gi,
    function (m, pre, dom) { return pre + mkA('https://' + dom, dom); });
  // @username mentions → tappable, open a private chat with that person
  // (like Telegram). Must be preceded by start/space so emails don't match.
  out = out.replace(/(^|[\s(>])@([a-zA-Z0-9_]{2,32})\b/g, function (m, pre, uname) {
    return pre + '<span onclick="openMention(\'' + escJs(uname) + '\')" style="color:' + c + ';cursor:pointer;font-weight:600">@' + uname + '</span>';
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
  // Normalise to the actual min/max so even a fairly flat recording shows a
  // real waveform instead of a row of same-height dots.
  var max = 0, min = Infinity;
  peaks.forEach(function (p) { if (p > max) max = p; if (p < min) min = p; });
  var range = (max - min) || 1;
  return peaks.map(function (p, i) {
    var norm = (p - min) / range;                 // 0..1
    // A touch of shape so silence still looks alive, like WhatsApp.
    norm = norm * 0.85 + Math.abs(Math.sin(i * 0.9)) * 0.15;
    var h = Math.max(3, Math.round(3 + norm * 21)); // 3..24px
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
    // Telegram channels only list once you've joined them, so search is the
    // only way to find a new one — it has to look here too. The full set is
    // already loaded, so this is a local filter rather than another round trip.
    var tgHits = (CHAT_tgChannels || []).filter(function (t) {
      return ((t.title || '') + ' ' + t.username).toLowerCase().indexOf(qLower) !== -1;
    });
    calls.push(Promise.resolve({ kind: 'tgchannels', items: tgHits }));
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
      var label = { chats: 'Your Chats', groups: 'Groups', channels: 'Channels', tgchannels: 'Telegram Channels', users: 'Users', messages: 'Messages' }[g.kind];
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
      } else if (g.kind === 'tgchannels') {
        html += g.items.map(function (t) {
          var av = t.photo_url
            ? '<div class="chat-av" style="width:38px;height:38px;background-image:url(' + t.photo_url + ');background-size:cover;background-position:center"></div>'
            : '<div class="chat-av" style="width:38px;height:38px;font-size:1rem;background:#229ED9;color:#fff">\ud83d\udce8</div>';
          var join = t.joined
            ? '<span style="font-size:.68rem;color:var(--muted);margin-left:auto">Joined</span>'
            : '<button onclick="event.stopPropagation();tgQuickJoin(\'' + escHtml(t.username) + '\',this)" style="margin-left:auto;background:#229ED9;color:#fff;border:none;border-radius:14px;padding:.2rem .8rem;font-size:.7rem;font-weight:700;cursor:pointer">Join</button>';
          return '<div style="display:flex;align-items:center;gap:.65rem;padding:.55rem .5rem;cursor:pointer" onclick="document.getElementById(\'global-search-modal\').remove();openTelegramChannel(\'' + escHtml(t.username) + '\',\'' + escJs(t.title || t.username) + '\')">' +
            av +
            '<div style="min-width:0"><div style="font-size:.86rem;font-weight:600;unicode-bidi:plaintext;text-align:left;direction:ltr">' + escHtml(t.title || t.username) + '</div>' +
            '<div style="font-size:.68rem;color:var(--muted)">' + _tgMembersLabel(t.members) + '</div></div>' +
            join +
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
  // Only restore the composer if this viewer is actually allowed to write —
  // otherwise leaving select mode would bring it back for guests / read-only.
  if (ib) {
    if (typeof _applyChannelInputState === 'function') _applyChannelInputState(CHAT_curRoom);
    else ib.style.display = 'flex';
  }
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

  // This runs after openChatRoom and used to unconditionally re-show the
  // composer for any non-channel room — undoing the hide for guests and for
  // admins-only groups. Use the SAME test openChatRoom uses, so the two can
  // never disagree.
  var isGuest = !!(window.GUEST_MODE || (room && room.guest_view)) && !(window.STATE && STATE.user);
  var _isSuper = !!(window.STATE && STATE.user && (STATE.user.role === 'admin_super' || STATE.user.is_owner));
  var lockedRO = !!(room && room.type === 'group' &&
                    room.read_only && !room.is_group_admin && !_isSuper);
  if (isGuest || lockedRO) {
    if (ib) ib.style.display = 'none';
    var roBar0 = document.getElementById('readonly-bar');
    if (roBar0) roBar0.style.display = 'none';
    if (recBar) recBar.classList.remove('show');
    if (recLock) recLock.classList.remove('show');
    return;
  }

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
        toast('You don\'t have a status yet');
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
        toast('This status is no longer active');
        loadChatRooms(); // refresh so the stale ring disappears
        return;
      }
      HOME_svStatuses = [data];
      openSV(0);
    })
    .catch(function (err) {
      console.error('status open failed:', err);
      toast('Could not load: ' + (err && err.message ? err.message : 'unknown error'));
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

// Turn URLs (and bare domains like "Yidplus.com") in status text into
// tappable links. onclick stops the tap from also navigating the story.
function _svLinkify(text) {
  var esc = escHtml(text || '');
  var linkStyle = 'color:#6cb2ff;text-decoration:underline;word-break:break-all';
  // Full URLs first.
  esc = esc.replace(/(https?:\/\/[^\s<]+)/gi, function (u) {
    return '<a href="' + u + '" target="_blank" rel="noopener" style="' + linkStyle + '" onclick="event.stopPropagation()">' + u + '</a>';
  });
  // Then bare domains not already inside a link (word.tld[/path]).
  esc = esc.replace(/(^|[\s>(])((?:www\.)?[a-z0-9-]+\.(?:com|org|net|co|io|me|il|info|gov|edu|app|shop|news)(?:\/[^\s<]*)?)/gi,
    function (m, pre, dom) {
      return pre + '<a href="https://' + dom + '" target="_blank" rel="noopener" style="' + linkStyle + '" onclick="event.stopPropagation()">' + dom + '</a>';
    });
  return esc;
}

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
        cap.innerHTML = _svLinkify(slide.text);
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
    el.innerHTML = '<div style="max-width:90%;unicode-bidi:plaintext">' + _svLinkify(slide.text || '') + '</div>';
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

// Jump straight to the NEXT person's statuses (WhatsApp horizontal swipe).
window.svNextUser = function () {
  if (HOME_svUserIdx < HOME_svStatuses.length - 1) {
    HOME_svUserIdx++;
    HOME_svSlideIdx = 0;
    _svShowSlide();
  } else {
    closeSV();
  }
};
// Jump to the PREVIOUS person's first status.
window.svPrevUser = function () {
  if (HOME_svUserIdx > 0) {
    HOME_svUserIdx--;
    HOME_svSlideIdx = 0;
    _svShowSlide();
  } else {
    HOME_svSlideIdx = 0;
    _svShowSlide();
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

// Track finger movement: mark as moved (so it isn't a tap) and give a live
// drag-down feedback so swiping down to close feels responsive.
window.svTouchMove = function (e) {
  if (!e.touches || !e.touches[0]) return;
  var t = e.touches[0];
  var dx = t.clientX - _svTouchX;
  var dy = t.clientY - _svTouchY;
  // Only treat it as a real move past ~16px, so a normal tap (with a little
  // finger jitter) still counts as a tap and navigates.
  if (Math.abs(dx) > 16 || Math.abs(dy) > 16) {
    _svTouchMoved = true;
    if (HOME_svLongTimer) { clearTimeout(HOME_svLongTimer); HOME_svLongTimer = null; }
  }
  // Clear downward drag → move the viewer with the finger (feedback for close).
  if (dy > 24 && dy > Math.abs(dx) * 1.4) {
    var overlay = document.getElementById('sv-overlay');
    if (overlay) {
      overlay.style.transition = '';
      overlay.style.transform = 'translateY(' + Math.min(dy, 300) + 'px)';
      overlay.style.opacity = String(Math.max(0.3, 1 - dy / 650));
    }
  }
};

window.svTouchEnd = function (e) {
  var wasLongPress = !HOME_svLongTimer; // timer already fired = long press
  clearTimeout(HOME_svLongTimer);
  HOME_svLongTimer = null;

  var overlay = document.getElementById('sv-overlay');
  var touch = e.changedTouches[0];
  var dy = touch.clientY - _svTouchY;
  var dx = touch.clientX - _svTouchX;

  // A tap on a link opens the link — don't navigate and DON'T preventDefault.
  if (!_svTouchMoved && e.target && e.target.closest && e.target.closest('a')) {
    if (overlay) { overlay.style.transition = 'transform .18s ease, opacity .18s ease'; overlay.style.transform = ''; overlay.style.opacity = ''; }
    return;
  }
  // Suppress the synthetic mouse events the browser fires after a touch.
  if (e.cancelable) e.preventDefault();

  // Did the user drag down far enough to dismiss?
  var willClose = _svTouchMoved && dy > 70 && dy > Math.abs(dx);

  if (overlay) {
    if (willClose) {
      // Slide the rest of the way out, then close — no bounce.
      overlay.style.transition = 'transform .18s ease, opacity .18s ease';
      overlay.style.transform = 'translateY(100%)';
      overlay.style.opacity = '0';
      setTimeout(function () { closeSV(); }, 170);
      return;
    }
    // Not dismissing → settle back into place.
    overlay.style.transition = 'transform .2s ease, opacity .2s ease';
    overlay.style.transform = '';
    overlay.style.opacity = '';
    setTimeout(function () { if (overlay) overlay.style.transition = ''; }, 220);
  }

  if (wasLongPress) {
    // Releasing after long press → resume silently
    HOME_svPaused = false;
    var vid = document.querySelector('#sv-slide video');
    if (vid) vid.play().catch(function(){});
    _svResyncBar();
  } else if (!_svTouchMoved) {
    // Normal tap → navigate within the current person's slides
    if (touch.clientX < window.innerWidth * 0.3) {
      svPrev();
    } else {
      svNext();
    }
  } else if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) {
    // Horizontal swipe → jump to the next / previous PERSON (WhatsApp-style)
    if (dx < 0) svNextUser();
    else svPrevUser();
  }
};

// Detect scroll/swipe-away so we don't accidentally navigate
document.addEventListener('touchmove', function (e) {
  if (!document.getElementById('sv-overlay').classList.contains('open')) return;
  var t = e.touches[0];
  if (Math.abs(t.clientX - _svTouchX) > 16 || Math.abs(t.clientY - _svTouchY) > 16) {
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
  if (vid) { vid.pause(); vid.removeAttribute('src'); vid.load(); }
  var ov = document.getElementById('sv-overlay');
  if (ov) { ov.style.transition = ''; ov.style.transform = ''; ov.style.opacity = ''; ov.classList.remove('open'); }
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

// ── Browser Back ──
// Nothing in the app listened for popstate, and every view used replaceState,
// so no history entries existed at all: pressing Back walked straight out of
// the app instead of closing the chat you had open. Opens now push an entry,
// and this puts you back where that entry says you were.
var _navFromPop = false;
window.addEventListener('popstate', function () {
  _navFromPop = true;
  try {
    var hash = window.location.hash || '';
    var room = hash.match(/room=([^&]+)/);
    var tg = hash.match(/tg=([^&]+)/);

    if (room) {
      if (typeof openChatRoom === 'function') openChatRoom(decodeURIComponent(room[1]));
    } else if (tg) {
      if (typeof openTelegramChannel === 'function') openTelegramChannel(decodeURIComponent(tg[1]), '');
    } else {
      // No view in the URL = back at the list.
      var cr = document.getElementById('screen-chatroom');
      if (cr && !cr.classList.contains('hidden') && typeof closeChatRoom === 'function') closeChatRoom();
    }
  } finally {
    _navFromPop = false;
  }
});

/* ══════════════════════════════════════════════════════════════════════
   YID PLUS AI  —  a self-contained assistant chat.
   Lives as a pinned row at the top of the chat list and opens its own
   full-screen view. Talks to /api/ai/chat. Deliberately independent of the
   rooms/messages system so it can't destabilise it.
   ═════════════════════════════════════════════════════════════════════ */

var AI_state = { messages: [], sending: false, loaded: false };

// The pinned entry in the chat list.
function _aiChatRow() {
  try {
    // Owner turned it off for everyone -> it disappears from the chat list.
    if (window.STATE && STATE.settings && STATE.settings.ai_enabled === 'false') return '';
    if (typeof CHAT_activeFolder !== 'undefined' && CHAT_activeFolder) return '';
    if (typeof CHAT_tab !== 'undefined' && !(CHAT_tab === 'all' || CHAT_tab === 'private')) return '';
    if (typeof CHAT_search !== 'undefined' && CHAT_search) {
      var s = CHAT_search.toLowerCase();
      if ('yid plus ai'.indexOf(s) === -1 && s.indexOf('ai') === -1) return '';
    }
  } catch (e) {}
  return '<div class="chat-item-wrap">' +
    '<div class="chat-item" onclick="openAIChat()" style="background:linear-gradient(90deg,rgba(34,158,217,.10),transparent)">' +
      '<div class="chat-av chat-av-round" style="background:linear-gradient(135deg,#2B8A73,#1F6F5C);color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.2rem">🤖</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:.18rem;gap:.4rem">' +
          '<div style="font-size:.94rem;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1">YID PLUS AI <span style="font-size:.6rem;font-weight:700;color:#fff;background:#1F6F5C;padding:.05rem .3rem;border-radius:4px;vertical-align:middle">AI</span></div>' +
        '</div>' +
        '<div style="font-size:.83rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Ask me anything · Ask me anything</div>' +
      '</div>' +
    '</div>' +
  '</div>';
}

window.openAIChat = function () {
  if (!document.getElementById('ai-chat-style')) {
    var st = document.createElement('style');
    st.id = 'ai-chat-style';
    st.textContent =
      '.ai-typing{display:inline-flex;gap:4px;align-items:center;padding:.15rem 0}' +
      '.ai-typing span{width:7px;height:7px;border-radius:50%;background:var(--muted);animation:aiblink 1.2s infinite ease-in-out both}' +
      '.ai-typing span:nth-child(2){animation-delay:.2s}' +
      '.ai-typing span:nth-child(3){animation-delay:.4s}' +
      '@keyframes aiblink{0%,80%,100%{opacity:.25;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}';
    document.head.appendChild(st);
  }

  var old = document.getElementById('ai-chat-screen');
  if (old) old.remove();

  var ov = document.createElement('div');
  ov.id = 'ai-chat-screen';
  ov.style.cssText =
    'position:fixed;inset:0;z-index:2000;background:var(--bg);display:flex;flex-direction:column';
  ov.innerHTML =
    // Header
    '<div style="flex-shrink:0;display:flex;align-items:center;gap:.6rem;padding:calc(.6rem + env(safe-area-inset-top,0px)) .8rem .6rem;background:linear-gradient(135deg,#2B8A73,#1F6F5C);color:#fff">' +
      '<button onclick="closeAIChat()" style="background:none;border:none;color:#fff;font-size:1.4rem;cursor:pointer;padding:.1rem .3rem;line-height:1">‹</button>' +
      '<div style="width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0">🤖</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-weight:800;font-size:1rem" id="ai-title">YID PLUS AI</div>' +
        '<div style="font-size:.68rem;opacity:.85" id="ai-subtitle">Ready to help</div>' +
      '</div>' +
      '<button onclick="clearAIChat()" title="Clear" style="background:none;border:none;color:#fff;cursor:pointer;padding:.3rem;opacity:.9"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>' +
    '</div>' +
    // Messages
    '<div id="ai-messages" style="flex:1;overflow-y:auto;padding:.9rem;display:flex;flex-direction:column;gap:.6rem"></div>' +
    // Input bar
    '<div style="flex-shrink:0;display:flex;gap:.5rem;align-items:flex-end;padding:.6rem .7rem calc(.6rem + env(safe-area-inset-bottom,0px));border-top:1px solid var(--border);background:var(--surface)">' +
      '<textarea id="ai-input" rows="1" placeholder="Type a message…" oninput="_aiAutogrow(this)" onkeydown="_aiInputKey(event)" style="flex:1;resize:none;max-height:120px;padding:.6rem .7rem;border:1px solid var(--border);border-radius:20px;background:var(--bg3);color:var(--text);font-family:inherit;font-size:.9rem;unicode-bidi:plaintext" dir="auto"></textarea>' +
      '<button id="ai-send" onclick="_aiSend()" style="flex-shrink:0;width:42px;height:42px;border-radius:50%;border:none;background:#1F6F5C;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>' +
    '</div>';
  document.body.appendChild(ov);

  _aiRenderMessages();
  _aiLoadHistory();
  setTimeout(function () { var i = document.getElementById('ai-input'); if (i) i.focus(); }, 100);
};

window.closeAIChat = function () {
  var ov = document.getElementById('ai-chat-screen');
  if (ov) ov.remove();
};

function _aiAutogrow(t) {
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 120) + 'px';
}
window._aiAutogrow = _aiAutogrow;

window._aiInputKey = function (e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _aiSend(); }
};

function _aiLoadHistory() {
  if (AI_state.loaded) return;
  api.get('/ai/chat')
    .then(function (res) {
      AI_state.messages = (res && res.messages) || [];
      AI_state.loaded = true;
      AI_state.notConfigured = !!(res && res.configured === false);
      AI_state.disabled = !!(res && res.enabled === false);
      if (res && res.name) {
        AI_state.name = res.name;
        var t = document.getElementById('ai-title'); if (t) t.textContent = res.name;
      }
      if (res && res.welcome) AI_state.welcome = res.welcome;
      _aiRenderMessages();
    })
    .catch(function () { /* keep empty; welcome shows */ });
}

// Escape, then apply a little safe markdown: **bold**, *italic*, `code`, and
// newlines. Everything is escaped first so no raw HTML from the model renders.
function _aiFormat(text) {
  var s = escHtml(String(text || ''));
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<i>$2</i>');
  s = s.replace(/`([^`]+)`/g, '<code style="background:rgba(128,128,128,.18);padding:.05rem .25rem;border-radius:4px">$1</code>');
  s = s.replace(/\n/g, '<br>');
  return s;
}

function _aiBubble(role, content, isTyping) {
  var mine = role === 'user';
  var bg = mine ? '#1F6F5C' : 'var(--surface)';
  var col = mine ? '#fff' : 'var(--text)';
  var align = mine ? 'flex-end' : 'flex-start';
  var radius = mine ? '16px 16px 4px 16px' : '16px 16px 16px 4px';
  var border = mine ? 'none' : '1px solid var(--border)';
  // A generated image is carried in the content as [img:URL].
  var imgHtml = '', text = content || '';
  var im = text.match(/\[img:([^\]]+)\]/);
  if (im) {
    text = text.replace(/\[img:[^\]]+\]/, '').trim();
    imgHtml = '<img src="' + escHtml(im[1]) + '" onclick="window.open(this.src,\'_blank\')" style="display:block;margin-top:' + (text ? '.45rem' : '0') + ';max-width:100%;width:288px;max-width:100%;border-radius:12px;cursor:pointer" loading="lazy">';
  }
  var inner = isTyping
    ? '<span class="ai-typing"><span></span><span></span><span></span></span>'
    : (text ? _aiFormat(text) : '') + imgHtml;
  return '<div style="align-self:' + align + ';max-width:85%;background:' + bg + ';color:' + col + ';border:' + border + ';padding:.55rem .75rem;border-radius:' + radius + ';font-size:.9rem;line-height:1.5;word-break:break-word;white-space:normal;unicode-bidi:plaintext" dir="auto">' + inner + '</div>';
}

function _aiRenderMessages() {
  var el = document.getElementById('ai-messages');
  if (!el) return;

  var html = '';

  // Welcome / intro when empty.
  if (!AI_state.messages.length) {
    var wname = AI_state.name || 'YID PLUS AI';
    var wtext = AI_state.welcome || 'Ask me anything — questions, writing, translation, ideas, explanations, and even making images 🎨.';
    html +=
      '<div style="text-align:center;color:var(--muted);padding:1.75rem .5rem .5rem">' +
        '<div style="width:64px;height:64px;margin:0 auto .6rem;border-radius:20px;background:linear-gradient(135deg,#2B8A73,#1F6F5C);display:flex;align-items:center;justify-content:center;font-size:2rem;box-shadow:0 8px 24px rgba(31,111,92,.32)">🤖</div>' +
        '<div style="font-size:1.15rem;font-weight:800;color:var(--text);margin-bottom:.3rem">' + escHtml(wname) + '</div>' +
        '<div style="font-size:.84rem;line-height:1.5;max-width:300px;margin:0 auto" dir="auto">' + escHtml(wtext) + '</div>' +
      '</div>';
    if (!AI_state.disabled && !AI_state.notConfigured) {
      var chips = ['Make me an image 🎨', 'Write me a message', 'Translate to English', 'Give me an idea'];
      html += '<div style="display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center;padding:.5rem 1rem 1rem;max-width:420px;margin:0 auto">' +
        chips.map(function (c) {
          return '<button onclick="_aiQuick(this)" data-q="' + escHtml(c) + '" style="background:var(--surface);border:1px solid var(--border);color:var(--text);padding:.5rem .8rem;border-radius:14px;font-size:.8rem;cursor:pointer;font-family:inherit">' + escHtml(c) + '</button>';
        }).join('') +
      '</div>';
    }
    if (AI_state.disabled) {
      html += '<div style="align-self:center;background:rgba(128,128,128,.15);border:1px solid var(--border);color:var(--text);padding:.6rem .8rem;border-radius:12px;font-size:.78rem;max-width:90%;text-align:center">⏸️ YID PLUS AI is currently turned off.</div>';
    } else if (AI_state.notConfigured) {
      html += '<div style="align-self:center;background:rgba(183,121,31,.15);border:1px solid rgba(183,121,31,.4);color:var(--text);padding:.6rem .8rem;border-radius:12px;font-size:.78rem;max-width:90%;text-align:center">⚠️ YID PLUS AI is not set up yet. The owner needs to either enable the free Cloudflare Workers AI, or add an ANTHROPIC_API_KEY.</div>';
    }
  }

  html += AI_state.messages.map(function (m) { return _aiBubble(m.role, m.content, false); }).join('');

  if (AI_state.sending) {
    html += _aiBubble('assistant', '', true);
  }

  el.innerHTML = html;
  el.scrollTop = el.scrollHeight;
}

function _aiSend() {
  var input = document.getElementById('ai-input');
  if (!input) return;
  var text = (input.value || '').trim();
  if (!text || AI_state.sending) return;

  input.value = '';
  _aiAutogrow(input);

  AI_state.messages.push({ role: 'user', content: text });
  AI_state.sending = true;
  _aiRenderMessages();
  var _looksImg = /\b(draw|picture|image|photo|sketch|paint)\b/i.test(text) || /בילד|צייכן|געמעל|מאל\s+מיר/.test(text);
  _aiSetSubtitle(_looksImg ? 'Creating an image… (one moment)' : 'Typing…');

  api.post('/ai/chat', { message: text })
    .then(function (res) {
      AI_state.sending = false;
      if (res && res.ok) {
        // An image reply carries the picture in res.image — fold it into the
        // message content as a marker so the bubble renders it.
        var content = res.reply || '';
        if (res.image) content = (res.reply || '') + '\n[img:' + res.image + ']';
        AI_state.messages.push({ role: 'assistant', content: content });
      } else {
        var msg = (res && res.message) || 'Something went wrong. Please try again.';
        AI_state.messages.push({ role: 'assistant', content: '⚠️ ' + msg });
      }
      _aiRenderMessages();
      _aiSetSubtitle('Ready to help');
    })
    .catch(function (err) {
      AI_state.sending = false;
      var msg = (err && err.data && err.data.message) || (err && err.message) || 'Connection error';
      AI_state.messages.push({ role: 'assistant', content: '⚠️ ' + msg });
      _aiRenderMessages();
      _aiSetSubtitle('Ready to help');
    });
}
window._aiSend = _aiSend;

// A tapped suggestion chip: drop its text into the input and send it.
window._aiQuick = function (btn) {
  var q = btn && btn.getAttribute('data-q');
  if (!q) return;
  var input = document.getElementById('ai-input');
  if (input) { input.value = q; _aiAutogrow(input); }
  _aiSend();
};

function _aiSetSubtitle(t) {
  var s = document.getElementById('ai-subtitle');
  if (s) s.textContent = t;
}

window.clearAIChat = function () {
  ypConfirm('Clear the entire chat with YID PLUS AI?', { danger: true }).then(function (ok) {
    if (!ok) return;
    api.del('/ai/chat').then(function () {
      AI_state.messages = [];
      _aiRenderMessages();
      toast('Cleared');
    }).catch(function (e) { toast('❌ ' + e.message); });
  });
};

/* ══════════════════════════════════════════════════════════════════════
   TELEGRAM CHANNELS — live refresh while a channel is open.
   Polls for NEW posts and APPENDS them; never re-renders existing posts, so
   a playing voice note / video and the media viewer are left untouched.
   Self-stops on channel close (closeChatRoom) or when the view is gone.
   ═════════════════════════════════════════════════════════════════════ */
var TG_livePollTimer = null;

function _tgStopLivePoll() {
  if (TG_livePollTimer) { clearInterval(TG_livePollTimer); TG_livePollTimer = null; }
}

function _tgStartLivePoll(username) {
  _tgStopLivePoll();
  TG_livePollTimer = setInterval(function () {
    // Stop cleanly if we've navigated away or the feed is gone.
    if (TG_curChannel !== username || !document.getElementById('tg-feed-scroll')) {
      _tgStopLivePoll(); return;
    }
    if (document.hidden) return;   // don't poll a backgrounded tab

    api.get('/telegram-ingest?username=' + encodeURIComponent(username))
      .then(function (res) {
        if (TG_curChannel !== username) return;         // changed mid-flight
        var posts = (res && res.posts) || [];
        if (!posts.length) return;

        var slot = document.getElementById('tg-feed-slot');
        var box = document.getElementById('tg-feed-scroll');
        if (!slot || !box) return;

        // First posts arriving into a channel that was empty → do the normal
        // initial render once (nothing is playing yet, so this is safe).
        if (!TG_posts || !TG_posts.length) {
          var st = document.getElementById('tg-feed-state');
          if (st) st.remove();
          var first = posts.slice().sort(function (a, b) { return a.tg_msg_id - b.tg_msg_id; });
          TG_posts = first;
          slot.innerHTML = _tgRenderPosts(first, username, TG_curTitle);
          _tgInitScroll(first.length);
          _tgLoadLinkPreviews();
          return;
        }

        // Otherwise append ONLY posts newer than the newest we already show.
        var maxId = 0;
        for (var i = 0; i < TG_posts.length; i++) if (TG_posts[i].tg_msg_id > maxId) maxId = TG_posts[i].tg_msg_id;
        var fresh = posts.filter(function (p) { return p.tg_msg_id > maxId; })
                         .sort(function (a, b) { return a.tg_msg_id - b.tg_msg_id; });
        if (!fresh.length) return;

        var atBottom = (box.scrollHeight - box.scrollTop - box.clientHeight) < 120;

        var html = _tgRenderPosts(fresh, username, TG_curTitle);
        // Drop a leading day-divider if the newest existing post is the same
        // calendar day, so we don't repeat "Today" mid-feed.
        try {
          var lastP = TG_posts[TG_posts.length - 1];
          var sameDay = lastP && fresh[0] && lastP.posted_at && fresh[0].posted_at &&
            new Date(lastP.posted_at).toDateString() === new Date(fresh[0].posted_at).toDateString();
          if (sameDay) {
            html = html.replace(/^<div style="display:flex;justify-content:center;margin:\.5rem 0 \.6rem">.*?<\/span><\/div>/, '');
          }
        } catch (e) {}

        slot.insertAdjacentHTML('beforeend', html);
        _tgLoadLinkPreviews();
        for (var k = 0; k < fresh.length; k++) TG_posts.push(fresh[k]);

        if (atBottom) {
          box.scrollTop = box.scrollHeight;      // follow along at the bottom
        } else {
          TG_newCount += fresh.length;           // otherwise flag them on the jump button
          var jb = document.getElementById('tg-jump-badge');
          var jbtn = document.getElementById('tg-jump');
          if (jb) { jb.textContent = TG_newCount; jb.style.display = 'block'; }
          if (jbtn) jbtn.style.display = 'flex';
        }

        // Reading a channel marks it read, like the initial open does.
        api.post('/telegram-read', { username: username }).catch(function () {});
      })
      .catch(function () { /* transient — try again next tick */ });
  }, 25000);
}

/* ══════════════════════════════════════════════════════════════════════
   TELEGRAM CHANNELS — link preview cards. If a post's text contains a URL
   (YouTube, news, etc.), show a nice card underneath: YouTube embeds inline,
   everything else gets an og:image + title card (via /api/link-preview),
   exactly like chat messages.
   ═════════════════════════════════════════════════════════════════════ */
function _tgLpPlaceholder(p) {
  try {
    if (!p || !p.text) return '';
    var m = String(p.text).match(/https?:\/\/[^\s<]+/i);
    if (!m) return '';
    var url = m[0].replace(/[.,;:!?)\]]+$/, '');
    return '<div class="tg-lp" id="tglp-' + p.tg_msg_id + '" data-url="' + escHtml(url) + '" style="display:none"></div>';
  } catch (e) { return ''; }
}

function _tgLoadLinkPreviews() {
  var els = document.querySelectorAll('.tg-lp[data-url]:not([data-loaded])');
  for (var i = 0; i < els.length; i++) {
    (function (el) {
      el.dataset.loaded = '1';
      var url = el.dataset.url;
      if (!url) return;
      // Internal links have no useful preview.
      if (/yidplus\.com\/(chat|invite)|\/chat\?join=/i.test(url)) return;

      // YouTube → inline player.
      var yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/live\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
      if (yt) {
        el.style.cssText = 'display:block;margin-top:.5rem;border-radius:10px;overflow:hidden;background:#000;position:relative;padding-top:56.25%';
        el.innerHTML = '<iframe src="https://www.youtube.com/embed/' + yt[1] + '?rel=0" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen loading="lazy"></iframe>';
        return;
      }

      api.get('/link-preview?url=' + encodeURIComponent(url))
        .then(function (res) {
          // If there's no preview image, show NOTHING — just leave the link
          // clickable. Never a broken/empty box.
          if (!res || !res.ok || !res.image) return;
          var host = '';
          try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) {}
          // Preload the image; only reveal the card once it actually loads, so
          // a broken image URL never leaves an empty grey box behind.
          var probe = new Image();
          probe.onload = function () {
            el.onclick = function () { window.open(url, '_blank'); };
            el.style.cssText = 'display:block;margin-top:.5rem;border-radius:10px;overflow:hidden;border:1px solid var(--border);cursor:pointer;background:#fff;max-width:100%';
            el.innerHTML =
              '<img src="' + escHtml(res.image) + '" style="width:100%;aspect-ratio:1.91/1;max-height:180px;object-fit:cover;display:block;background:#e6ebee" loading="lazy">' +
              '<div style="padding:.5rem .7rem">' +
                '<div style="font-size:.68rem;color:var(--muted);margin-bottom:.15rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(host) + '</div>' +
                (res.title ? '<div style="font-size:.85rem;font-weight:700;color:#000;line-height:1.3">' + escHtml(String(res.title).slice(0, 90)) + '</div>' : '') +
                (res.description ? '<div style="font-size:.74rem;color:var(--muted);margin-top:.2rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + escHtml(String(res.description).slice(0, 140)) + '</div>' : '') +
              '</div>';
          };
          probe.onerror = function () { /* broken image → show nothing */ };
          probe.src = res.image;
        })
        .catch(function () {});
    })(els[i]);
  }
}

// Status-viewer mute. The chat page has the 🔊 button but this lived only in
// home.js (not loaded here), so tapping it threw and did nothing.
var CHAT_svMuted = false;
window.svToggleMute = window.svMute = function () {
  CHAT_svMuted = !CHAT_svMuted;
  var btn = document.getElementById('sv-mute');
  if (btn) btn.textContent = CHAT_svMuted ? '🔇' : '🔊';
  var vid = document.querySelector('#sv-slide video');
  if (vid) vid.muted = CHAT_svMuted;
};


// Owner taps the eye → sheet listing who viewed this status (WhatsApp-style).
window.svShowViewers = function () {
  var s = HOME_svStatuses[HOME_svUserIdx];
  if (!s) return;
  var slide = s.slides[HOME_svSlideIdx];
  if (!slide || !slide.id) return;
  if (!(STATE.user && s.user_id === STATE.user.id)) return; // only the owner

  HOME_svPaused = true;
  var vid = document.querySelector('#sv-slide video');
  if (vid) vid.pause();

  var sheet = document.getElementById('sv-viewers-sheet');
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.id = 'sv-viewers-sheet';
    sheet.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:100010;background:var(--surface,#fff);color:var(--text,#111);border-radius:20px 20px 0 0;max-height:70vh;display:flex;flex-direction:column;transform:translateY(100%);transition:transform .28s cubic-bezier(.2,.9,.3,1);box-shadow:0 -8px 30px rgba(0,0,0,.3)';
    sheet.innerHTML =
      '<div style="padding:.85rem 1rem;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border)">' +
        '<div style="font-weight:800;font-size:.95rem" id="sv-viewers-title">Viewed by</div>' +
        '<div onclick="svCloseViewers()" style="cursor:pointer;font-size:1.3rem;line-height:1;color:var(--muted)">✕</div>' +
      '</div>' +
      '<div id="sv-viewers-list" style="overflow-y:auto;padding:.5rem 0"></div>';
    document.body.appendChild(sheet);
  }
  var list = document.getElementById('sv-viewers-list');
  list.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--muted);font-size:.85rem">Loading…</div>';
  requestAnimationFrame(function () { sheet.style.transform = 'translateY(0)'; });

  api.put('/statuses', { viewers: true, id: slide.id }).then(function (res) {
    var vw = (res && res.viewers) || [];
    document.getElementById('sv-viewers-title').textContent = 'Viewed by ' + vw.length;
    if (!vw.length) {
      list.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--muted);font-size:.85rem">No views yet</div>';
      return;
    }
    list.innerHTML = vw.map(function (u) {
      var av = u.photo_url
        ? '<div style="width:40px;height:40px;border-radius:50%;background-image:url(' + u.photo_url + ');background-size:cover;background-position:center;flex-shrink:0"></div>'
        : '<div style="width:40px;height:40px;border-radius:50%;background:' + avatarColor(u.nickname) + ';color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0">' + escHtml((u.nickname || '?').slice(0, 1).toUpperCase()) + '</div>';
      return '<div style="display:flex;align-items:center;gap:.7rem;padding:.55rem 1rem">' + av +
        '<div style="flex:1;min-width:0"><div style="font-weight:600;font-size:.9rem">' + escHtml(u.nickname || 'User') + (u.verified ? ' ✔️' : '') + '</div>' +
        '<div style="font-size:.72rem;color:var(--muted)">' + (u.viewed_at ? timeAgo(u.viewed_at) : '') + '</div></div></div>';
    }).join('');
  }).catch(function () {
    list.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--muted);font-size:.85rem">Could not load viewers</div>';
  });
};
window.svCloseViewers = function () {
  var sheet = document.getElementById('sv-viewers-sheet');
  if (sheet) sheet.style.transform = 'translateY(100%)';
  HOME_svPaused = false;
  var vid = document.querySelector('#sv-slide video');
  if (vid) vid.play().catch(function () {});
};

// Show a badge on the status button = how many people have an active status
// right now (like WhatsApp's recent-updates count). Refreshed with the list.
window._updateStatusBadge = function () {
  api.get('/statuses', true).then(function (res) {
    var list = (res && res.statuses) || [];
    var myId = STATE.user && STATE.user.id;
    // Count distinct people with at least one active status (excluding myself).
    var seen = {};
    var n = 0;
    list.forEach(function (s) {
      var uid = s.user_id || s.owner_id;
      if (!uid || uid === myId || seen[uid]) return;
      seen[uid] = 1; n++;
    });
    var badge = document.getElementById('status-fab-badge');
    if (!badge) return;
    if (n > 0) { badge.textContent = n > 99 ? '99+' : String(n); badge.style.display = 'block'; }
    else badge.style.display = 'none';
  }).catch(function () {});
};
// Keep it fresh: on load and every 45s.
if (!window._statusBadgeTimer) {
  window._statusBadgeTimer = setInterval(function () {
    if (document.getElementById('status-fab-btn')) window._updateStatusBadge();
  }, 45000);
  setTimeout(function () { if (window._updateStatusBadge) window._updateStatusBadge(); }, 1500);
}

// ── Web Share Target: something was shared INTO the app → pick where to send ──
window._initShareInbox = function () {
  try {
    var sp = new URLSearchParams(location.search);
    var text = sp.get('share_text') || '';
    var mediaKey = sp.get('share_media') || '';
    if (!text && !mediaKey) return;
    // Clean the URL so a refresh doesn't re-open the picker.
    try { history.replaceState({}, '', '/chat'); } catch (e) {}
    _showSharePicker(text, mediaKey);
  } catch (e) {}
};

function _showSharePicker(text, mediaKey) {
  var ov = document.createElement('div');
  ov.id = 'share-picker-modal';
  ov.style.cssText = 'position:fixed;inset:0;z-index:100060;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;justify-content:center';
  ov.innerHTML =
    '<div style="background:var(--surface,#fff);color:var(--text,#111);width:100%;max-width:520px;border-radius:18px 18px 0 0;max-height:80vh;display:flex;flex-direction:column">' +
      '<div style="padding:1rem 1.25rem;border-bottom:1px solid var(--border);font-weight:800">Share to…</div>' +
      (text ? '<div style="padding:.6rem 1.25rem;font-size:.8rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(text) + '</div>' : '') +
      (mediaKey ? '<div style="padding:.2rem 1.25rem .6rem;font-size:.8rem;color:var(--muted)">📎 A file will be sent</div>' : '') +
      '<div id="share-picker-list" style="flex:1;overflow-y:auto;padding:.25rem 0"><div style="padding:1.5rem;text-align:center;color:var(--muted)">Loading chats…</div></div>' +
      '<button onclick="document.getElementById(\'share-picker-modal\').remove()" style="margin:.6rem 1.25rem 1rem;padding:.8rem;border-radius:12px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-weight:700;font-family:inherit">Cancel</button>' +
    '</div>';
  document.body.appendChild(ov);
  ov.onclick = function (e) { if (e.target === ov) ov.remove(); };

  api.get('/chat/rooms').then(function (res) {
    var rooms = (res && res.rooms) || [];
    var el = document.getElementById('share-picker-list');
    if (!el) return;
    if (!rooms.length) { el.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--muted)">No chats yet.</div>'; return; }
    el.innerHTML = rooms.map(function (r) {
      var nick = escHtml(r.nick || 'Chat');
      var av = r.photo_url
        ? '<div style="width:42px;height:42px;border-radius:50%;background:#ccc center/cover url(\'' + r.photo_url + '\');flex-shrink:0"></div>'
        : '<div style="width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,var(--accent,#1F6F5C),#2B8A73);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;flex-shrink:0">' + (r.nick || '?').slice(0, 1).toUpperCase() + '</div>';
      return '<div onclick="_sendShared(\'' + r.id + '\')" style="display:flex;align-items:center;gap:.7rem;padding:.65rem 1.25rem;cursor:pointer">' + av +
        '<div style="font-weight:600">' + nick + '</div></div>';
    }).join('');
  }).catch(function () {});

  // Stash for the send handler.
  window._sharePending = { text: text, mediaKey: mediaKey };
}

window._sendShared = function (roomId) {
  var p = window._sharePending || {};
  var modal = document.getElementById('share-picker-modal');
  if (modal) modal.innerHTML = '<div style="margin:auto;color:#fff">Sending…</div>';
  var finish = function () { if (modal) modal.remove(); toast('✅ Shared'); if (typeof openChatRoom === 'function') openChatRoom(roomId); };
  var fail = function (m) { if (modal) modal.remove(); toast('❌ ' + (m || 'Failed to share')); };

  if (p.mediaKey) {
    var url = '/api/media/' + p.mediaKey.split('/').map(encodeURIComponent).join('/');
    fetch(url).then(function (r) { return r.blob(); }).then(function (blob) {
      var ext = (p.mediaKey.split('.').pop() || 'bin').toLowerCase();
      var t = blob.type || '';
      var type = t.startsWith('image/') || t.startsWith('video/') ? 'media' : 'file';
      var form = new FormData();
      form.append('room_id', roomId);
      form.append('type', type);
      form.append('text', p.text || '');
      form.append('file', new File([blob], 'shared.' + ext, { type: t || 'application/octet-stream' }));
      return api.post('/chat', form, true);
    }).then(finish).catch(function (e) { fail(e && e.message); });
  } else {
    var form2 = new FormData();
    form2.append('room_id', roomId);
    form2.append('type', 'text');
    form2.append('text', p.text || '');
    api.post('/chat', form2, true).then(finish).catch(function (e) { fail(e && e.message); });
  }
};

// ── Share OUT: use the phone's native share sheet (falls back to copy) ──
window.ypShare = function (data) {
  try {
    if (navigator.share) {
      navigator.share(data).catch(function () {});
      return;
    }
  } catch (e) {}
  // Fallback: copy the link/text.
  var s = data.url || data.text || '';
  if (navigator.clipboard && s) { navigator.clipboard.writeText(s).then(function () { toast('📋 Copied'); }).catch(function () {}); }
  else { toast('Sharing not supported on this device'); }
};

// Share the current group/channel via the native share sheet (invite link).
window.shareCurrentChat = function () {
  if (!CHAT_curRoom) return;
  var name = CHAT_curRoom.nick || 'YID PLUS';
  var origin = window.location.origin;
  function doShare(code) {
    var url = code ? (origin + '/chat?join=' + code) : origin;
    ypShare({ title: name, text: 'Join "' + name + '" on YID PLUS', url: url });
  }
  var code = CHAT_curRoom.invite_code;
  if (code) { doShare(code); return; }
  // No code yet — try to fetch or generate one, then share.
  api.get('/chat/rooms').then(function (res) {
    var room = (res.rooms || []).find(function (r) { return r.id === CHAT_curRoom.id; });
    if (room && room.invite_code) { CHAT_curRoom.invite_code = room.invite_code; doShare(room.invite_code); return; }
    return api.put('/chat/rooms', { room_id: CHAT_curRoom.id, generate_invite: true })
      .then(function (r2) { CHAT_curRoom.invite_code = r2.invite_code; doShare(r2.invite_code); })
      .catch(function () { doShare(null); });
  }).catch(function () { doShare(null); });
};

// ============================================================
// GROUP / CHANNEL EDIT — full admin settings (Telegram-style)
// ============================================================
var _geRoomId = null, _geData = null;

window.openGroupEdit = function () {
  if (!CHAT_curRoom) return;
  _geRoomId = CHAT_curRoom.id;
  var ov = document.getElementById('group-edit-screen');
  if (ov) ov.remove();
  ov = document.createElement('div');
  ov.id = 'group-edit-screen';
  ov.style.cssText = 'position:fixed;inset:0;z-index:100050;background:var(--bg);display:flex;flex-direction:column';
  ov.innerHTML =
    '<div style="display:flex;align-items:center;gap:.5rem;padding:.7rem .8rem;background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0">' +
      '<div onclick="closeGroupEdit()" style="cursor:pointer;padding:.2rem .4rem;display:flex"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></div>' +
      '<div style="font-weight:800;font-size:1.05rem">Edit</div>' +
    '</div>' +
    '<div id="ge-body" class="scroll-area" style="flex:1;overflow-y:auto;background:var(--bg);padding-bottom:40px">' +
      '<div style="padding:2.5rem 1rem;text-align:center;color:var(--muted)">Loading…</div>' +
    '</div>';
  document.body.appendChild(ov);

  api.get('/chat/rooms?group_settings=' + encodeURIComponent(_geRoomId)).then(function (res) {
    if (!res || !res.ok) { toast((res && res.error) || 'Could not load settings'); closeGroupEdit(); return; }
    _geData = res.settings;
    _geRender();
  }).catch(function (e) { toast('❌ ' + (e && e.message)); closeGroupEdit(); });
};
window.closeGroupEdit = function () { var o = document.getElementById('group-edit-screen'); if (o) o.remove(); };

function _geRow(icon, label, sub, right, onclick) {
  return '<div class="ge-row"' + (onclick ? ' onclick="' + onclick + '"' : '') + ' style="display:flex;align-items:center;gap:.85rem;padding:.9rem 1.1rem;cursor:' + (onclick ? 'pointer' : 'default') + '">' +
    (icon ? '<div style="width:24px;flex-shrink:0;color:var(--muted);display:flex;justify-content:center">' + icon + '</div>' : '') +
    '<div style="flex:1;min-width:0">' +
      '<div style="font-size:.92rem;font-weight:600">' + label + '</div>' +
      (sub ? '<div style="font-size:.78rem;color:var(--muted);margin-top:.1rem">' + sub + '</div>' : '') +
    '</div>' +
    (right || '') +
  '</div>';
}
function _geToggleHtml(on, id) {
  return '<div id="' + id + '" class="ge-toggle" data-on="' + (on ? '1' : '0') + '" style="width:44px;height:26px;border-radius:13px;flex-shrink:0;position:relative;transition:background .2s;background:' + (on ? 'var(--accent,#1F6F5C)' : 'var(--border,#ccc)') + '">' +
    '<div style="position:absolute;top:3px;left:' + (on ? '21px' : '3px') + ';width:20px;height:20px;border-radius:50%;background:#fff;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>' +
  '</div>';
}
function _geCard(inner) { return '<div style="background:var(--surface);border-radius:14px;margin:.6rem .8rem;overflow:hidden;border:1px solid var(--border)">' + inner + '</div>'; }
function _geHdr(t) { return '<div style="font-size:.75rem;color:var(--muted);font-weight:700;padding:1rem 1.4rem .35rem;text-transform:uppercase;letter-spacing:.03em">' + t + '</div>'; }
function _geSep() { return '<div style="height:1px;background:var(--border);margin-left:3.4rem"></div>'; }

function _geRender() {
  var d = _geData;
  var isChannel = d.type === 'channel';
  var p = d.permissions || {};
  function pget(k, def) { return (p[k] === undefined ? def : p[k]); }

  var mediaCount = ['photos','videos','stickers','music','files','voice','video_msg','links','polls','reactions']
    .filter(function (k) { return pget(k, true); }).length;

  var html = '';
  html += '<div id="ge-join-requests"></div>';

  // Name + description
  html += _geCard(
    '<div style="padding:1rem 1.1rem">' +
      '<input id="ge-name" value="' + escHtml(d.name || '').replace(/"/g, '&quot;') + '" placeholder="' + (isChannel ? 'Channel' : 'Group') + ' name" style="width:100%;box-sizing:border-box;border:none;background:none;outline:none;font-size:1.05rem;font-weight:700;color:var(--text);font-family:inherit;padding:.2rem 0">' +
      '<div style="height:1px;background:var(--border);margin:.5rem 0"></div>' +
      '<textarea id="ge-desc" rows="2" maxlength="255" placeholder="Description (optional)" oninput="_geDescCount()" style="width:100%;box-sizing:border-box;border:none;background:none;outline:none;font-size:.9rem;color:var(--text);font-family:inherit;resize:none;padding:.2rem 0">' + escHtml(d.description || '') + '</textarea>' +
      '<div style="text-align:right;font-size:.7rem;color:var(--muted)"><span id="ge-desc-count">' + (255 - (d.description || '').length) + '</span></div>' +
      '<button onclick="_geSaveText()" class="ge-save-btn" style="width:100%;margin-top:.4rem;padding:.6rem;border-radius:10px;border:none;background:var(--accent,#1F6F5C);color:#fff;font-weight:700;font-family:inherit;font-size:.88rem;cursor:pointer">Save name & description</button>' +
    '</div>'
  );

  // Group type + invite + join requests
  var typeCard = _geRow(
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    (isChannel ? 'Channel' : 'Group') + ' Type', d.visibility === 'public' ? 'Public' : 'Private',
    _geToggleHtml(d.visibility === 'public', 'ge-tg-public'), '_geTogglePublic()'
  );
  typeCard += _geSep();
  typeCard += _geRow(
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    'Invite Link', escHtml((d.invite_code ? (location.origin + '/chat?join=' + d.invite_code) : 'Tap to create')),
    '<span onclick="event.stopPropagation();_geCopyInvite()" style="color:var(--accent,#1F6F5C);font-size:.8rem;font-weight:700;cursor:pointer">Copy</span>', '_geCopyInvite()'
  );
  typeCard += _geSep();
  typeCard += _geRow('', 'Revoke &amp; new link', 'Old link stops working', '<span style="color:#DC2626;font-size:.8rem;font-weight:700">Revoke</span>', '_geRevokeInvite()');
  typeCard += _geSep();
  typeCard += _geRow(
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    'Approve new members', 'An admin must approve joins',
    _geToggleHtml(d.approve_members, 'ge-tg-approve'), '_geToggle(\'approve_members\',\'ge-tg-approve\')'
  );
  html += _geHdr((isChannel ? 'Channel' : 'Group') + ' Type') + _geCard(typeCard);

  // Permissions (groups only — channels: only admins post anyway)
  if (!isChannel) {
    var permCard = _geRow(
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
      'Send Messages', 'Members can write', _geToggleHtml(!d.read_only, 'ge-tg-send'), '_geToggleSend()'
    );
    permCard += _geSep();
    permCard += _geRow('', 'Send Media', mediaCount + '/10 allowed', '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>', '_geOpenMedia()');
    permCard += _geSep();
    permCard += _geRow('', 'Add Users', 'Members can add others', _geToggleHtml(pget('add_users', false), 'ge-tg-addusers'), '_gePermToggle(\'add_users\',\'ge-tg-addusers\')');
    permCard += _geSep();
    permCard += _geRow('', 'Pin Messages', '', _geToggleHtml(pget('pin_messages', false), 'ge-tg-pin'), '_gePermToggle(\'pin_messages\',\'ge-tg-pin\')');
    permCard += _geSep();
    permCard += _geRow('', 'Change ' + (isChannel ? 'Channel' : 'Group') + ' Info', 'Name, photo, description', _geToggleHtml(pget('change_info', false), 'ge-tg-info'), '_gePermToggle(\'change_info\',\'ge-tg-info\')');
    html += _geHdr('What members can do') + _geCard(permCard);
  }

  // Reactions + content saving + history
  var extra = _geRow(
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
    'Reactions', 'Members can react', _geToggleHtml(d.reactions_enabled, 'ge-tg-react'), '_geToggle(\'reactions_enabled\',\'ge-tg-react\')'
  );
  extra += _geSep();
  extra += _geRow(
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    'Allow saving content', 'Copy, save &amp; forward', _geToggleHtml(d.allow_saving, 'ge-tg-save'), '_geToggle(\'allow_saving\',\'ge-tg-save\')'
  );
  if (!isChannel) {
    extra += _geSep();
    extra += _geRow(
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
      'Chat history for new members', 'See older messages', _geToggleHtml(d.history_visible, 'ge-tg-hist'), '_geToggle(\'history_visible\',\'ge-tg-hist\')'
    );
  }
  html += _geHdr('Content') + _geCard(extra);

  // Admins + members (reuse existing member management)
  var mgmt = _geRow(
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    'Administrators', 'Manage who can help run this', '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>', '_geOpenMembers(true)'
  );
  mgmt += _geSep();
  mgmt += _geRow(
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    'Members', d.members + ' member' + (d.members === 1 ? '' : 's'), '<span onclick="event.stopPropagation();closeGroupEdit();openAddMemberModal()" style="color:var(--accent,#1F6F5C);font-size:.8rem;font-weight:700;cursor:pointer">+ Add</span>', '_geOpenMembers(false)'
  );
  html += _geHdr('People') + _geCard(mgmt);

  // Delete
  html += _geCard(_geRow(
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>',
    '<span style="color:#DC2626">Delete ' + (isChannel ? 'Channel' : 'Group') + '</span>', '', '', '_geDelete()'
  ));

  html += '<div style="height:30px"></div>';
  document.getElementById('ge-body').innerHTML = html;
  _geLoadJoinRequests();
}

// Show pending join requests inside the Edit screen with Approve / Decline.
window._geLoadJoinRequests = function () {
  var box = document.getElementById('ge-join-requests');
  if (!box || !_geRoomId) return;
  api.get('/chat/join-requests?room_id=' + encodeURIComponent(_geRoomId)).then(function (res) {
    if (!res || !res.ok || !res.requests || !res.requests.length) { box.innerHTML = ''; return; }
    var rows = res.requests.map(function (r) {
      var initial = escHtml((r.nickname || '?').charAt(0).toUpperCase());
      var av = '<div style="width:42px;height:42px;border-radius:50%;flex-shrink:0;position:relative;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;background:linear-gradient(135deg,var(--accent,#1F6F5C),#2B8A73);overflow:hidden">' + initial +
        (r.photo_url ? '<img src="' + escHtml(r.photo_url) + '" onerror="this.style.display=\'none\'" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">' : '') + '</div>';
      return '<div style="display:flex;align-items:center;gap:.7rem;padding:.7rem 1.1rem;border-bottom:1px solid var(--border)">' + av +
        '<div style="flex:1;min-width:0;unicode-bidi:plaintext;text-align:start"><div style="font-weight:600;font-size:.92rem">' + escHtml(r.nickname || 'Someone') + '</div><div style="font-size:.74rem;color:var(--muted)">wants to join</div></div>' +
        '<button onclick="_geAnswerJoin(\'' + r.id + '\',\'approve\',this)" style="background:var(--accent,#1F6F5C);color:#fff;border:none;border-radius:9px;padding:.5rem .9rem;font-weight:700;font-size:.82rem;cursor:pointer;font-family:inherit">Approve</button>' +
        '<button onclick="_geAnswerJoin(\'' + r.id + '\',\'reject\',this)" style="background:none;color:#DC2626;border:none;border-radius:9px;padding:.5rem .6rem;font-size:.82rem;cursor:pointer;font-family:inherit">Decline</button>' +
      '</div>';
    }).join('');
    box.innerHTML = _geHdr('📩 Join requests (' + res.requests.length + ')') +
      '<div style="background:var(--surface);border-radius:14px;margin:.6rem .8rem;overflow:hidden;border:1px solid var(--border)">' + rows + '</div>';
  }).catch(function () { box.innerHTML = ''; });
};
window._geAnswerJoin = function (reqId, action, btn) {
  var row = btn && btn.parentElement;
  if (row) row.style.opacity = '.4';
  api.post('/chat/join-requests', { request_id: reqId, action: action }).then(function (res) {
    if (!res || !res.ok) { toast('❌ ' + ((res && res.error) || 'Failed')); if (row) row.style.opacity = '1'; return; }
    toast(action === 'approve' ? '✅ Added to group' : 'Request declined');
    _geLoadJoinRequests();
    if (_geData) _geData.members = (_geData.members || 0) + (action === 'approve' ? 1 : 0);
    loadChatRooms();
  }).catch(function (e) { toast('❌ ' + ((e && e.message) || 'error')); if (row) row.style.opacity = '1'; });
};

window._geDescCount = function () {
  var t = document.getElementById('ge-desc');
  var c = document.getElementById('ge-desc-count');
  if (t && c) c.textContent = (255 - t.value.length);
};
window._geSaveText = function () {
  var name = (document.getElementById('ge-name') || {}).value || '';
  var desc = (document.getElementById('ge-desc') || {}).value || '';
  var btn = document.querySelector('.ge-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  api.put('/chat/rooms', { room_id: _geRoomId, name: name.trim(), description: desc }).then(function () {
    if (btn) { btn.disabled = false; btn.textContent = 'Save name & description'; }
    if (CHAT_curRoom) { CHAT_curRoom.nick = name.trim(); }
    _geData.name = name.trim(); _geData.description = desc;
    toast('✅ Saved'); loadChatRooms();
    var crn = document.getElementById('cr-name'); if (crn) crn.textContent = name.trim();
  }).catch(function (e) { if (btn) { btn.disabled = false; btn.textContent = 'Save name & description'; } toast('❌ ' + (e && e.message)); });
};
function _geFlip(id, on) {
  var el = document.getElementById(id);
  if (!el) return;
  el.setAttribute('data-on', on ? '1' : '0');
  el.style.background = on ? 'var(--accent,#1F6F5C)' : 'var(--border,#ccc)';
  var knob = el.firstChild; if (knob) knob.style.left = on ? '21px' : '3px';
}
window._geToggle = function (key, id) {
  var el = document.getElementById(id);
  var on = el.getAttribute('data-on') !== '1';
  _geFlip(id, on);
  _geData[key] = on;
  var body = { room_id: _geRoomId }; body[key] = on;
  api.put('/chat/rooms', body).catch(function (e) { toast('❌ ' + (e && e.message)); _geFlip(id, !on); });
};
window._geToggleSend = function () {
  var el = document.getElementById('ge-tg-send');
  var on = el.getAttribute('data-on') !== '1'; // "on" = members CAN send = read_only false
  _geFlip('ge-tg-send', on);
  _geData.read_only = !on;
  api.put('/chat/rooms', { room_id: _geRoomId, read_only: !on }).catch(function (e) { toast('❌ ' + (e && e.message)); _geFlip('ge-tg-send', !on); });
};
window._geTogglePublic = function () {
  var el = document.getElementById('ge-tg-public');
  var on = el.getAttribute('data-on') !== '1';
  _geFlip('ge-tg-public', on);
  _geData.visibility = on ? 'public' : 'private';
  api.put('/chat/rooms', { room_id: _geRoomId, visibility: on ? 'public' : 'private' }).catch(function (e) { toast('❌ ' + (e && e.message)); _geFlip('ge-tg-public', !on); });
};
window._gePermToggle = function (key, id) {
  var el = document.getElementById(id);
  var on = el.getAttribute('data-on') !== '1';
  _geFlip(id, on);
  if (!_geData.permissions) _geData.permissions = {};
  _geData.permissions[key] = on;
  api.put('/chat/rooms', { room_id: _geRoomId, permissions: _geData.permissions }).catch(function (e) { toast('❌ ' + (e && e.message)); _geFlip(id, !on); });
};
window._geCopyInvite = function () {
  if (!_geData.invite_code) {
    api.put('/chat/rooms', { room_id: _geRoomId, generate_invite: true }).then(function (r) {
      _geData.invite_code = r.invite_code; _geCopyInvite();
    }).catch(function () {});
    return;
  }
  var url = location.origin + '/chat?join=' + _geData.invite_code;
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast('✅ Invite link copied'); });
  else toast(url);
};
window._geRevokeInvite = function () {
  if (!confirm('Revoke the current invite link and create a new one? The old link will stop working.')) return;
  api.put('/chat/rooms', { room_id: _geRoomId, revoke_invite: true }).then(function (r) {
    _geData.invite_code = r.invite_code; toast('✅ New link created'); _geRender();
  }).catch(function (e) { toast('❌ ' + (e && e.message)); });
};
window._geDelete = function () {
  if (!confirm('Delete this ' + (_geData.type === 'channel' ? 'channel' : 'group') + ' for everyone? This cannot be undone.')) return;
  api.del('/chat/rooms?room_id=' + encodeURIComponent(_geRoomId) + '&delete_all=1').then(function () {
    toast('Deleted'); closeGroupEdit(); showChatList(); loadChatRooms();
  }).catch(function (e) { toast('❌ ' + (e && e.message)); });
};

// Send-media sub-screen (the 10 media types)
window._geOpenMedia = function () {
  var p = _geData.permissions || {};
  function pget(k) { return p[k] === undefined ? true : p[k]; }
  var types = [
    ['photos','Photos'],['videos','Videos'],['stickers','Stickers & GIFs'],['music','Music'],
    ['files','Files'],['voice','Voice Messages'],['video_msg','Video Messages'],['links','Embed Links'],
    ['polls','Polls'],['reactions','Send Reactions']
  ];
  var ov = document.createElement('div');
  ov.id = 'ge-media-screen';
  ov.style.cssText = 'position:fixed;inset:0;z-index:100055;background:var(--bg);display:flex;flex-direction:column';
  var rows = types.map(function (t) {
    return _geRow('', t[1], '', _geToggleHtml(pget(t[0]), 'gem-' + t[0]), '_geMediaToggle(\'' + t[0] + '\')');
  }).join(_geSep());
  ov.innerHTML =
    '<div style="display:flex;align-items:center;gap:.5rem;padding:.7rem .8rem;background:var(--surface);border-bottom:1px solid var(--border)">' +
      '<div onclick="document.getElementById(\'ge-media-screen\').remove()" style="cursor:pointer;padding:.2rem .4rem;display:flex"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></div>' +
      '<div style="font-weight:800;font-size:1.05rem">Send Media</div>' +
    '</div>' +
    '<div class="scroll-area" style="flex:1;overflow-y:auto;padding:.6rem 0">' + _geCard(rows) + '</div>';
  document.body.appendChild(ov);
};
window._geMediaToggle = function (key) {
  var el = document.getElementById('gem-' + key);
  var on = el.getAttribute('data-on') !== '1';
  _geFlip('gem-' + key, on);
  if (!_geData.permissions) _geData.permissions = {};
  _geData.permissions[key] = on;
  api.put('/chat/rooms', { room_id: _geRoomId, permissions: _geData.permissions }).catch(function (e) { toast('❌ ' + (e && e.message)); _geFlip('gem-' + key, !on); });
};

// Share the selected message's content to other apps via the native share sheet.
window.ctxShare = function () {
  var m = CHAT_ctxMsg;
  closeCtxMenu();
  if (!m) return;
  var text = (m.text || '').trim();
  var data = {};
  // If it's media with a URL, share the link; otherwise share the text.
  if (m.media_url) {
    var url = m.media_url.indexOf('http') === 0 ? m.media_url : (window.location.origin + m.media_url);
    data.url = url;
    if (text) data.text = text;
  } else if (text) {
    data.text = text;
  } else {
    toast('Nothing to share'); return;
  }
  if (typeof ypShare === 'function') ypShare(data);
  else if (navigator.share) navigator.share(data).catch(function () {});
  else if (navigator.clipboard) navigator.clipboard.writeText(data.url || data.text || '').then(function () { toast('📋 Copied'); });
};

// Tapping an @username opens (or creates) a private chat with that person.
window.openMention = function (username) {
  if (!username) return;
  username = String(username).replace(/^@/, '');
  var me = STATE.user && STATE.user.nickname;
  if (me && me.toLowerCase() === username.toLowerCase()) { toast("That's you 🙂"); return; }
  toast('Opening @' + username + '…');
  api.post('/chat/rooms', { type: 'private', other_username: username }).then(function (res) {
    if (!res || !res.ok) { toast((res && res.error) || 'User not found'); return; }
    var rid = res.room_id || (res.room && res.room.id);
    loadChatRooms();
    setTimeout(function () { if (rid) openChatRoom(rid); }, 350);
  }).catch(function (e) { toast('❌ ' + ((e && e.message) || 'Could not open chat')); });
};

// Members / Administrators management sub-screen inside the group Edit flow.
window._geOpenMembers = function (adminsOnly) {
  var old = document.getElementById('ge-members-screen'); if (old) old.remove();
  var ov = document.createElement('div');
  ov.id = 'ge-members-screen';
  ov.style.cssText = 'position:fixed;inset:0;z-index:100056;background:var(--bg);display:flex;flex-direction:column';
  ov.innerHTML =
    '<div style="display:flex;align-items:center;gap:.5rem;padding:.7rem .8rem;background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0">' +
      '<div onclick="document.getElementById(\'ge-members-screen\').remove()" style="cursor:pointer;padding:.2rem .4rem;display:flex"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></div>' +
      '<div style="font-weight:800;font-size:1.05rem;flex:1">' + (adminsOnly ? 'Administrators' : 'Members') + '</div>' +
      '<div onclick="closeGroupEdit();document.getElementById(\'ge-members-screen\').remove();openAddMemberModal()" style="color:var(--accent,#1F6F5C);font-weight:700;font-size:.85rem;cursor:pointer;padding:.3rem .5rem">+ Add</div>' +
    '</div>' +
    '<div id="ge-mem-list" class="scroll-area" style="flex:1;overflow-y:auto;padding:.4rem 0"><div style="padding:2rem;text-align:center;color:var(--muted)">Loading…</div></div>';
  document.body.appendChild(ov);

  api.get('/chat/rooms').then(function (res) {
    var room = (res.rooms || []).find(function (r) { return r.id === _geRoomId; });
    var members = (room && room.member_list) || [];
    var createdBy = room && room.created_by;
    if (adminsOnly) members = members.filter(function (m) { return m.is_group_admin || m.id === createdBy || m.role === 'admin_super' || m.role === 'admin_limited'; });
    var el = document.getElementById('ge-mem-list');
    if (!el) return;
    if (!members.length) { el.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--muted)">' + (adminsOnly ? 'No admins yet — tap a member and choose "Make admin".' : 'No members yet.') + '</div>'; return; }
    el.innerHTML = members.map(function (m) {
      var initial = (m.nickname || '?').slice(0, 1).toUpperCase();
      var isOwner = createdBy && m.id === createdBy;
      var badge = isOwner ? '<span style="font-size:.7rem;color:var(--accent,#1F6F5C);font-weight:700">owner</span>'
                : m.is_group_admin ? '<span style="font-size:.7rem;color:var(--accent,#1F6F5C);font-weight:700">admin</span>' : '';
      var av = '<div style="width:44px;height:44px;border-radius:50%;flex-shrink:0;position:relative;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;background:linear-gradient(135deg,var(--accent,#1F6F5C),#2B8A73);overflow:hidden">' + initial +
        (m.photo_url ? '<img src="' + escHtml(m.photo_url) + '" onerror="this.style.display=\'none\'" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">' : '') + '</div>';
      return '<div onclick="_openMemberActions(\'' + m.id + '\',\'' + escJs(m.nickname || 'User') + '\',' + (m.is_group_admin ? 'true' : 'false') + ',\'' + escJs(m.title || '') + '\')" style="display:flex;align-items:center;gap:.8rem;padding:.7rem 1.1rem;cursor:pointer;border-bottom:1px solid var(--border)">' +
        av + '<div style="flex:1;min-width:0;unicode-bidi:plaintext;text-align:start"><div style="font-size:.95rem;font-weight:600">' + escHtml(m.nickname || 'User') + '</div>' +
        (m.title ? '<div style="font-size:.75rem;color:var(--accent,#1F6F5C)">' + escHtml(m.title) + '</div>' : '') + '</div>' + badge +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left:.5rem;opacity:.6"><polyline points="9 18 15 12 9 6"/></svg>' +
      '</div>';
    }).join('');
  }).catch(function (e) {
    var el = document.getElementById('ge-mem-list'); if (el) el.innerHTML = '<div style="padding:2rem;text-align:center;color:#DC2626">' + ((e && e.message) || 'Failed to load') + '</div>';
  });
};

// Poll the chat list so unread badges + previews update on their own when new
// messages arrive — without this you only saw new messages after a manual
// refresh. Runs only while the list is visible (a room's own 3s poll covers the
// open-room case) and pauses in the background.
var _chatListPollTimer = null;
function _startChatListPoll() {
  if (_chatListPollTimer) return;
  _chatListPollTimer = setInterval(function () {
    try {
      if (document.hidden) return;
      var roomScreen = document.getElementById('screen-chatroom');
      var roomOpen = roomScreen && !roomScreen.classList.contains('hidden');
      var infoScreen = document.getElementById('screen-chatinfo');
      var infoOpen = infoScreen && !infoScreen.classList.contains('hidden');
      // Only refresh the list when we're actually looking at it.
      if (!roomOpen && !infoOpen && typeof loadChatRooms === 'function') loadChatRooms();
    } catch (e) {}
  }, 6000);
}
if (typeof window !== 'undefined') {
  if (document.readyState !== 'loading') _startChatListPoll();
  else document.addEventListener('DOMContentLoaded', _startChatListPoll);
  // Refresh immediately when returning to the tab.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      var rs = document.getElementById('screen-chatroom');
      var open = rs && !rs.classList.contains('hidden');
      if (!open && typeof loadChatRooms === 'function') loadChatRooms();
    }
  });
}

// New-content dots on the Shorts / Channels nav (like the Chats unread badge):
// show a dot when there's a newer short or post than the user last saw.
function _setNavDot(id, show) {
  var el = document.getElementById(id);
  if (el) el.style.display = show ? 'block' : 'none';
}
function _updateContentBadges() {
  try {
    if (document.hidden) return;
    var lastS = localStorage.getItem('yp_last_shorts_visit') || '1970-01-01';
    api.get('/shorts?limit=1').then(function (res) {
      var latest = res && res.shorts && res.shorts[0] && res.shorts[0].created_at;
      _setNavDot('cnav-badge-shorts', !!(latest && latest > lastS));
    }).catch(function () {});
    var lastF = localStorage.getItem('yp_last_feed_visit') || '1970-01-01';
    api.get('/posts?limit=1').then(function (res) {
      var latest = res && res.posts && res.posts[0] && res.posts[0].created_at;
      _setNavDot('cnav-badge-channels', !!(latest && latest > lastF));
    }).catch(function () {});
  } catch (e) {}
}
if (typeof window !== 'undefined') {
  var _startContentBadges = function () {
    _updateContentBadges();
    setInterval(_updateContentBadges, 60000);
  };
  if (document.readyState !== 'loading') _startContentBadges();
  else document.addEventListener('DOMContentLoaded', _startContentBadges);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) _updateContentBadges(); });
}

// Update the Chats nav badge from total unread (excludes muted). Extracted so it
// can be called immediately when you open a room, not only on a full list render.
function _refreshChatNavBadge() {
  try {
    var tot = (CHAT_rooms || []).reduce(function (s, r) { return s + (r.muted ? 0 : (r.unread || 0)); }, 0);
    var cb = document.getElementById('cnav-badge-chats');
    if (cb) {
      if (tot > 0) { cb.textContent = tot > 99 ? '99+' : tot; cb.style.display = 'flex'; }
      else cb.style.display = 'none';
    }
  } catch (e) {}
}

// Locally-remembered "I've seen this room up to time T". Used to keep the unread
// badge cleared across server polls for chats the server won't mark read for us
// (e.g. admin-spectated private chats), while still showing a badge again if a
// genuinely NEWER message arrives after we looked.
var _locallySeen = {};
try { _locallySeen = JSON.parse(localStorage.getItem('yp_seen_rooms') || '{}') || {}; } catch (e) { _locallySeen = {}; }
function _markRoomSeenLocally(roomId) {
  if (!roomId) return;
  _locallySeen[roomId] = new Date().toISOString();
  try { localStorage.setItem('yp_seen_rooms', JSON.stringify(_locallySeen)); } catch (e) {}
}
function _applyLocalSeen() {
  try {
    (CHAT_rooms || []).forEach(function (r) {
      var seen = _locallySeen[r.id];
      // If we've seen this room at or after its latest message, it's read for us.
      if (seen && r.last_time && seen >= r.last_time) r.unread = 0;
    });
  } catch (e) {}
}

// Chat images serve fine but can hit a transient network blip (or the user
// scrolls past before they finish). Reload once before giving up, instead of
// blanking the photo on the first hiccup.
window._imgRetry = function (el) {
  try {
    if (!el) return;
    if (el.getAttribute('data-retried')) { el.style.display = 'none'; return; }
    el.setAttribute('data-retried', '1');
    var s = el.getAttribute('src');
    setTimeout(function () { try { el.removeAttribute('src'); el.src = s; } catch (e) {} }, 800);
  } catch (e) {}
};
