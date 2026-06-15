// ============================================================
// js/chats.js  —  Chat list + Chat room + Channel screen
// ============================================================

// ── SAMPLE DATA ──────────────────────────────────────────
var CHAT_SAMPLES = [
  { id: 'c1', type: 'private', name: 'Moishe Goldberg', avatar: '👨', lastMsg: 'Gut Shabbos! 🕯️', time: '2m', unread: 2, online: true },
  { id: 'c2', type: 'private', name: 'Rivka Stern',     avatar: '👩', lastMsg: 'Did you see the new shiur?', time: '15m', unread: 0, online: false },
  { id: 'c3', type: 'group',   name: 'Yeshiva Bochurim 🎓', avatar: '🎓', lastMsg: 'Moishe: Tomorrow at 9am!', time: '1h', unread: 5, online: false },
  { id: 'c4', type: 'group',   name: 'Shul Announcements 📢', avatar: '📢', lastMsg: 'Mincha at 7:30 tonight', time: '3h', unread: 1, online: false },
  { id: 'c5', type: 'private', name: 'Shloimy Weiss',   avatar: '🧑', lastMsg: 'Check out this song!', time: '1d', unread: 0, online: true },
  { id: 'c6', type: 'group',   name: 'Family Group 👨‍👩‍👧‍👦', avatar: '👨‍👩‍👧‍👦', lastMsg: 'Shabbos by Bubby this week!', time: '2d', unread: 0, online: false },
];

var CHAT_MESSAGES = {
  c1: [
    { id: 'm1', from: 'them', nick: 'Moishe', text: 'Hey! How are you doing?', time: '10:30', read: true },
    { id: 'm2', from: 'me', text: 'Baruch Hashem, doing well! You?', time: '10:31', read: true },
    { id: 'm3', from: 'them', nick: 'Moishe', text: 'Gut Shabbos! 🕯️', time: '10:32', read: false },
  ],
  c2: [
    { id: 'm1', from: 'them', nick: 'Rivka', text: 'Did you see the new shiur from Rav Moshe?', time: '9:15', read: true },
    { id: 'm2', from: 'me', text: 'Not yet, is it good?', time: '9:20', read: true },
    { id: 'm3', from: 'them', nick: 'Rivka', text: 'Amazing! You have to listen.', time: '9:21', read: true },
  ],
  c3: [
    { id: 'm1', from: 'them', nick: 'Yankel', text: 'Who is coming to the chavrusa tomorrow?', time: '8:00', read: true },
    { id: 'm2', from: 'them', nick: 'Moishe', text: 'Tomorrow at 9am!', time: '8:05', read: false },
  ],
};

var CHAT_curRoom = null;
var CHAT_tab = 'all';
var CHAT_allChats = CHAT_SAMPLES.slice();

// ── INIT CHATS ────────────────────────────────────────────
window.init_chats = function () {
  renderChatList();
  // Mark nav active
  document.querySelectorAll('.nav-item').forEach(function (b) {
    b.classList.toggle('active', b.dataset.nav === 'chats');
  });
};

// ── RENDER CHAT LIST ──────────────────────────────────────
function renderChatList() {
  var area = document.getElementById('chat-list-area');
  if (!area) return;
  var q = (document.getElementById('chat-search') || {}).value || '';
  var list = CHAT_allChats.filter(function (c) {
    if (CHAT_tab === 'private' && c.type !== 'private') return false;
    if (CHAT_tab === 'groups' && c.type !== 'group') return false;
    if (q && c.name.toLowerCase().indexOf(q.toLowerCase()) === -1) return false;
    return true;
  });
  if (!list.length) {
    area.innerHTML = '<div class="feed-state"><div style="font-size:2rem">💬</div><div>No chats found</div></div>';
    return;
  }
  area.innerHTML = list.map(function (c) {
    return '<div class="chat-item" onclick="openChatRoom(\'' + c.id + '\')">' +
      '<div class="chat-av' + (c.type === 'group' ? ' group' : '') + '">' +
        c.avatar +
        (c.online ? '<div class="online-dot"></div>' : '') +
      '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;align-items:center;justify-content:space-between">' +
          '<div style="font-size:.88rem;font-weight:700">' + escHtml(c.name) + '</div>' +
          '<div style="font-size:.65rem;color:var(--muted2)">' + c.time + '</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:.15rem">' +
          '<div style="font-size:.75rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px">' + escHtml(c.lastMsg) + '</div>' +
          (c.unread ? '<div class="unread-badge">' + c.unread + '</div>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

// ── SWITCH CHAT TAB ───────────────────────────────────────
window.switchChatTab = function (btn, tab) {
  CHAT_tab = tab;
  document.querySelectorAll('.ctab').forEach(function (t) { t.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  renderChatList();
};

// ── FILTER CHATS ──────────────────────────────────────────
window.filterChats = function () {
  renderChatList();
};

// ── OPEN CHAT ROOM ────────────────────────────────────────
window.openChatRoom = function (chatId) {
  var chat = CHAT_allChats.find(function (c) { return c.id === chatId; });
  if (!chat) return;
  CHAT_curRoom = chat;

  // Mark unread as 0
  chat.unread = 0;

  // Set room header
  var crAvatar = document.getElementById('cr-avatar');
  var crName = document.getElementById('cr-name');
  var crStatus = document.getElementById('cr-status');
  if (crAvatar) { crAvatar.textContent = chat.avatar; crAvatar.className = 'chatroom-avatar' + (chat.type === 'group' ? ' group' : ''); }
  if (crName) crName.textContent = chat.name;
  if (crStatus) crStatus.textContent = chat.online ? '● Online' : (chat.type === 'group' ? chat.name.includes('Bochurim') ? '12 members' : '8 members' : 'Last seen recently');

  // Show/hide join banner for groups
  var joinBanner = document.getElementById('join-banner');
  if (joinBanner) joinBanner.style.display = 'none';

  // Render messages
  renderMessages(chatId);

  STATE.prevScreen = 'chats';
  navTo('chatroom');
};

// ── RENDER MESSAGES ───────────────────────────────────────
function renderMessages(chatId) {
  var area = document.getElementById('chat-msgs');
  if (!area) return;
  var msgs = CHAT_MESSAGES[chatId] || [];
  if (!msgs.length) {
    area.innerHTML = '<div class="feed-state"><div style="font-size:2rem">💬</div><div>No messages yet.<br>Say hello!</div></div>';
    return;
  }
  area.innerHTML = msgs.map(function (m) {
    var isMe = m.from === 'me';
    return '<div class="msg-wrap' + (isMe ? ' me' : '') + '">' +
      (!isMe ? '<div class="msg-av">' + (m.nick || '?').slice(0,1) + '</div>' : '') +
      '<div>' +
        (!isMe && CHAT_curRoom && CHAT_curRoom.type === 'group' ? '<div style="font-size:.65rem;color:var(--gold-d);margin-bottom:.15rem;font-weight:700">@' + escHtml(m.nick || '') + '</div>' : '') +
        '<div class="bubble ' + (isMe ? 'me' : 'them') + '">' + escHtml(m.text) + '</div>' +
        '<div class="bubble-meta">' +
          '<span class="bubble-time">' + m.time + '</span>' +
          (isMe ? '<span class="read-ticks">' + (m.read ? '✓✓' : '✓') + '</span>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
  // Scroll to bottom
  area.scrollTop = area.scrollHeight;
}

// ── SEND CHAT MESSAGE ─────────────────────────────────────
window.sendChatMsg = function () {
  if (!STATE.user) return toast('⚠ Please sign in first.');
  var input = document.getElementById('chat-input');
  if (!input) return;
  var text = (input.value || '').trim();
  if (!text) return;
  if (!CHAT_curRoom) return;

  var newMsg = { id: 'm' + Date.now(), from: 'me', text: text, time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }), read: false };
  if (!CHAT_MESSAGES[CHAT_curRoom.id]) CHAT_MESSAGES[CHAT_curRoom.id] = [];
  CHAT_MESSAGES[CHAT_curRoom.id].push(newMsg);
  CHAT_curRoom.lastMsg = text;
  input.value = '';
  renderMessages(CHAT_curRoom.id);
};

// ── CHAT KEYBOARD ─────────────────────────────────────────
window.onChatKey = function (e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMsg();
  }
};

// ── TOGGLE VOICE REC ──────────────────────────────────────
window.toggleVoiceRec = function () {
  toast('🎤 Voice recording: coming soon');
};

// ── TOGGLE STICKERS ───────────────────────────────────────
window.toggleStickers = function () {
  toast('😊 Stickers: coming soon');
};

// ── TOGGLE ATTACH ─────────────────────────────────────────
window.toggleAttach = function () {
  toast('📎 Attachments: coming soon');
};

// ── JOIN GROUP ────────────────────────────────────────────
window.joinGroup = function () {
  if (!STATE.user) return toast('⚠ Please sign in first.');
  var banner = document.getElementById('join-banner');
  if (banner) banner.style.display = 'none';
  toast('✅ Joined group!');
};

// ── OPEN DM FROM CHANNEL ──────────────────────────────────
window.openChDM = function () {
  toast('💬 Opening DM...');
};

// ── CHANNEL FUNCTIONS ─────────────────────────────────────
var CH_curChannel = null;
var CH_following = new Set();
var CH_notif = new Set();

var CHANNEL_SAMPLES = [
  { id: 'ch1', name: 'Reb Moishe Speaks', handle: '@rebmoishe', emoji: '🎤', bg: '#1a1a2e', bio: 'Daily Torah insights and Chassidus for the modern Yid.', followers: 1240, following: 85, views: '45K', shorts: 38, trending: true },
  { id: 'ch2', name: 'Yiddish Music World', handle: '@yiddishmusic', emoji: '🎵', bg: '#0d1b2a', bio: 'The best Yiddish and Jewish music, all in one place.', followers: 3820, following: 120, views: '120K', shorts: 95, trending: false },
  { id: 'ch3', name: 'Torah Tots', handle: '@torahtots', emoji: '📚', bg: '#1b2838', bio: 'Fun Torah learning for kids and families!', followers: 780, following: 42, views: '22K', shorts: 24, trending: false },
];

window.init_channel = function (channelId) {
  var ch = CHANNEL_SAMPLES.find(function (c) { return c.id === channelId; }) || CHANNEL_SAMPLES[0];
  CH_curChannel = ch;

  var cover = document.getElementById('ch-cover');
  var coverEmoji = document.getElementById('ch-cover-emoji');
  var avatarBig = document.getElementById('ch-avatar-big');
  var name = document.getElementById('ch-name');
  var handle = document.getElementById('ch-handle');
  var bio = document.getElementById('ch-bio');
  var followers = document.getElementById('ch-followers');
  var following = document.getElementById('ch-following');
  var views = document.getElementById('ch-views');
  var shortsCt = document.getElementById('ch-shorts-ct');
  var followBtn = document.getElementById('ch-follow-btn');
  var notifBtn = document.getElementById('ch-notif-btn');

  if (cover) cover.style.background = ch.bg;
  if (coverEmoji) coverEmoji.textContent = ch.emoji;
  if (avatarBig) avatarBig.textContent = ch.emoji;
  if (name) name.textContent = ch.name;
  if (handle) handle.textContent = ch.handle;
  if (bio) bio.textContent = ch.bio;
  if (followers) followers.textContent = fmtN(ch.followers);
  if (following) following.textContent = fmtN(ch.following);
  if (views) views.textContent = ch.views;
  if (shortsCt) shortsCt.textContent = ch.shorts;

  var isFollowing = CH_following.has(ch.id);
  if (followBtn) {
    followBtn.textContent = isFollowing ? '✓ Following' : '+ Follow';
    followBtn.style.background = isFollowing ? 'var(--bg3)' : '#000';
    followBtn.style.color = isFollowing ? 'var(--text)' : '#fff';
    followBtn.style.border = isFollowing ? '1px solid var(--border)' : 'none';
  }
  if (notifBtn) notifBtn.textContent = CH_notif.has(ch.id) ? '🔔' : '🔕';

  // Build shorts grid
  var grid = document.getElementById('ch-grid');
  if (grid) {
    var shorts = [];
    for (var i = 0; i < ch.shorts; i++) {
      shorts.push('<div class="grid-short" onclick="navTo(\'shorts\')">' +
        '<div style="font-size:3rem">' + ch.emoji + '</div>' +
        '<div style="position:absolute;bottom:4px;left:4px;font-size:.6rem;color:rgba(255,255,255,.8);background:rgba(0,0,0,.5);padding:.1rem .3rem;border-radius:4px">' + (Math.floor(Math.random()*50)+1) + 'K</div>' +
      '</div>');
    }
    grid.innerHTML = shorts.slice(0, 12).join('');
  }

  // Build music list
  var musicList = document.getElementById('ch-music-list');
  if (musicList) {
    musicList.innerHTML = '<div class="feed-state"><div style="font-size:2rem">🎵</div><div>No music uploaded yet</div></div>';
  }

  // Build about
  var aboutContent = document.getElementById('ch-about-content');
  if (aboutContent) {
    aboutContent.innerHTML =
      '<div style="font-size:.85rem;line-height:1.7;color:var(--text)">' + escHtml(ch.bio) + '</div>' +
      '<div style="margin-top:1rem;font-size:.78rem;color:var(--muted)">📅 Joined 2024 &nbsp;·&nbsp; 🌍 Brooklyn, NY</div>';
  }
};

window.toggleChFollow = function () {
  if (!STATE.user) return toast('⚠ Please sign in first.');
  if (!CH_curChannel) return;
  if (CH_following.has(CH_curChannel.id)) {
    CH_following.delete(CH_curChannel.id);
    toast('Unfollowed ' + CH_curChannel.name);
  } else {
    CH_following.add(CH_curChannel.id);
    toast('✅ Following ' + CH_curChannel.name);
  }
  init_channel(CH_curChannel.id);
};

window.toggleChNotif = function () {
  if (!CH_curChannel) return;
  if (CH_notif.has(CH_curChannel.id)) {
    CH_notif.delete(CH_curChannel.id);
    toast('🔕 Notifications off');
  } else {
    CH_notif.add(CH_curChannel.id);
    toast('🔔 Notifications on');
  }
  var btn = document.getElementById('ch-notif-btn');
  if (btn) btn.textContent = CH_notif.has(CH_curChannel.id) ? '🔔' : '🔕';
};

window.switchChTab = function (btn, tab) {
  document.querySelectorAll('.chtab').forEach(function (t) { t.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  var shortsTab = document.getElementById('ch-shorts-tab');
  var musicTab = document.getElementById('ch-music-tab');
  var aboutTab = document.getElementById('ch-about-tab');
  if (shortsTab) shortsTab.style.display = tab === 'shorts' ? 'block' : 'none';
  if (musicTab) musicTab.style.display = tab === 'music' ? 'block' : 'none';
  if (aboutTab) aboutTab.style.display = tab === 'about' ? 'block' : 'none';
};

window.shareChannel = function () {
  if (CH_curChannel) toast('🔗 Link copied: yidplus.com/channel/' + CH_curChannel.id);
};

// ── OPEN CHANNEL (called from home.js) ───────────────────
window.openChannel = function (channelId) {
  STATE.prevScreen = STATE.curScreen || 'home';
  init_channel(channelId || 'ch1');
  navTo('channel');
};

console.log('[YID PLUS] chats.js loaded ✓');
