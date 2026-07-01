// ============================================================
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
var CHAT_messages    = [];
var CHAT_reactions   = {}; // { messageId: { counts: {emoji: n}, my_reaction: emoji|null } }
var CHAT_replyTo     = null;
var CHAT_ctxMsg      = null;
var CHAT_pollTimer   = null;
var CHAT_isRecording = false;
var CHAT_mediaRec    = null;
var CHAT_recChunks   = [];
var CHAT_recStart    = 0;
var CHAT_unreadNew   = 0;   // new messages since last scroll
var CHAT_pinnedMsgId = null;
var CHAT_atBottom    = true;
var CHAT_members     = [];  // current room members
var CHAT_drafts      = {};  // roomId -> draft text

// ============================================================
// BOOT
// ============================================================
window.closeChatRoom = function () {
  _stopTypingPoll();
  CHAT_curRoom = null;
  var screenChats    = document.getElementById('screen-chats');
  var screenChatroom = document.getElementById('screen-chatroom');
  if (screenChatroom) { screenChatroom.classList.remove('active'); screenChatroom.style.display = 'none'; }
  if (screenChats)    { screenChats.classList.add('active');       screenChats.style.display    = 'flex'; }
};

window.init_chats = function () {
  loadChatRooms();
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

  if (!filtered.length) {
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
    var photoBg  = hasPhoto ? "background-image:url('" + c.photo_url + "');background-size:cover;background-position:center;" : '';
    // Groups get rounded-square avatar like Telegram, DMs get circle
    var avClass  = 'chat-av' + (isGroup ? ' group chat-av-square' : ' chat-av-round');
    var hasStatus = !isGroup && CHAT_activeStatusUserIds && CHAT_activeStatusUserIds.has(c.other_user_id || c.id);
    if (hasStatus) avClass += ' has-status-ring';
    var avStyle  = photoBg;
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
      ? '<div style="min-width:20px;height:20px;border-radius:10px;background:var(--blue);color:#fff;font-size:.62rem;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px;flex-shrink:0">' + (c.unread > 99 ? '99+' : c.unread) + '</div>'
      : '';

    var avatarClickAttr = hasStatus ? ' onclick="event.stopPropagation();_viewChatListAvatarStatus(\'' + (c.other_user_id || c.id) + '\')"' : '';
    return '<div class="chat-item-wrap" data-room-id="' + c.id + '">' +
      '<div class="chat-item-delete" onclick="event.stopPropagation();deleteChatRoom(\'' + c.id + '\',\'' + escHtml((c.nick || 'Chat')).replace(/'/g, "\\'") + '\')"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg></div>' +
      '<div class="chat-item' + (c.unread ? ' unread' : '') + '" onclick="_chatItemClick(this,\'' + c.id + '\')">' +
        '<div class="' + avClass + '" style="' + avStyle + '"' + avatarClickAttr + '>' + avatarContent + onlineDot + '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:.18rem;gap:.4rem">' +
            '<div style="font-size:.92rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;unicode-bidi:plaintext;text-align:start;flex:1">' + escHtml(c.nick || 'Chat') + '</div>' +
            '<div style="font-size:.68rem;color:var(--muted);flex-shrink:0">' + timeText + '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:.4rem">' +
            '<div style="font-size:.82rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;unicode-bidi:plaintext;text-align:start;flex:1;font-weight:' + (c.unread ? '500' : '400') + '">' + previewHtml + '</div>' +
            unreadBadge +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  _attachChatSwipeGestures();
}

// Swipe-left-to-reveal-delete on each chat row (mirrors the gesture used for
// message swipe-to-reply, but horizontal-only and limited to one row at a time).
function _attachChatSwipeGestures() {
  document.querySelectorAll('.chat-item-wrap').forEach(function (wrap) {
    var item = wrap.querySelector('.chat-item');
    var startX = 0, startY = 0, dragging = false, moved = false;

    item.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      dragging = true;
      moved = false;
    }, { passive: true });

    item.addEventListener('touchmove', function (e) {
      if (!dragging) return;
      var t = e.touches[0];
      var dx = t.clientX - startX;
      var dy = t.clientY - startY;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) moved = true;
      // Only react to clearly-horizontal, leftward drags.
      if (Math.abs(dx) > Math.abs(dy) && dx < -20) {
        e.preventDefault();
      }
    }, { passive: false });

    item.addEventListener('touchend', function (e) {
      if (!dragging) return;
      dragging = false;
      var t = e.changedTouches[0];
      var dx = t.clientX - startX;
      if (moved && dx < -45) {
        document.querySelectorAll('.chat-item.swiped').forEach(function (other) {
          if (other !== item) other.classList.remove('swiped');
        });
        item.classList.add('swiped');
      } else if (moved && dx > 20) {
        item.classList.remove('swiped');
      }
    });
  });

  // Tapping anywhere else closes any open swipe-delete row.
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
  } else {
    body.innerHTML = '<img src="' + item.url + '" style="max-width:100%;max-height:80vh;object-fit:contain;border-radius:4px">';
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

window._mvOptions = function () {
  var item = _mediaList[_mediaIdx];
  if (!item) return;
  var menu = document.getElementById('mv-options-menu');
  menu.classList.toggle('open');
};

window._mvForward = function () {
  document.getElementById('mv-options-menu').classList.remove('open');
  if (!_mediaList[_mediaIdx]) return;
  CHAT_ctxMsg = CHAT_messages.find(function (m) { return m.id === _mediaList[_mediaIdx].id; });
  _mediaViewerClose();
  ctxForward();
};

window._mvDownload = function () {
  document.getElementById('mv-options-menu').classList.remove('open');
  var item = _mediaList[_mediaIdx];
  if (!item) return;
  var a = document.createElement('a');
  a.href = item.url;
  a.download = item.key.split('/').pop() || 'media';
  document.body.appendChild(a);
  a.click();
  a.remove();
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
      var dx = e.changedTouches[0].clientX - startX;
      var dy = e.changedTouches[0].clientY - startY;
      var dt = Date.now() - startT;
      if (dt > 500) return; // too slow
      if (Math.abs(dy) > Math.abs(dx) && dy > 80) { _mediaViewerClose(); return; } // swipe down
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) _mvNext(); else _mvPrev(); // swipe left/right
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

      if (!confirm(msg)) { closeChatRoom(); return; }

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
      if (!code) return toast('⚠ Run the SQL migration first to generate invite codes.');
      CHAT_curRoom.invite_code = code;
      var url = window.location.origin + '/chat?join=' + code;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function () { toast('✅ Invite link copied!'); });
      } else { toast('🔗 ' + url); }
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.confirmDeleteCurrentChat = function () {
  if (!CHAT_curRoom) return;
  var isGroup = CHAT_curRoom.type === 'group';
  var label = isGroup ? 'Leave "' + CHAT_curRoom.nick + '"?' : 'Delete chat with "' + CHAT_curRoom.nick + '"?';
  if (!confirm(label)) return;

  api.del('/chat/rooms?room_id=' + encodeURIComponent(CHAT_curRoom.id))
    .then(function () {
      toast(isGroup ? '🚪 You left the group.' : '🗑 Chat removed');
      CHAT_curRoom = null;
      navTo('chats');
      loadChatRooms();
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.deleteChatRoom = function (roomId, nick) {
  if (!confirm('Delete chat with "' + nick + '"? This removes it from your list.')) return;
  api.del('/chat/rooms?room_id=' + encodeURIComponent(roomId))
    .then(function () {
      toast('🗑 Chat removed');
      if (CHAT_curRoom && CHAT_curRoom.id === roomId) { CHAT_curRoom = null; closeChatRoom(); }
      loadChatRooms();
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.filterChats = function () {
  CHAT_search = document.getElementById('chat-search').value || '';
  renderChatList();
};

window.switchChatTab = function (btn, tab) {
  CHAT_tab = tab;
  document.querySelectorAll('.ctab').forEach(function (t) { t.classList.remove('active'); });
  btn.classList.add('active');
  renderChatList();
};

// ============================================================
// OPEN ROOM
// ============================================================
window.openChatRoom = function (roomId) {
  var room = CHAT_rooms.find(function (r) { return r.id === roomId; });
  if (!room) {
    // Rooms not yet loaded — load them first, then open
    loadChatRooms(function () {
      var r2 = CHAT_rooms.find(function (r) { return r.id === roomId; });
      if (r2) window.openChatRoom(roomId);
      else toast('⚠ Chat not found');
    });
    return;
  }

  // Explicitly switch screens — don't rely only on CSS class toggling
  var screenChats    = document.getElementById('screen-chats');
  var screenChatroom = document.getElementById('screen-chatroom');
  if (screenChats)    { screenChats.classList.remove('active');    screenChats.style.display    = 'none'; }
  if (screenChatroom) { screenChatroom.classList.add('active');    screenChatroom.style.display = 'flex'; }

  CHAT_curRoom   = room;
  CHAT_replyTo   = null;
  CHAT_unreadNew = 0;
  CHAT_atBottom  = true;
  room.unread    = 0;
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

  document.getElementById('cr-name').textContent = room.nick || 'Chat';
  document.getElementById('cr-name').onclick = function(){ openChatInfo(); };
  document.getElementById('cr-name').style.cursor = 'pointer';
  document.getElementById('cr-avatar').onclick = function(){ openChatInfo(); };
  document.getElementById('cr-avatar').style.cursor = 'pointer';

  var st = document.getElementById('cr-status');
  var meId = STATE.user && STATE.user.id;
  var isSuperAdmin = STATE.user && (STATE.user.role === 'admin_super' || STATE.user.email === CONFIG.OWNER_EMAIL);
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
  document.getElementById('new-arrow').style.display = 'none';

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
    } else {
      pinnedBar.style.display = 'none';
    }
  }

  navTo('chatroom');
  _applyChannelInputState(room);
  loadMessages(true);
  clearInterval(CHAT_pollTimer);
  CHAT_pollTimer = setInterval(function () { loadMessages(false); }, 8000);

  // Load members list for groups
  if (isGroup) loadGroupMembers(roomId);
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
  var isSuperAdmin = STATE.user && (STATE.user.role === 'admin_super' || STATE.user.email === CONFIG.OWNER_EMAIL);
  var canManageGroup = isGroup && (CHAT_curRoom.is_group_admin || isSuperAdmin);
  document.getElementById('info-admin-settings').style.display = canManageGroup ? 'block' : 'none';

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
  if (!confirm('Remove this member from the group?')) return;
  api.put('/chat/rooms', { room_id: CHAT_curRoom.id, member_id: memberId, remove: true })
    .then(function () {
      toast('🚪 Member removed');
      loadGroupMembers(CHAT_curRoom.id);
      loadMessages(true);
    })
    .catch(function (err) { toast('❌ ' + err.message); });
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
  var isSuperAdmin = STATE.user && (STATE.user.role === 'admin_super' || STATE.user.email === CONFIG.OWNER_EMAIL);
  var canManageGroup = CHAT_curRoom && (CHAT_curRoom.is_group_admin || isSuperAdmin);

  list.innerHTML = CHAT_members.map(function (m) {
    var photoStyle = m.photo_url ? "background-image:url('" + m.photo_url + "');background-size:cover;background-position:center;" : '';
    var isSelf = m.id === meId;
    var controls = '';
    if (canManageGroup && !isSelf) {
      controls = '<div style="display:flex;gap:.3rem;flex-shrink:0">' +
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
      (m.online && isAnyAdmin() ? '<div style="font-size:.68rem;color:var(--green)">● online</div>' : '') +
      '</div>' +
      (m.role === 'admin_super' || m.role === 'admin_limited' ? '<span style="font-size:.65rem;background:#EAF4FF;color:var(--blue);border:1px solid #BBDEFB;border-radius:6px;padding:.1rem .4rem">Admin</span>' : '') +
      (m.is_group_admin ? '<span style="font-size:.65rem;background:#FFF3E0;color:#E65100;border:1px solid #FFE0B2;border-radius:6px;padding:.1rem .4rem;margin-left:.3rem">Group Admin</span>' : '') +
      controls +
    '</div>';
  }).join('');
}

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
  if (!confirm('Leave "' + CHAT_curRoom.nick + '"?')) return;

  api.del('/chat/rooms?room_id=' + encodeURIComponent(CHAT_curRoom.id))
    .then(function () {
      toast('You left the group.');
      navTo('chats');
      loadChatRooms();
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

// ============================================================
// LOAD & RENDER MESSAGES
// ============================================================
function loadMessages(scrollToBottom) {
  if (!CHAT_curRoom) return;

  api.get('/chat?room_id=' + encodeURIComponent(CHAT_curRoom.id))
    .then(function (res) {
      var msgs    = res.messages || [];
      var prevLen = CHAT_messages.length;
      CHAT_messages = msgs;

      // Count new messages while not at bottom
      if (!scrollToBottom && !CHAT_atBottom && msgs.length > prevLen) {
        CHAT_unreadNew += (msgs.length - prevLen);
        var arrow = document.getElementById('new-arrow');
        if (arrow) {
          arrow.style.display = 'flex';
          var badge = document.getElementById('new-count');
          if (badge) { badge.textContent = CHAT_unreadNew; badge.style.display = 'flex'; }
        }
      }

      renderMessages(scrollToBottom || CHAT_atBottom);

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
          lpEl.dataset.loaded = '1';

          // YouTube embed
          var ytMatch = rawUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
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
            return;
          }

          // OG Preview for other links
          api.get('/link-preview?url=' + encodeURIComponent(rawUrl))
            .then(function (res) {
              if (!res || !res.ok || !res.title) return;
              var isMe = m.sender_id === (STATE.user && STATE.user.id);
              lpEl.style.display = 'block';
              lpEl.onclick = function () { window.open(rawUrl, '_blank'); };
              lpEl.style.cssText = 'display:block;margin-top:.4rem;border-radius:12px;overflow:hidden;border:1px solid var(--border);cursor:pointer;background:var(--surface);max-width:100%';
              lpEl.innerHTML =
                (res.image
                  ? '<img src="' + escHtml(res.image) + '" style="width:100%;max-height:150px;object-fit:cover;display:block" loading="lazy">'
                  : '') +
                '<div style="padding:.5rem .65rem">' +
                  '<div style="font-size:.7rem;color:' + (isMe ? 'rgba(255,255,255,.6)' : 'var(--muted)') + ';margin-bottom:.15rem;text-overflow:ellipsis;overflow:hidden;white-space:nowrap">' + escHtml(new URL(rawUrl).hostname) + '</div>' +
                  '<div style="font-size:.82rem;font-weight:700;color:' + (isMe ? '#fff' : 'var(--text)') + ';line-height:1.3">' + escHtml(res.title.slice(0, 80)) + '</div>' +
                  (res.description ? '<div style="font-size:.72rem;color:' + (isMe ? 'rgba(255,255,255,.75)' : 'var(--muted)') + ';margin-top:.2rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + escHtml(res.description.slice(0, 120)) + '</div>' : '') +
                '</div>';
            })
            .catch(function () {});
        });
      }, 600);

      // Mark as read
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

  var html = CHAT_messages.map(function (m, idx) {
    var isMe = m.sender_id === meId;
    var msgDate = m.created_at ? m.created_at.slice(0, 10) : '';
    var dateSep = '';
    if (msgDate && msgDate !== lastDate) {
      lastDate = msgDate;
      dateSep = '<div class="date-sep"><span>' + _dateLabel(m.created_at) + '</span></div>';
    }

    var time = m.created_at ? _fmt12(m.created_at) : '';
    var tickSvg = m.read
      ? '<svg width="16" height="10" viewBox="0 0 16 10" fill="none" style="display:inline-block;vertical-align:middle;margin-left:2px"><path d="M1 5l3 3 5-7" stroke="rgba(255,255,255,.7)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 5l3 3 5-7" stroke="rgba(255,255,255,.9)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" style="display:inline-block;vertical-align:middle;margin-left:2px"><path d="M1 5l3 3 5-6" stroke="rgba(255,255,255,.6)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var ticks = isMe ? '<span class="read-ticks">' + tickSvg + '</span>' : '';

    // System messages (e.g. "X joined the group") — centered, no bubble
    if (m.type === 'system') {
      return dateSep + '<div class="sys-msg"><span>' + escHtml(m.text || '') + '</span></div>';
    }

    var isMediaMsg = (m.type === 'media' && m.media_url);
    var bubbleClass = 'bubble ' + (isMe ? 'me' : 'them') + (isMediaMsg ? ' bubble-media' : '');
    var inner = '';

    // Group sender nick
    if (!isMe && isGroup) {
      inner += '<div class="bubble-nick" onclick="openUserProfile(\'' + m.sender_id + '\')" style="cursor:pointer">@' + escHtml(m.sender_nick || '') + '</div>';
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
        inner += '<div class="reply-quote" onclick="scrollToMsg(\'' + quoted.id + '\')" style="display:flex;align-items:center;gap:.4rem">' +
          quotedThumb +
          '<div style="min-width:0"><strong style="display:block;font-size:.7rem">' + quotedName + '</strong>' +
          '<span style="unicode-bidi:plaintext">' + quotedText + '</span></div>' +
        '</div>';
      }
    }

    // Content
    if (m.type === 'poll') {
      return dateSep + '<div class="msg-wrap' + (isMe ? ' me' : '') + '" id="msg-' + m.id + '" data-id="' + m.id + '">' +
        '<div class="bubble ' + (isMe ? 'me' : 'them') + ' poll-bubble-wrap">' +
          '<div id="poll-' + m.text + '">' + _renderPollBubble(m, isMe) + '</div>' +
          '<div class="bubble-meta"><span class="bubble-time">' + (m.created_at ? _fmt12(m.created_at) : '') + '</span></div>' +
        '</div>' +
      '</div>';

    } else if (m.type === 'sticker') {
      var stickerUrl = m.text || '';
      var isGif = stickerUrl.startsWith('http');
      return dateSep + '<div class="msg-wrap' + (isMe ? ' me' : '') + '" id="msg-' + m.id + '" data-id="' + m.id + '">' +
        '<div class="bubble sticker" data-msg-id="' + m.id + '" ' +
          'oncontextmenu="event.preventDefault();showCtx(event,\'' + m.id + '\')" ' +
          'ontouchstart="_ctxTouchStart(event,\'' + m.id + '\')" ' +
          'ontouchend="_ctxTouchEnd()" ontouchmove="_ctxTouchEnd()">' +
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
            '<audio src="' + m.media_url + '" id="aud-' + m.id + '" preload="metadata"></audio>' +
            '<button class="play-voice" id="pbtn-' + m.id + '" onclick="_playVoice(\'' + m.id + '\',this)">' + ICON_PLAY_SM + '</button>' +
            '<div class="voice-bars" id="vbars-' + m.id + '" onclick="_seekVoice(event,\'' + m.id + '\')">' + bars + '</div>' +
            '<div class="voice-dur" id="vdur-' + m.id + '">' + (voiceData.dur || '0:00') + '</div>' +
            '<button class="voice-speed-btn" id="vspeed-' + m.id + '" onclick="_toggleVoiceSpeed(\'' + m.id + '\')">1x</button>' +
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
        inner += '<img src="' + m.media_url + '" style="max-width:260px;border-radius:10px;display:block;cursor:pointer;width:100%" loading="lazy" onclick="_openMediaViewer(\'' + m.id + '\')">';
      }
      if (m.text && m.text !== '__once__') {
        var capRTL = /[\u0590-\u05FF]/.test(m.text);
        inner += '<div style="margin-top:.35rem;font-size:.88rem;unicode-bidi:plaintext;' + (capRTL ? 'direction:rtl;text-align:right' : '') + '">' + _linkify(escHtml(m.text), isMe) + '</div>';
      }

    } else if (m.type === 'file' && m.media_url) {
      inner += '<a href="' + m.media_url + '" target="_blank" style="display:flex;align-items:center;gap:.5rem;text-decoration:none;color:var(--text)">' +
        '<div style="font-size:1.5rem">📄</div>' +
        '<div style="font-size:.82rem;overflow:hidden;text-overflow:ellipsis;max-width:160px">' + escHtml(m.text || 'File') + '</div>' +
      '</a>';

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
      ? '<div class="msg-mini-av" style="' + (m.sender_photo ? 'background-image:url(' + m.sender_photo + ');background-size:cover;background-position:center' : '') + '">' + (m.sender_photo ? '' : escHtml((m.sender_nick || '?').slice(0, 1).toUpperCase())) + '</div>'
      : '';

    var selectClass2 = CHAT_selected[m.id] ? ' msg-selected' : '';

    return dateSep +
      '<div class="msg-wrap' + (isMe ? ' me' : '') + selectClass2 + '" id="msg-' + m.id + '" data-id="' + m.id + '"' +
        ' onclick="_toggleSelect(\'' + m.id + '\')"' +
        ' oncontextmenu="event.preventDefault();showCtx(event,\'' + m.id + '\')"' +
        ' ontouchstart="_ctxTouchStart(event,\'' + m.id + '\')" ontouchend="_ctxClear()" ontouchmove="_ctxClear()">' +
        miniAv +
        '<div style="display:flex;flex-direction:column;' + (isMe ? 'align-items:flex-end' : 'align-items:flex-start') + '">' +
          '<div class="' + bubbleClass + '" data-msg-id="' + m.id + '">' +
            inner +
            '<div class="swipe-reply-icon">↩️</div>' +
          '</div>' +
          reactionRow +
        '</div>' +
      '</div>';
  }).join('');

  // Preserve scroll position if not at bottom
  var prevScroll = cont.scrollTop;
  var prevHeight = cont.scrollHeight;
  cont.innerHTML = html;

  if (scrollDown) {
    cont.scrollTop = cont.scrollHeight;
    CHAT_atBottom = true;
    CHAT_unreadNew = 0;
    var arrow = document.getElementById('new-arrow');
    if (arrow) arrow.style.display = 'none';
  } else {
    cont.scrollTop = prevScroll + (cont.scrollHeight - prevHeight);
  }

  _attachMessageGestures(cont);
}

// Swipe-right-to-reply + long-press-to-context-menu, both on the same bubble.
// Telegram pattern: a horizontal drag past ~50px triggers reply on release;
// a stationary hold past ~500ms opens the context menu instead.
function _attachMessageGestures(cont) {
  cont.querySelectorAll('.bubble[data-msg-id]').forEach(function (bubble) {
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
        var msg = CHAT_messages.find(function (m) { return m.id === msgId; });
        if (msg) _setReply(msg);
      }
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
    arrow.style.display = 'none';
  } else {
    arrow.style.display = 'flex';
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
  if (arrow) arrow.style.display = 'none';
};

window.scrollToMsg = function (id) {
  var el = document.getElementById('msg-' + id);
  if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.background = 'rgba(201,168,76,.15)'; setTimeout(function () { el.style.background = ''; }, 1200); }
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

  api.post('/chat', payload)
    .then(function () {
      inp.value = '';
      inp.style.height = 'auto';
      document.getElementById('chat-send-btn').style.display = 'none';
      document.getElementById('voice-rec-btn').style.display = 'flex';
      _cancelReply();
      loadMessages(true);
      loadChatRooms();
    })
    .catch(function (err) { toast('❌ ' + err.message); });
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
    navigator.mediaDevices.getUserMedia({ audio: true })
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

        // Pick best supported audio format
        var mimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported('audio/webm')) {
          if (MediaRecorder.isTypeSupported('audio/mp4'))  mimeType = 'audio/mp4';
          else if (MediaRecorder.isTypeSupported('audio/ogg')) mimeType = 'audio/ogg';
        }
        var ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';

        CHAT_mediaRec = new MediaRecorder(stream, { mimeType: mimeType });
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

          toast('📤 Sending voice note...');
          var form = new FormData();
          form.append('room_id', CHAT_curRoom.id);
          form.append('type', 'voice');
          form.append('text', packed);
          form.append('file', file);
          api.post('/chat', form, true)
            .then(function () { loadMessages(true); loadChatRooms(); })
            .catch(function (err) { toast('❌ ' + err.message); });
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
                  (STATE.user && (STATE.user.role === 'admin_super' || STATE.user.email === 'Jmittelman2@gmail.com'));
    grid.style.gridTemplateColumns = 'repeat(4, 1fr)';
    grid.innerHTML = STICKER_PACKS.map(function (s) {
      return '<div class="sticker-wrap">' +
        '<img class="sticker-gif" src="' + s.url + '" alt="' + s.label + '" loading="lazy" onclick="_sendSticker(\'' + s.url + '\')" title="' + s.label + '">' +
        (isAdmin ? '<div class="sticker-del" onclick="event.stopPropagation();_deleteSticker(\'' + s.id + '\')">✕</div>' : '') +
      '</div>';
    }).join('');
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
  if (!confirm('Remove this sticker?')) return;
  // Remove from STICKER_PACKS locally
  STICKER_PACKS = STICKER_PACKS.filter(function (s) { return s.id !== stickerId; });
  // Re-render
  _emojiCat(null, 'stickers');
  toast('✅ Sticker removed');
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
  var objectUrl = URL.createObjectURL(file);

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
      '<div style="flex:1;text-align:center;font-size:.82rem;color:rgba(255,255,255,.85)">1 ' + (isVideo ? 'video' : 'photo') + '</div>' +
    '</div>' +
    '<div style="flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:.5rem">' +
      (isVideo
        ? '<video src="' + objectUrl + '" controls playsinline style="max-width:100%;max-height:100%;border-radius:10px"></video>'
        : '<img src="' + objectUrl + '" style="max-width:100%;max-height:100%;border-radius:10px;object-fit:contain">') +
    '</div>' +
    '<div style="padding:.5rem .85rem max(.75rem,env(safe-area-inset-bottom));flex-shrink:0">' +
      '<div style="display:flex;align-items:center;gap:.5rem;background:rgba(255,255,255,.13);border-radius:22px;padding:.4rem .85rem;margin-bottom:.55rem">' +
        '<input id="media-caption-input" placeholder="Add a caption..." style="flex:1;background:none;border:none;color:#fff;outline:none;font-size:.88rem;font-family:inherit" autocomplete="off">' +
      '</div>' +
      '<button onclick="_sendSingleMedia()" style="width:100%;padding:.7rem;background:linear-gradient(135deg,#1565C0,#1976D2);border:none;border-radius:22px;color:#fff;font-size:.95rem;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:.5rem;box-shadow:0 2px 10px rgba(21,101,192,.4)">' +
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
        var url = URL.createObjectURL(f);
        var isVid = f.type.startsWith('video/');
        return '<div style="position:relative;flex-shrink:0;width:64px;height:64px;border-radius:8px;overflow:hidden;border:2px solid #1565C0">' +
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
      '<button onclick="_sendMultiMedia()" style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#1565C0,#1976D2);border:none;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;box-shadow:0 2px 8px rgba(21,101,192,.4)">' +
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
  var type = (isVideo || file.type.startsWith('image/')) ? 'media' : 'file';
  var form = new FormData();
  form.append('room_id', CHAT_curRoom.id);
  form.append('type', type);
  form.append('text', caption || '');
  form.append('file', file);
  api.post('/chat', form, true)
    .then(function () { loadMessages(true); loadChatRooms(); })
    .catch(function (err) { toast('❌ ' + err.message); });
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

  items += item(SVG.reply,    'Reply',        'ctxReply()');
  if (msg.type === 'text' || msg.type === 'media') items += item(SVG.copy, 'Copy', 'ctxCopy()');
  if (canEdit)   items += item(SVG.edit,      'Edit',         'ctxEdit()');
  items +=        item(SVG.forward,  'Forward',      'ctxForward()');
  if (canPin)    items += item(SVG.pin,       'Pin',          'ctxPin()');
  items +=        item(SVG_BOOKMARK, 'Save Message', 'bookmarkMessage(CHAT_ctxMsg.id)');
  items +=        item(SVG_TRANSLATE,'Translate',    'translateMessage(CHAT_ctxMsg.id)');
  if (!isMe)     items += item(SVG.report,    'Report',       'ctxReport()');
  if (canDelete) items += item(SVG.trash,     'Delete',       'ctxDelete()', true);
  items +=        item(SVG.close,    'Cancel',       'closeCtxMenu()');

  var el = document.getElementById('ctx-menu-items');
  el.innerHTML = items;

  // Wire clicks via event delegation to avoid inline-onclick quote hell
  el.querySelectorAll('.ctx-item').forEach(function (div) {
    div.addEventListener('click', function () {
      var fn = div.dataset.fn;
      document.getElementById('ctx-menu').classList.remove('open');
      if (fn) { try { eval(fn); } catch(e) { toast('❌ ' + e.message); } }
    });
  });
}

window.closeCtxMenu = function () {
  var m = document.getElementById('ctx-menu');
  if (m) m.classList.remove('open');
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
};

window.toggleReaction = function (msgId, emoji) {
  api.post('/chat/reactions', { message_id: msgId, emoji: emoji })
    .then(function (res) {
      CHAT_reactions[msgId] = { counts: res.reactions, my_reaction: res.my_reaction };
      renderMessages(false);
    })
    .catch(function (err) { toast('❌ ' + err.message); });
  var qr = document.getElementById('quick-react-bar');
  if (qr) qr.style.display = 'none';
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
  var bars = '';
  for (var i = 0; i < n; i++) {
    bars += '<div class="vbar" style="width:3px;height:' + (4 + Math.random() * 14) + 'px"></div>';
  }
  return bars;
}

function _linkify(text, isMe) {
  var c = isMe ? 'rgba(255,255,255,.9)' : 'var(--blue)';
  return text.replace(/(https?:\/\/[^\s<>"]+)/g, function (url) {
    return '<a href="' + url + '" target="_blank" style="color:' + c + ';word-break:break-all;text-decoration:underline">' + url + '</a>';
  });
}

function _renderWaveBars(peaks) {
  return peaks.map(function (p) {
    var h = Math.max(3, Math.round(p * 24));
    return '<div class="vbar" style="height:' + h + 'px"></div>';
  }).join('');
}

window._seekVoice = function (e, msgId) {
  var aud = document.getElementById('aud-' + msgId);
  var barsEl = document.getElementById('vbars-' + msgId);
  if (!aud || !barsEl || !aud.duration) return;
  var rect = barsEl.getBoundingClientRect();
  var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  aud.currentTime = pct * aud.duration;
};

window._toggleVoiceSpeed = function (msgId) {
  var aud = document.getElementById('aud-' + msgId);
  var btn = document.getElementById('vspeed-' + msgId);
  if (!aud || !btn) return;
  var newRate = aud.playbackRate >= 2 ? 1 : 2;
  aud.playbackRate = newRate;
  btn.textContent = newRate + 'x';
};

window._openOnceVoice = function (msgId, mediaUrl) {
  if (!confirm('This voice message will disappear after you listen to it. Continue?')) return;
  var aud = new Audio(mediaUrl);
  aud.play().catch(function () {});
  // Mark as opened locally and on the server (reuses the same view-once mechanism as media).
  var msg = CHAT_messages.find(function (m) { return m.id === msgId; });
  if (msg) msg.opened = true;
  api.put('/chat', { id: msgId, opened: true }).catch(function () {});
  renderMessages(false);
};

// Small SVG icons for voice note buttons (defined here, referenced in render + playback)
var ICON_PLAY_SM  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
var ICON_PAUSE_SM = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';

window._playVoice = function (msgId, btn) {
  var aud = document.getElementById('aud-' + msgId);
  if (!aud) return;

  // Stop any other playing voice notes first
  document.querySelectorAll('#chat-msgs audio').forEach(function (other) {
    if (other !== aud && !other.paused) {
      other.pause();
      var otherId = other.id.replace('aud-', '');
      var otherBtn = document.getElementById('pbtn-' + otherId);
      if (otherBtn) otherBtn.innerHTML = ICON_PLAY_SM;
    }
  });

  if (aud.paused) {
    aud.play().catch(function (e) { toast('\u26a0 Audio error: ' + e.message); });
    btn.innerHTML = ICON_PAUSE_SM;

    aud.ontimeupdate = function () {
      var barsEl = document.getElementById('vbars-' + msgId);
      if (!barsEl || !aud.duration) return;
      var pct = aud.currentTime / aud.duration;
      var bars = barsEl.querySelectorAll('.vbar');
      var playedCount = Math.floor(pct * bars.length);
      bars.forEach(function (b, i) { b.classList.toggle('played', i < playedCount); });
      var durEl = document.getElementById('vdur-' + msgId);
      if (durEl) {
        var rem = aud.duration - aud.currentTime;
        var m = Math.floor(rem / 60), s = Math.floor(rem % 60);
        durEl.textContent = m + ':' + (s < 10 ? '0' : '') + s;
      }
    };

    aud.onended = function () {
      btn.innerHTML = ICON_PLAY_SM;
      var barsEl = document.getElementById('vbars-' + msgId);
      if (barsEl) barsEl.querySelectorAll('.vbar').forEach(function (b) { b.classList.remove('played'); });
      _autoPlayNextVoice(msgId);
    };
  } else {
    aud.pause();
    btn.innerHTML = ICON_PLAY_SM;
  }
};

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
  if (!confirm('Close this poll? No more votes will be accepted.')) return;
  api.put('/polls', { id: pollId, close: true })
    .then(function(res) {
      if (res.poll) {
        var el = document.getElementById('poll-' + pollId);
        if (el) el.innerHTML = _buildPollHTML(res.poll);
      }
    })
    .catch(function(err) { toast('❌ ' + err.message); });
};

window.suggestPollOption = function (pollId) {
  var text = prompt('Suggest a new option:');
  if (!text || !text.trim()) return;
  api.put('/polls', { id: pollId, add_option: text.trim() })
    .then(function(res) {
      if (res.poll) {
        var el = document.getElementById('poll-' + pollId);
        if (el) el.innerHTML = _buildPollHTML(res.poll);
      }
    })
    .catch(function(err) { toast('❌ ' + err.message); });
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

  var form = new FormData();
  form.append('name', name.trim());
  form.append('description', desc.trim());
  form.append('type', 'channel');
  form.append('is_public', '1');
  form.append('read_only', '1');

  var photoEl = document.getElementById('new-channel-photo-preview');
  if (photoEl && photoEl._file) form.append('photo', photoEl._file);

  api.post('/chat/rooms', form, true)
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
  if (receipts) { receipts.classList.add('on'); }

  document.getElementById('chat-settings-modal').classList.add('open');
};

window.toggleDarkMode = function (toggleEl) {
  toggleEl.classList.toggle('on');
  var isDark = toggleEl.classList.contains('on');
  document.documentElement.classList.toggle('dark-mode', isDark);
  try { localStorage.setItem('yp_dark_mode', isDark ? '1' : '0'); } catch (e) {}
  toast(isDark ? '🌙 Dark mode on' : '☀️ Light mode on');
};

window.setChatFont = function (size, btn) {
  document.querySelectorAll('.cs-font-btn').forEach(function (b) { b.classList.remove('active'); });
  btn.classList.add('active');
  var sizes = { sm: '.88rem', md: '1rem', lg: '1.12rem' };
  var sz = sizes[size] || '1rem';
  // Apply to messages area
  var msgs = document.getElementById('chat-messages');
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
      'background:' + (isActive ? '#1565C0' : 'var(--bg3)') + ';' +
      'color:' + (isActive ? '#fff' : 'var(--muted)') + ';white-space:nowrap;flex-shrink:0;transition:all .18s">' +
      '<span>' + f.icon + '</span>' + escHtml(f.name) +
      (unread ? '<span style="background:' + (isActive ? 'rgba(255,255,255,.3)' : '#1565C0') + ';color:#fff;border-radius:10px;padding:.05rem .35rem;font-size:.62rem;font-weight:800;min-width:16px;text-align:center">' + (unread > 99 ? '99+' : unread) + '</span>' : '') +
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
        '<button onclick="createNewFolder()" style="padding:.5rem 1rem;background:#1565C0;color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-family:inherit">+ Add</button>' +
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
window.openGlobalSearch = function () {
  var existing = document.getElementById('global-search-modal');
  if (existing) existing.remove();
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
        '<input id="global-search-inp" placeholder="Search messages, chats..." style="flex:1;background:none;border:none;outline:none;font-size:.9rem;color:var(--text);font-family:inherit" oninput="doGlobalSearch()">' +
      '</div>' +
    '</div>' +
    '<div id="global-search-results" style="flex:1;overflow-y:auto;padding:.5rem">' +
      '<div style="text-align:center;padding:3rem 1rem;color:var(--muted);font-size:.85rem">Type to search across all chats</div>' +
    '</div>';
  document.body.appendChild(modal);
  setTimeout(function () { var i = document.getElementById('global-search-inp'); if (i) i.focus(); }, 100);
};

var _globalSearchTimer = null;
window.doGlobalSearch = function () {
  var q = (document.getElementById('global-search-inp') || {}).value || '';
  clearTimeout(_globalSearchTimer);
  if (q.length < 2) return;
  _globalSearchTimer = setTimeout(function () {
    api.get('/chat?search=' + encodeURIComponent(q))
      .then(function (res) {
        var el = document.getElementById('global-search-results');
        if (!el) return;
        var msgs = res.messages || [];
        if (!msgs.length) { el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--muted);font-size:.85rem">No results found</div>'; return; }
        el.innerHTML = msgs.map(function (m) {
          return '<div style="padding:.65rem .5rem;border-bottom:.5px solid var(--border);cursor:pointer" onclick="document.getElementById(\'global-search-modal\').remove();openChatRoom(\'' + m.room_id + '\')">' +
            '<div style="font-size:.7rem;color:var(--muted);margin-bottom:.2rem">@' + escHtml(m.sender_nick||'') + ' in ' + escHtml(m.room_name||'Chat') + ' · ' + timeAgo(m.created_at) + '</div>' +
            '<div style="font-size:.85rem">' + escHtml((m.text||'').slice(0,100)) + '</div>' +
          '</div>';
        }).join('');
      })
      .catch(function () {});
  }, 400);
};

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
        '<button onclick="doJumpToDate()" style="flex:1;padding:.6rem;background:#1565C0;color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-family:inherit">Go</button>' +
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
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.background = 'rgba(21,101,192,.1)'; setTimeout(function () { el.style.background = ''; }, 1500); }
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
          (current === o[0] ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1565C0" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '') +
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
  if (!confirm('Delete ' + ids.length + ' messages?')) return;
  var promises = ids.map(function (id) {
    return api.del('/chat?id=' + encodeURIComponent(id)).catch(function () {});
  });
  Promise.all(promises).then(function () {
    _exitSelectMode();
    loadMessages(true);
    toast('Deleted ' + ids.length + ' messages');
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
        : '<div style="width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#1565C0,#1976D2);display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.3rem;flex-shrink:0">👥</div>';
      el.style.display = 'block';
      el.innerHTML =
        '<div style="display:flex;align-items:center;gap:.65rem;padding:.65rem;background:var(--bg3);border-radius:10px">' +
          photoHtml +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:.88rem;font-weight:700;color:var(--text)">' + escHtml(room.name || 'Group') + '</div>' +
            '<div style="font-size:.72rem;color:var(--muted);margin-top:.1rem">' + (room.members || 0) + ' members · ' + (room.type || 'group') + '</div>' +
          '</div>' +
          '<button onclick="joinViaInvite(\'' + escHtml(inviteCode) + '\')" style="padding:.35rem .85rem;background:linear-gradient(135deg,#1565C0,#1976D2);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:.78rem;font-weight:700;font-family:inherit;white-space:nowrap">Join</button>' +
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
  api.get('/statuses?user_id=' + encodeURIComponent(STATE.user.id), true)
    .then(function (res) {
      var data = (res.statuses || [])[0];
      if (data && data.slides && data.slides.length) {
        HOME_svStatuses = [data];
        openSV(0);
      } else {
        openStatusUpload();
      }
    })
    .catch(function () { openStatusUpload(); });
};

window._goAddStatus = function () {
  openStatusUpload();
};

window._viewChatListAvatarStatus = function (userId) {
  api.get('/statuses?user_id=' + encodeURIComponent(userId), true)
    .then(function (res) {
      var data = (res.statuses || [])[0];
      if (!data || !data.slides || !data.slides.length) return;
      HOME_svStatuses = [data];
      openSV(0);
    })
    .catch(function () {});
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
    var color = isMine ? '#999' : 'var(--blue, #1565C0)';
    segs += '<path d="M ' + x0.toFixed(2) + ' ' + y0.toFixed(2) +
      ' A ' + r + ' ' + r + ' 0 ' + largeArc + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2) + '" ' +
      'stroke="' + color + '" stroke-width="2.5" fill="none" stroke-linecap="round"/>';
  }
  return segs;
}
window._svSegments = _svSegments;
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
