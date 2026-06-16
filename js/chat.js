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
    var avStyle  = isGroup
      ? 'width:48px;height:48px;border-radius:14px;background:linear-gradient(135deg,var(--gold-d),var(--gold));display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0;color:#fff;position:relative'
      : 'width:48px;height:48px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:1.1rem;font-weight:700;flex-shrink:0;border:1px solid var(--border);position:relative;color:var(--text)';
    var onlineDot = (!isGroup && c.online)
      ? '<div style="position:absolute;bottom:1px;right:1px;width:11px;height:11px;border-radius:50%;background:var(--green);border:2px solid #fff"></div>'
      : '';
    var previewText = c.preview || 'No messages yet';
    var timeText = c.last_time ? _fmt12(c.last_time) : '';
    var unreadBadge = c.unread
      ? '<div style="min-width:18px;height:18px;border-radius:9px;background:var(--gold-d);color:#fff;font-size:.62rem;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px;flex-shrink:0">' + c.unread + '</div>'
      : '';

    return '<div class="chat-item' + (c.unread ? ' unread' : '') + '" onclick="openChatRoom(\'' + c.id + '\')">' +
      '<div style="' + avStyle + '">' + (isGroup ? '👥' : initial) + onlineDot + '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.2rem">' +
          '<div style="font-size:.88rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px">' + escHtml(c.nick || 'Chat') + '</div>' +
          '<div style="font-size:.63rem;color:var(--muted);flex-shrink:0">' + timeText + '</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between">' +
          '<div style="font-size:.78rem;color:' + (c.unread ? 'var(--text)' : 'var(--muted)') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px">' + escHtml(previewText) + '</div>' +
          unreadBadge +
        '</div>' +
        ((!c.joined && isGroup) ? '<div style="font-size:.65rem;color:var(--gold-d);margin-top:.2rem">Tap to Join</div>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

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
  document.getElementById('cr-name').onclick = isGroup ? function(){ openMembersList(); } : null;
  document.getElementById('cr-name').style.cursor = isGroup ? 'pointer' : 'default';

  var st = document.getElementById('cr-status');
  if (isGroup) {
    st.textContent = (room.members != null ? room.members + ' members' : 'Group') + ' · tap name to view';
    st.style.color = 'var(--muted)';
  } else if (room.online) {
    st.textContent = 'online';
    st.style.color = 'var(--green)';
  } else {
    st.textContent = 'offline';
    st.style.color = 'var(--muted)';
  }

  // Join banner
  var needsJoin = (!room.joined && isGroup);
  document.getElementById('join-banner').style.display = needsJoin ? 'flex' : 'none';
  var ib = document.getElementById('chat-input-bar');
  ib.style.opacity = needsJoin ? '.4' : '1';
  ib.style.pointerEvents = needsJoin ? 'none' : 'all';

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
function loadGroupMembers(roomId) {
  api.get('/chat/rooms').then(function (res) {
    var room = (res.rooms || []).find(function (r) { return r.id === roomId; });
    if (room && room.member_list) CHAT_members = room.member_list;
  }).catch(function () {});
}

window.openMembersList = function () {
  var modal = document.getElementById('members-modal');
  if (!modal) return;
  var list = document.getElementById('members-list');
  if (!list) return;
  document.getElementById('members-modal-title').textContent = (CHAT_curRoom && CHAT_curRoom.nick) || 'Group';

  if (!CHAT_members.length) {
    list.innerHTML = '<div style="padding:1rem;text-align:center;font-size:.8rem;color:var(--muted)">Members list not available</div>';
  } else {
    list.innerHTML = CHAT_members.map(function (m) {
      return '<div style="display:flex;align-items:center;gap:.75rem;padding:.65rem 0;border-bottom:1px solid var(--border)">' +
        '<div style="width:38px;height:38px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:.9rem;font-weight:700;border:1px solid var(--border)">' +
          (m.nickname || '?').slice(0, 1).toUpperCase() +
        '</div>' +
        '<div style="flex:1"><div style="font-size:.85rem;font-weight:700">@' + escHtml(m.nickname || 'User') + '</div>' +
        (m.online ? '<div style="font-size:.68rem;color:var(--green)">● online</div>' : '<div style="font-size:.68rem;color:var(--muted)">offline</div>') +
        '</div>' +
        (m.role === 'admin_super' || m.role === 'admin_limited' ? '<span style="font-size:.65rem;background:rgba(201,168,76,.1);color:var(--gold-d);border:1px solid var(--border);border-radius:6px;padding:.1rem .4rem">Admin</span>' : '') +
      '</div>';
    }).join('');
  }
  modal.classList.add('open');
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
    if (m.type === 'sticker') {
      return dateSep + '<div class="msg-wrap' + (isMe ? ' me' : '') + '" id="msg-' + m.id + '" data-id="' + m.id + '">' +
        '<div class="bubble sticker">' + escHtml(m.text || '😊') + '</div>' +
      '</div>';

    } else if (m.type === 'voice' && m.media_url) {
      inner += '<div class="voice-msg">' +
        '<audio src="' + m.media_url + '" id="aud-' + m.id + '" preload="metadata"></audio>' +
        '<button class="play-voice" onclick="_playVoice(\'' + m.id + '\',this)">▶</button>' +
        '<div class="voice-bars">' + _fakeBars(20) + '</div>' +
        '<div class="voice-dur" id="vdur-' + m.id + '">' + (m.text || '0:00') + '</div>' +
      '</div>';

    } else if (m.type === 'voice_text') {
      // Voice note without actual audio (fallback)
      inner += '<div class="voice-msg">' +
        '<button class="play-voice" onclick="toast(\'Audio not available\')">▶</button>' +
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

    inner += '<div class="bubble-meta"><span class="bubble-time">' + time + '</span>' + ticks + '</div>';

    var miniAv = (!isMe && isGroup)
      ? '<div class="msg-mini-av">' + escHtml((m.sender_nick || '?').slice(0, 1).toUpperCase()) + '</div>'
      : '';

    return dateSep +
      '<div class="msg-wrap' + (isMe ? ' me' : '') + '" id="msg-' + m.id + '" data-id="' + m.id + '">' +
        miniAv +
        '<div class="' + bubbleClass + '" ' +
          'oncontextmenu="event.preventDefault();showCtx(event,\'' + m.id + '\')" ' +
          'ontouchstart="_ctxTouch(event,\'' + m.id + '\')" ' +
          'ontouchend="_ctxClear()">' +
          inner +
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

  // Typing indicator placeholder (just UI — no backend)
  clearTimeout(CHAT_typingTimer);
  CHAT_typingTimer = setTimeout(function () {}, 2000);
};
var CHAT_typingTimer = null;

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
// VOICE NOTES (MediaRecorder)
// ============================================================
window.toggleVoiceRec = function () {
  if (CHAT_isRecording) {
    // Stop recording
    if (CHAT_mediaRec && CHAT_mediaRec.state !== 'inactive') CHAT_mediaRec.stop();
  } else {
    // Start recording
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return toast('⚠ Microphone not available in this browser.');
    }
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(function (stream) {
        CHAT_recChunks = [];
        CHAT_recStart  = Date.now();
        CHAT_isRecording = true;
        var btn = document.getElementById('voice-rec-btn');
        if (btn) { btn.textContent = '⏹️'; btn.classList.add('rec'); }
        toast('🎙️ Recording... tap ⏹️ to send');

        CHAT_mediaRec = new MediaRecorder(stream);
        CHAT_mediaRec.ondataavailable = function (e) { if (e.data.size > 0) CHAT_recChunks.push(e.data); };
        CHAT_mediaRec.onstop = function () {
          CHAT_isRecording = false;
          var btn2 = document.getElementById('voice-rec-btn');
          if (btn2) { btn2.textContent = '🎙️'; btn2.classList.remove('rec'); }
          stream.getTracks().forEach(function (t) { t.stop(); });

          var dur  = Math.round((Date.now() - CHAT_recStart) / 1000);
          var durStr = Math.floor(dur / 60) + ':' + String(dur % 60).padStart(2, '0');
          var blob = new Blob(CHAT_recChunks, { type: 'audio/webm' });
          var file = new File([blob], 'voice_' + Date.now() + '.webm', { type: 'audio/webm' });

          toast('📤 Sending voice note...');
          var form = new FormData();
          form.append('room_id', CHAT_curRoom.id);
          form.append('type', 'voice');
          form.append('text', durStr);
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

  api.post('/chat/rooms', { type: 'group', name: name, emoji: emoji })
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

window._playVoice = function (msgId, btn) {
  var aud = document.getElementById('aud-' + msgId);
  if (!aud) return;
  if (aud.paused) {
    aud.play();
    btn.textContent = '⏸';
    aud.onended = function () { btn.textContent = '▶'; };
  } else {
    aud.pause();
    btn.textContent = '▶';
  }
};

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
