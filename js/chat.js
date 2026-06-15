// ============================================================
// js/chat.js — Chat list + Chat room (Cloudflare D1 + R2)
// Uses: api, STATE, toast, escHtml, timeAgo, nowTime, navTo
// Screens: #screen-chats, #screen-chatroom
// ============================================================

var CHAT_rooms      = [];
var CHAT_tab        = 'all';
var CHAT_search     = '';
var CHAT_curRoom    = null;
var CHAT_replyTo    = null;
var CHAT_ctxTarget  = null;
var CHAT_isRecording = false;
var CHAT_pollTimer  = null;

// ============================================================
// CHAT LIST
// ============================================================
window.init_chats = function () {
  loadChatRooms();
};

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
      el.innerHTML = '<div class="feed-state"><div style="font-size:2rem">⚠️</div><div>Could not load chats</div>' +
        '<div style="font-size:.75rem">' + escHtml(err.message) + '</div>' +
        '<button class="feed-retry" onclick="loadChatRooms()">Try Again</button></div>';
    });
}
window.loadChatRooms = loadChatRooms;

function renderChatList() {
  var el = document.getElementById('chat-list-area');
  if (!el) return;

  var filtered = CHAT_rooms.filter(function (c) {
    var tabOk = CHAT_tab === 'all' ||
      (CHAT_tab === 'private' && c.type === 'private') ||
      (CHAT_tab === 'groups' && c.type === 'group');
    var searchOk = !CHAT_search || (c.nick || '').toLowerCase().indexOf(CHAT_search.toLowerCase()) !== -1;
    return tabOk && searchOk;
  });

  if (!filtered.length) {
    el.innerHTML = '<div class="feed-state"><div style="font-size:2.5rem">💬</div><div>No chats found</div>' +
      '<div style="font-size:.75rem">Tap ✏️ above to start a new chat</div></div>';
    return;
  }

  el.innerHTML = filtered.map(function (c) {
    var avClass = 'chat-av' + (c.type === 'group' ? ' group' : '');
    var online = c.online ? '<div class="online-dot"></div>' : '';
    var unread = c.unread ? '<div class="unread-badge">' + c.unread + '</div>' : '';
    var joinTag = (!c.joined && c.type === 'group')
      ? '<div style="font-size:.65rem;color:var(--gold-d);border:1px solid var(--border);border-radius:6px;padding:.15rem .5rem;margin-top:.3rem;display:inline-block">Tap to Join</div>'
      : '';
    var previewColor = c.unread ? 'var(--text)' : 'var(--muted)';

    return '<div class="chat-item' + (c.unread ? ' unread' : '') + '" onclick="openChatRoom(\'' + c.id + '\')">' +
      '<div class="' + avClass + '">' + (c.emoji || '👤') + online + '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;align-items:center;justify-content:space-between">' +
          '<div style="font-size:.88rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px">' + escHtml(c.nick || 'Chat') + '</div>' +
          '<div style="font-size:.65rem;color:var(--muted);flex-shrink:0">' + (c.last_time ? timeAgo(c.last_time) : '') + '</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:.2rem">' +
          '<div style="font-size:.78rem;color:' + previewColor + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px">' + escHtml(c.preview || 'No messages yet') + '</div>' +
          unread +
        '</div>' +
        joinTag +
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

  CHAT_curRoom = room;
  room.unread = 0;
  renderChatList();

  var av = document.getElementById('cr-avatar');
  av.textContent = room.emoji || '👤';
  av.className = 'chatroom-avatar' + (room.type === 'group' ? ' group' : '');

  document.getElementById('cr-name').textContent = room.nick + (room.members != null ? ' (' + room.members + ' members)' : '');
  var st = document.getElementById('cr-status');
  if (room.type === 'group') {
    st.textContent = '👥 ' + (room.members || 0) + ' members';
    st.style.color = 'var(--muted)';
  } else if (room.online) {
    st.textContent = '● Online';
    st.style.color = 'var(--green)';
  } else {
    st.textContent = 'Offline';
    st.style.color = 'var(--muted)';
  }

  var jb = document.getElementById('join-banner');
  var needsJoin = (!room.joined && room.type === 'group');
  jb.style.display = needsJoin ? 'flex' : 'none';

  var ib = document.getElementById('chat-input-bar');
  ib.style.opacity = needsJoin ? '.4' : '1';
  ib.style.pointerEvents = needsJoin ? 'none' : 'all';

  CHAT_replyTo = null;
  document.getElementById('reply-bar').style.display = 'none';
  document.getElementById('sticker-tray').classList.remove('open');

  loadMessages();
  navTo('chatroom');

  clearInterval(CHAT_pollTimer);
  CHAT_pollTimer = setInterval(loadMessages, 4000);
};

window.joinGroup = function () {
  if (!CHAT_curRoom) return;
  api.post('/chat/join', { room_id: CHAT_curRoom.id })
    .then(function () {
      CHAT_curRoom.joined = true;
      document.getElementById('join-banner').style.display = 'none';
      var ib = document.getElementById('chat-input-bar');
      ib.style.opacity = '1';
      ib.style.pointerEvents = 'all';
      toast('✅ Joined ' + CHAT_curRoom.nick + '!');
      loadChatRooms();
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

// ============================================================
// MESSAGES
// ============================================================
function loadMessages() {
  if (!CHAT_curRoom) return;
  var cont = document.getElementById('chat-msgs');

  api.get('/chat?room_id=' + encodeURIComponent(CHAT_curRoom.id))
    .then(function (res) {
      var msgs = res.messages || [];
      renderMessages(msgs);
      if (CHAT_curRoom.joined !== false) {
        api.post('/chat/read', { room_id: CHAT_curRoom.id }).catch(function () {});
      }
    })
    .catch(function (err) {
      if (cont && !cont.children.length) {
        cont.innerHTML = '<div class="feed-state"><div style="font-size:2rem">⚠️</div><div>' + escHtml(err.message) + '</div></div>';
      }
    });
}

function renderMessages(msgs) {
  var cont = document.getElementById('chat-msgs');
  if (!cont) return;

  if (!msgs.length) {
    cont.innerHTML = '<div class="feed-state" style="height:100%"><div style="font-size:2.5rem">💬</div><div style="font-size:.85rem">No messages yet<br>Say hello!</div></div>';
    return;
  }

  var isGroup = CHAT_curRoom && CHAT_curRoom.type === 'group';
  var meId = STATE.user && STATE.user.id;
  var atBottom = (cont.scrollTop + cont.clientHeight >= cont.scrollHeight - 40);

  cont.innerHTML = msgs.map(function (m) {
    var isMe = m.sender_id === meId;
    var time = m.created_at ? new Date(m.created_at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
    var bubbleClass = 'bubble ' + (isMe ? 'me' : 'them');
    var inner = '';

    if (m.type === 'sticker') {
      return '<div class="msg-wrap' + (isMe ? ' me' : '') + '"><div class="bubble sticker">' + escHtml(m.text || '😊') + '</div></div>';
    }

    if (!isMe && isGroup) {
      inner += '<div class="bubble-nick">@' + escHtml(m.sender_nick || '') + '</div>';
    }

    if (m.type === 'voice') {
      var bars = '';
      for (var i = 0; i < 20; i++) bars += '<div class="vbar" style="width:3px;height:' + (4 + Math.random() * 14) + 'px"></div>';
      inner += '<div class="voice-msg"><button class="play-voice" onclick="this.textContent=this.textContent===\'▶\'?\'⏸\':\'▶\'">▶</button><div class="voice-bars">' + bars + '</div><div class="voice-dur">' + (m.text || '0:10') + '</div></div>';
    } else if (m.type === 'media' && m.media_url) {
      var isVideo = /\.(mp4|webm|mov)$/i.test(m.media_key || '');
      if (isVideo) {
        inner += '<video src="' + m.media_url + '" controls style="width:200px;border-radius:10px;display:block"></video>';
      } else {
        inner += '<img src="' + m.media_url + '" style="max-width:200px;border-radius:10px;display:block" />';
      }
      if (m.text) inner += '<div style="margin-top:.3rem">' + escHtml(m.text) + '</div>';
    } else {
      inner += '<span>' + escHtml(m.text || '') + '</span>';
    }

    var ticks = isMe ? '<span class="read-ticks">' + (m.read ? '✓✓' : '✓') + '</span>' : '';
    inner += '<div class="bubble-meta"><span class="bubble-time">' + time + '</span>' + ticks + '</div>';

    var miniAv = (!isMe && isGroup) ? '<div class="msg-mini-av">' + escHtml((m.sender_nick || '?').slice(0, 1).toUpperCase()) + '</div>' : '';

    return '<div class="msg-wrap' + (isMe ? ' me' : '') + '" data-id="' + m.id + '" oncontextmenu="event.preventDefault();showCtxMenu(event.clientX,event.clientY,\'' + m.id + '\',' + JSON.stringify(m.text || '').replace(/"/g, '&quot;') + ')">' +
      miniAv + '<div class="' + bubbleClass + '">' + inner + '</div></div>';
  }).join('');

  if (atBottom) cont.scrollTop = cont.scrollHeight;
}

// ============================================================
// SEND MESSAGE
// ============================================================
window.onChatType = function () {
  var inp = document.getElementById('chat-input');
  inp.style.height = 'auto';
  inp.style.height = Math.min(inp.scrollHeight, 100) + 'px';
  var has = (inp.value || '').trim().length > 0;
  document.getElementById('chat-send-btn').style.display = has ? 'flex' : 'none';
  document.getElementById('voice-rec-btn').style.display = has ? 'none' : 'flex';
  document.getElementById('attach-sheet').classList.remove('open');
};

window.onChatKey = function (e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMsg(); }
};

window.sendChatMsg = function () {
  var inp = document.getElementById('chat-input');
  var text = (inp.value || '').trim();
  if (!text || !CHAT_curRoom) return;

  var payload = { room_id: CHAT_curRoom.id, type: 'text', text: text };
  if (CHAT_replyTo) payload.reply_to_id = CHAT_replyTo.id;

  api.post('/chat', payload)
    .then(function () {
      inp.value = '';
      inp.style.height = 'auto';
      document.getElementById('chat-send-btn').style.display = 'none';
      document.getElementById('voice-rec-btn').style.display = 'flex';
      CHAT_replyTo = null;
      document.getElementById('reply-bar').style.display = 'none';
      loadMessages();
      loadChatRooms();
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

// ============================================================
// STICKERS
// ============================================================
var STICKERS = ['😂', '❤️', '🔥', '👑', '🎹', '✡️', '🕎', '🎉', '🙏', '😭', '💯', '🎶', '👏', '🤣', '😍', '🥰'];

window.toggleStickers = function () {
  var tray = document.getElementById('sticker-tray');
  tray.classList.toggle('open');
  if (tray.classList.contains('open') && !tray.children.length) {
    STICKERS.forEach(function (s) {
      var el = document.createElement('div');
      el.style.cssText = 'font-size:1.8rem;cursor:pointer;padding:.2rem;';
      el.textContent = s;
      el.onclick = function () {
        api.post('/chat', { room_id: CHAT_curRoom.id, type: 'sticker', text: s })
          .then(function () { loadMessages(); tray.classList.remove('open'); })
          .catch(function (err) { toast('❌ ' + err.message); });
      };
      tray.appendChild(el);
    });
  }
};

// ============================================================
// ATTACHMENTS (image / video / file -> R2 via multipart)
// ============================================================
window.toggleAttach = function () {
  document.getElementById('attach-sheet').classList.toggle('open');
};

window.triggerChatMedia = function (accept) {
  var input = document.getElementById('chat-media-input');
  input.setAttribute('accept', accept);
  input.click();
  document.getElementById('attach-sheet').classList.remove('open');
};

window.handleChatMedia = function (e) {
  var file = e.target.files[0];
  if (!file || !CHAT_curRoom) return;

  toast('📤 Uploading...');
  var form = new FormData();
  form.append('room_id', CHAT_curRoom.id);
  form.append('type', 'media');
  form.append('file', file);

  api.post('/chat', form, true)
    .then(function () { loadMessages(); loadChatRooms(); toast('✅ Sent!'); })
    .catch(function (err) { toast('❌ ' + err.message); });

  e.target.value = '';
};

// ============================================================
// VOICE (simulated recording -> sends a placeholder duration)
// ============================================================
window.startVoiceRec = function () {
  document.getElementById('attach-sheet').classList.remove('open');
  toggleVoiceRec();
};

window.toggleVoiceRec = function () {
  CHAT_isRecording = !CHAT_isRecording;
  var btn = document.getElementById('voice-rec-btn');
  btn.classList.toggle('rec', CHAT_isRecording);
  btn.textContent = CHAT_isRecording ? '⏹️' : '🎙️';

  if (!CHAT_isRecording && CHAT_curRoom) {
    var dur = '0:' + String(Math.floor(Math.random() * 40 + 5)).padStart(2, '0');
    api.post('/chat', { room_id: CHAT_curRoom.id, type: 'voice', text: dur })
      .then(function () { loadMessages(); loadChatRooms(); })
      .catch(function (err) { toast('❌ ' + err.message); });
  }
};

// ============================================================
// REPLY / CONTEXT MENU
// ============================================================
window.showCtxMenu = function (x, y, msgId, text) {
  CHAT_ctxTarget = { id: msgId, text: text };
  var m = document.getElementById('ctx-menu');
  m.classList.add('open');
  m.style.left = Math.min(x, window.innerWidth - 168) + 'px';
  m.style.top = Math.min(y, window.innerHeight - 170) + 'px';
};

window.ctxReply = function () {
  if (!CHAT_ctxTarget) return;
  CHAT_replyTo = CHAT_ctxTarget;
  document.getElementById('reply-bar').style.display = 'flex';
  document.getElementById('reply-nick').textContent = 'Replying to';
  document.getElementById('reply-snip').textContent = (CHAT_ctxTarget.text || '[media]').slice(0, 50);
  document.getElementById('chat-input').focus();
  document.getElementById('ctx-menu').classList.remove('open');
};

window.cancelReply = function () {
  CHAT_replyTo = null;
  document.getElementById('reply-bar').style.display = 'none';
};

window.ctxCopy = function () {
  if (CHAT_ctxTarget && CHAT_ctxTarget.text && navigator.clipboard) {
    navigator.clipboard.writeText(CHAT_ctxTarget.text).then(function () { toast('📋 Copied!'); });
  } else {
    toast('📋 Nothing to copy.');
  }
  document.getElementById('ctx-menu').classList.remove('open');
};

window.ctxForward = function () {
  toast('📤 Forward: coming soon');
  document.getElementById('ctx-menu').classList.remove('open');
};

window.ctxDelete = function () {
  if (!CHAT_ctxTarget) return;
  var id = CHAT_ctxTarget.id;
  api.del('/chat?id=' + encodeURIComponent(id))
    .then(function () { loadMessages(); loadChatRooms(); toast('🗑 Deleted'); })
    .catch(function (err) { toast('❌ ' + err.message); });
  document.getElementById('ctx-menu').classList.remove('open');
};

document.addEventListener('click', function (e) {
  var m = document.getElementById('ctx-menu');
  if (m && !m.contains(e.target)) m.classList.remove('open');
  var a = document.getElementById('attach-sheet');
  if (a && !a.contains(e.target) && !e.target.closest('.icon-btn')) a.classList.remove('open');
});

// ============================================================
// NEW CHAT / NEW GROUP MODALS
// ============================================================
window.openNewChatModal = function () {
  document.getElementById('new-chat-modal').classList.add('open');
  document.getElementById('new-chat-search').value = '';
  document.getElementById('user-search-results').innerHTML =
    '<div style="padding:1rem;text-align:center;font-size:.8rem;color:var(--muted)">Type a nickname to search...</div>';
};

var CHAT_searchTimer = null;
window.searchNewChatUsers = function () {
  clearTimeout(CHAT_searchTimer);
  var q = (document.getElementById('new-chat-search').value || '').trim();
  var el = document.getElementById('user-search-results');
  if (!q) {
    el.innerHTML = '<div style="padding:1rem;text-align:center;font-size:.8rem;color:var(--muted)">Type a nickname to search...</div>';
    return;
  }
  CHAT_searchTimer = setTimeout(function () {
    api.get('/users/search?q=' + encodeURIComponent(q))
      .then(function (res) {
        var users = res.users || [];
        if (!users.length) {
          el.innerHTML = '<div style="padding:1rem;text-align:center;font-size:.82rem;color:var(--muted)">No users found</div>';
          return;
        }
        el.innerHTML = users.map(function (u) {
          return '<div style="display:flex;align-items:center;gap:.6rem;padding:.65rem 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="startDM(\'' + u.id + '\')">' +
            '<div style="width:36px;height:36px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:.9rem;flex-shrink:0;border:1px solid var(--border)">' + escHtml((u.nickname || '?').slice(0, 2).toUpperCase()) + '</div>' +
            '<div style="font-size:.85rem;font-weight:700">@' + escHtml(u.nickname || '') + '</div>' +
          '</div>';
        }).join('');
      })
      .catch(function (err) { el.innerHTML = '<div style="padding:1rem;color:var(--red);font-size:.8rem">' + escHtml(err.message) + '</div>'; });
  }, 300);
};

window.startDM = function (otherUserId) {
  api.post('/chat/rooms', { type: 'private', other_user_id: otherUserId })
    .then(function (res) {
      document.getElementById('new-chat-modal').classList.remove('open');
      loadChatRooms();
      setTimeout(function () {
        api.get('/chat/rooms').then(function (r2) {
          CHAT_rooms = r2.rooms || [];
          openChatRoom(res.room_id);
        });
      }, 200);
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.openNewGroupModal = function () {
  document.getElementById('new-group-modal').classList.add('open');
  document.getElementById('new-group-name').value = '';
};

window.createNewGroup = function () {
  var name = (document.getElementById('new-group-name').value || '').trim();
  var emojiEl = document.querySelector('input[name="group-emoji"]:checked');
  var emoji = emojiEl ? emojiEl.value : '👥';
  if (!name) return toast('⚠ Enter a group name.');

  api.post('/chat/rooms', { type: 'group', name: name, emoji: emoji })
    .then(function (res) {
      document.getElementById('new-group-modal').classList.remove('open');
      toast('✅ Group created!');
      loadChatRooms();
      setTimeout(function () {
        api.get('/chat/rooms').then(function (r2) {
          CHAT_rooms = r2.rooms || [];
          openChatRoom(res.room_id);
        });
      }, 200);
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

console.log('[YID PLUS] chat.js loaded ✓');
