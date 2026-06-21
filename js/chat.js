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
var CHAT_atBottom    = true;
var CHAT_members     = [];  // current room members

// ============================================================
// BOOT
// ============================================================
window.init_chats = function () {
  loadChatRooms();
};

// ============================================================
// CHAT LIST
// ============================================================
function loadChatRooms() {
  var el = document.getElementById('chat-list-area');
  if (!el) return;
  el.innerHTML = '<div class="feed-state"><div class="spinner"></div><div>Loading chats...</div></div>';

  api.get('/chat/rooms')
    .then(function (res) {
      CHAT_rooms = res.rooms || [];
      renderChatList();
    })
    .catch(function (err) {
      el.innerHTML =
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
      (CHAT_tab === 'private' && c.type === 'private') ||
      (CHAT_tab === 'groups'  && c.type === 'group');
    var srchOk = !CHAT_search ||
      (c.nick || '').toLowerCase().indexOf(CHAT_search.toLowerCase()) !== -1;
    return tabOk && srchOk;
  });

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
    var photoBg  = c.photo_url ? "background-image:url('" + c.photo_url + "');background-size:cover;background-position:center;" : '';
    var avClass  = 'chat-av' + (isGroup ? ' group' : '');
    var avStyle  = photoBg; // gradient/colors come from the .chat-av CSS class now
    var avatarContent = c.photo_url ? '' : (isGroup ? '👥' : initial);
    var onlineDot = (!isGroup && c.online) ? '<div class="online-dot"></div>' : '';
    var previewText = c.preview || 'No messages yet';
    var timeText = c.last_time ? _fmt12(c.last_time) : '';
    var unreadBadge = c.unread ? '<div class="unread-badge">' + c.unread + '</div>' : '';

    return '<div class="chat-item-wrap" data-room-id="' + c.id + '">' +
      '<div class="chat-item-delete" onclick="event.stopPropagation();deleteChatRoom(\'' + c.id + '\',\'' + escHtml((c.nick || 'Chat')).replace(/'/g, "\\'") + '\')"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg></div>' +
      '<div class="chat-item' + (c.unread ? ' unread' : '') + '" onclick="_chatItemClick(event,\'' + c.id + '\')">' +
        '<div class="' + avClass + '" style="' + avStyle + '">' + avatarContent + onlineDot + '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.2rem;gap:.5rem">' +
            '<div style="font-size:.9rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;unicode-bidi:plaintext;text-align:start">' + escHtml(c.nick || 'Chat') + '</div>' +
            '<div style="font-size:.68rem;color:var(--muted);flex-shrink:0">' + timeText + '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem">' +
            '<div style="font-size:.8rem;color:' + (c.unread ? 'var(--text)' : 'var(--muted)') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;unicode-bidi:plaintext;text-align:start;flex:1">' + escHtml(previewText) + '</div>' +
            unreadBadge +
          '</div>' +
          ((!c.joined && isGroup) ? '<div style="font-size:.65rem;color:var(--gold-d);margin-top:.2rem">Tap to Join</div>' : '') +
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
window._chatItemClick = function (e, roomId) {
  var item = e.currentTarget;
  if (item.classList.contains('swiped')) {
    item.classList.remove('swiped');
    return;
  }
  openChatRoom(roomId);
};

// Same delete/leave action as the chat-list swipe, but callable from
// inside an already-open chat room (the kebab menu at the top).
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
      if (CHAT_curRoom && CHAT_curRoom.id === roomId) { CHAT_curRoom = null; navTo('chats'); }
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
  if (!room) return;

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
  av.className   = 'chatroom-avatar' + (isGroup ? ' group' : '');
  if (room.photo_url) {
    av.style.backgroundImage = "url('" + room.photo_url + "')";
    av.textContent = '';
  } else {
    av.style.backgroundImage = '';
    av.textContent = isGroup ? '👥' : (room.nick || '?').slice(0, 1).toUpperCase();
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
  } else if (room.online) {
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

  // Reply bar
  document.getElementById('reply-bar').style.display = 'none';
  document.getElementById('sticker-tray').classList.remove('open');
  document.getElementById('new-arrow').style.display = 'none';

  navTo('chatroom');

  loadMessages(true);
  clearInterval(CHAT_pollTimer);
  CHAT_pollTimer = setInterval(function () { loadMessages(false); }, 3000);

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
  avBig.onclick = isGroup ? function () { document.getElementById('group-photo-input').click(); } : null;
  avBig.style.cursor = isGroup ? 'pointer' : 'default';

  document.getElementById('info-name').textContent = CHAT_curRoom.nick || 'Chat';
  document.getElementById('info-sub').textContent = isGroup
    ? (CHAT_curRoom.members || 0) + ' members'
    : (CHAT_curRoom.online ? 'online' : 'last seen recently');

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
      (m.online ? '<div style="font-size:.68rem;color:var(--green)">● online</div>' : '<div style="font-size:.68rem;color:var(--muted)">offline</div>') +
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
                : '<img src="' + m.media_url + '" style="width:100%;height:100%;object-fit:cover">') +
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
          arrow.querySelector('.new-count').textContent = CHAT_unreadNew;
        }
      }

      renderMessages(scrollToBottom || CHAT_atBottom);

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

  var meId    = STATE.user && STATE.user.id;
  var isGroup = CHAT_curRoom.type === 'group';
  var lastDate = '';

  var html = CHAT_messages.map(function (m, idx) {
    var isMe = m.sender_id === meId;
    var msgDate = m.created_at ? m.created_at.slice(0, 10) : '';
    var dateSep = '';
    if (msgDate && msgDate !== lastDate) {
      lastDate = msgDate;
      dateSep = '<div class="date-sep"><span>' + _dateLabel(m.created_at) + '</span></div>';
    }

    var time = m.created_at ? _fmt12(m.created_at) : '';
    var ticks = isMe ? '<span class="read-ticks">' + (m.read ? '✓✓' : '✓') + '</span>' : '';

    // System messages (e.g. "X joined the group") — centered, no bubble
    if (m.type === 'system') {
      return dateSep + '<div class="sys-msg"><span>' + escHtml(m.text || '') + '</span></div>';
    }

    var bubbleClass = 'bubble ' + (isMe ? 'me' : 'them');
    var inner = '';

    // Group sender nick
    if (!isMe && isGroup) {
      inner += '<div class="bubble-nick">@' + escHtml(m.sender_nick || '') + '</div>';
    }

    // Reply quote
    if (m.reply_to_id) {
      var quoted = CHAT_messages.find(function (q) { return q.id === m.reply_to_id; });
      if (quoted) {
        inner += '<div class="reply-quote" onclick="scrollToMsg(\'' + quoted.id + '\')">' +
          '<strong>' + escHtml(quoted.sender_id === meId ? 'You' : (quoted.sender_nick || 'User')) + '</strong>' +
          escHtml((quoted.text || '[media]').slice(0, 60)) +
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
      return dateSep + '<div class="msg-wrap' + (isMe ? ' me' : '') + '" id="msg-' + m.id + '" data-id="' + m.id + '">' +
        '<div class="bubble sticker">' + escHtml(m.text || '😊') + '</div>' +
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
            '<button class="play-voice" onclick="_playVoice(\'' + m.id + '\',this)"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>' +
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
        inner += '<video src="' + m.media_url + '" controls style="max-width:220px;border-radius:10px;display:block;max-height:200px"></video>';
      } else {
        inner += '<img src="' + m.media_url + '" style="max-width:220px;border-radius:10px;display:block;cursor:pointer" onclick="window.open(\'' + m.media_url + '\')">';
      }
      if (m.text && m.text !== '__once__') inner += '<div style="margin-top:.35rem;font-size:.85rem">' + escHtml(m.text) + '</div>';

    } else if (m.type === 'file' && m.media_url) {
      inner += '<a href="' + m.media_url + '" target="_blank" style="display:flex;align-items:center;gap:.5rem;text-decoration:none;color:var(--text)">' +
        '<div style="font-size:1.5rem">📄</div>' +
        '<div style="font-size:.82rem;overflow:hidden;text-overflow:ellipsis;max-width:160px">' + escHtml(m.text || 'File') + '</div>' +
      '</a>';

    } else {
      // Text — detect links
      inner += '<span>' + _linkify(escHtml(m.text || '')) + '</span>';
    }

    inner += '<div class="bubble-meta">' + (m.edited_at ? '<span class="edited-tag">edited</span>' : '') + '<span class="bubble-time">' + time + '</span>' + ticks + '</div>';

    var miniAv = (!isMe && isGroup)
      ? '<div class="msg-mini-av">' + escHtml((m.sender_nick || '?').slice(0, 1).toUpperCase()) + '</div>'
      : '';

    var myReaction = CHAT_reactions[m.id] && CHAT_reactions[m.id].my_reaction;
    var reactionCounts = (CHAT_reactions[m.id] && CHAT_reactions[m.id].counts) || {};
    var reactionPills = Object.keys(reactionCounts).map(function (emo) {
      return '<span class="reaction-pill' + (emo === myReaction ? ' mine' : '') + '" onclick="event.stopPropagation();toggleReaction(\'' + m.id + '\',\'' + emo + '\')">' + emo + ' ' + reactionCounts[emo] + '</span>';
    }).join('');
    var reactionRow = reactionPills ? '<div class="reaction-row">' + reactionPills + '</div>' : '';

    return dateSep +
      '<div class="msg-wrap' + (isMe ? ' me' : '') + '" id="msg-' + m.id + '" data-id="' + m.id + '">' +
        miniAv +
        '<div style="display:flex;flex-direction:column;' + (isMe ? 'align-items:flex-end' : 'align-items:flex-start') + '">' +
          '<div class="' + bubbleClass + '" data-msg-id="' + m.id + '" ' +
            'oncontextmenu="event.preventDefault();showCtx(event,\'' + m.id + '\')">' +
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
  if (CHAT_atBottom) {
    CHAT_unreadNew = 0;
    var arrow = document.getElementById('new-arrow');
    if (arrow) arrow.style.display = 'none';
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
  var has = (inp.value || '').trim().length > 0;
  document.getElementById('chat-send-btn').style.display  = has ? 'flex' : 'none';
  document.getElementById('voice-rec-btn').style.display  = has ? 'none' : 'flex';
  document.getElementById('attach-sheet').classList.remove('open');

  // Broadcast "I'm typing" to the server, throttled to once per 2s so we
  // don't spam a request on every keystroke. The server entry has a 5s TTL,
  // so as long as the user keeps typing within that window it stays fresh.
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
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMsg(); }
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

        CHAT_mediaRec = new MediaRecorder(stream);
        CHAT_mediaRec.ondataavailable = function (e) { if (e.data.size > 0) CHAT_recChunks.push(e.data); };
        CHAT_mediaRec.onstop = function () {
          CHAT_isRecording = false;
          cancelAnimationFrame(CHAT_recRaf);
          _hideRecordingBar();
          var btn2 = document.getElementById('voice-rec-btn');
          if (btn2) { btn2.textContent = '🎙️'; btn2.classList.remove('rec'); }
          stream.getTracks().forEach(function (t) { t.stop(); });

          if (CHAT_recCancelled) {
            toast('🗑 Recording discarded');
            return;
          }

          var dur  = Math.round((Date.now() - CHAT_recStart) / 1000);
          var durStr = Math.floor(dur / 60) + ':' + String(dur % 60).padStart(2, '0');

          var peaks = _downsamplePeaks(CHAT_recPeaks, 40);
          var packed = durStr + '|' + peaks.map(function (p) { return Math.round(p * 100); }).join(',');

          var blob = new Blob(CHAT_recChunks, { type: 'audio/webm' });
          var file = new File([blob], 'voice_' + Date.now() + '.webm', { type: 'audio/webm' });

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
        CHAT_mediaRec.start();
      })
      .catch(function () { toast('⚠ Microphone permission denied.'); });
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

function _showRecordingBar() {
  var bar = document.getElementById('rec-live-bar');
  if (bar) bar.style.display = 'flex';
  var lockIndicator = document.getElementById('rec-lock-indicator');
  if (lockIndicator) lockIndicator.style.display = 'flex';
  var hint = document.getElementById('rec-live-hint');
  if (hint) { hint.style.display = 'block'; hint.textContent = '← slide to cancel'; }
  var sendBtn = document.getElementById('rec-locked-send-btn');
  var cancelBtn = document.getElementById('rec-locked-cancel-btn');
  if (sendBtn) sendBtn.style.display = 'none';
  if (cancelBtn) cancelBtn.style.display = 'none';
}
function _hideRecordingBar() {
  var bar = document.getElementById('rec-live-bar');
  if (bar) bar.style.display = 'none';
  var lockIndicator = document.getElementById('rec-lock-indicator');
  if (lockIndicator) lockIndicator.style.display = 'none';
  var lockIcon = document.getElementById('rec-lock-icon');
  if (lockIcon) lockIcon.style.transform = 'translateY(0)';
}
function _updateRecordingBar(level) {
  var fill = document.getElementById('rec-live-level');
  if (fill) fill.style.height = Math.max(4, level * 28) + 'px';
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
var STICKERS = ['😂','❤️','🔥','👑','🎹','✡️','🕎','🎉','🙏','😭','💯','🎶','👏','🤣','😍','🥰','🫶','🙌','😎','🤩'];

window.toggleStickers = function () {
  var tray = document.getElementById('sticker-tray');
  tray.classList.toggle('open');
  if (tray.classList.contains('open') && !tray.children.length) {
    STICKERS.forEach(function (s) {
      var el = document.createElement('div');
      el.style.cssText = 'font-size:1.8rem;cursor:pointer;padding:.25rem;transition:transform .12s';
      el.textContent   = s;
      el.ontouchstart  = function () { el.style.transform = 'scale(1.3)'; };
      el.ontouchend    = function () { el.style.transform = ''; };
      el.onclick = function () {
        api.post('/chat', { room_id: CHAT_curRoom.id, type: 'sticker', text: s })
          .then(function () { loadMessages(true); tray.classList.remove('open'); })
          .catch(function (err) { toast('❌ ' + err.message); });
      };
      tray.appendChild(el);
    });
  }
};

// ============================================================
// ATTACHMENTS — Photo / Video / File / Once
// ============================================================
window.toggleAttach = function () {
  document.getElementById('attach-sheet').classList.toggle('open');
};

window.triggerMediaPick = function (accept, isOnce) {
  var inp = document.getElementById('chat-media-input');
  inp.setAttribute('accept', accept);
  inp.dataset.once = isOnce ? '1' : '';
  inp.click();
  document.getElementById('attach-sheet').classList.remove('open');
};

window.handleChatMedia = function (e) {
  var file  = e.target.files[0];
  if (!file || !CHAT_curRoom) return;
  var isOnce = !!e.target.dataset.once;
  var isVideo = file.type.startsWith('video/');
  var type  = isVideo ? 'media' : (file.type.startsWith('image/') ? 'media' : 'file');

  toast('📤 Uploading...');
  var form = new FormData();
  form.append('room_id', CHAT_curRoom.id);
  form.append('type', type);
  form.append('text', isOnce ? '__once__' : '');
  form.append('file', file);

  api.post('/chat', form, true)
    .then(function () {
      loadMessages(true);
      loadChatRooms();
      toast('✅ Sent!');
    })
    .catch(function (err) { toast('❌ ' + err.message); });

  e.target.value = '';
};

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
  _ctxTimer = setTimeout(function () { showCtx(e.touches[0], msgId); }, 500);
};
window._ctxClear = function () { clearTimeout(_ctxTimer); };

window.showCtx = function (e, msgId) {
  CHAT_ctxMsg = CHAT_messages.find(function (m) { return m.id === msgId; });
  if (!CHAT_ctxMsg) return;
  var menu = document.getElementById('ctx-menu');
  menu.classList.add('open');
  var x = (e.clientX || (e.touches && e.touches[0].clientX) || 0);
  var y = (e.clientY || (e.touches && e.touches[0].clientY) || 0);
  menu.style.left = Math.min(x, window.innerWidth  - 180) + 'px';
  menu.style.top  = Math.min(y, window.innerHeight - 200) + 'px';
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
    navigator.clipboard.writeText(CHAT_ctxMsg.text).then(function () { toast('📋 Copied!'); });
  }
  document.getElementById('ctx-menu').classList.remove('open');
};
window.ctxForward = function () {
  toast('📤 Forward: coming soon');
  document.getElementById('ctx-menu').classList.remove('open');
};
window.ctxEdit = function () {
  document.getElementById('ctx-menu').classList.remove('open');
  if (!CHAT_ctxMsg) return;
  var meId = STATE.user && STATE.user.id;
  if (CHAT_ctxMsg.sender_id !== meId) return toast('⚠ You can only edit your own messages.');
  if (CHAT_ctxMsg.type !== 'text') return toast('⚠ Only text messages can be edited.');

  var newText = prompt('Edit message:', CHAT_ctxMsg.text || '');
  if (newText === null) return;
  newText = newText.trim();
  if (!newText) return toast('⚠ Message cannot be empty.');

  api.put('/chat', { id: CHAT_ctxMsg.id, text: newText })
    .then(function () { loadMessages(true); toast('✏️ Message edited'); })
    .catch(function (err) { toast('❌ ' + err.message); });
};
window.ctxDelete = function () {
  if (!CHAT_ctxMsg) return;
  api.del('/chat?id=' + encodeURIComponent(CHAT_ctxMsg.id))
    .then(function () { loadMessages(true); toast('🗑 Deleted'); })
    .catch(function (err) { toast('❌ ' + err.message); });
  document.getElementById('ctx-menu').classList.remove('open');
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

function _linkify(text) {
  return text.replace(/(https?:\/\/[^\s]+)/g, function (url) {
    return '<a href="' + url + '" target="_blank" style="color:var(--blue);word-break:break-all">' + url + '</a>';
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

window._playVoice = function (msgId, btn) {
  var aud = document.getElementById('aud-' + msgId);
  if (!aud) return;

  document.querySelectorAll('.chat-messages audio').forEach(function (other) {
    if (other !== aud && !other.paused) {
      other.pause();
      var otherId = other.id.replace('aud-', '');
      var otherBtn = document.querySelector('[onclick*="_playVoice(\'' + otherId + '\'"]');
      if (otherBtn) otherBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    }
  });

  if (aud.paused) {
    aud.play().catch(function () {});
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';

    aud.ontimeupdate = function () {
      var barsEl = document.getElementById('vbars-' + msgId);
      if (!barsEl || !aud.duration) return;
      var pct = aud.currentTime / aud.duration;
      var bars = barsEl.querySelectorAll('.vbar');
      var playedCount = Math.floor(pct * bars.length);
      bars.forEach(function (b, i) { b.classList.toggle('played', i < playedCount); });
    };

    aud.onended = function () {
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
      var barsEl = document.getElementById('vbars-' + msgId);
      if (barsEl) barsEl.querySelectorAll('.vbar').forEach(function (b) { b.classList.remove('played'); });
      _autoPlayNextVoice(msgId);
    };
  } else {
    aud.pause();
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  }
};

function _autoPlayNextVoice(currentMsgId) {
  var idx = CHAT_messages.findIndex(function (m) { return m.id === currentMsgId; });
  if (idx === -1) return;
  for (var i = idx + 1; i < CHAT_messages.length; i++) {
    if (CHAT_messages[i].type === 'voice') {
      var nextBtn = document.querySelector('#msg-' + CHAT_messages[i].id + ' .play-voice');
      if (nextBtn) { _playVoice(CHAT_messages[i].id, nextBtn); }
      return;
    }
  }
}

// ============================================================
// INIT SCROLL LISTENER after navTo('chatroom')
// ============================================================
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
      '<div style="font-size:.7rem;font-weight:700;color:var(--blue);margin-bottom:.4rem;letter-spacing:.08em">📊 POLL</div>' +
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

  return '<div style="font-size:.7rem;font-weight:700;color:var(--blue);margin-bottom:.4rem;letter-spacing:.08em">📊 POLL' + (poll.quiz_mode ? ' · QUIZ' : '') + '</div>' +
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
