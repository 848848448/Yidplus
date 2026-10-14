// Prevent stale shared cache and search replies. No persistent private caching.
var _apiEpoch = 0, _apiCacheIdentity = '';
api.get = function (path, noCache) {
    var currentIdentity = STATE.user ? STATE.user.id : '';
    if (_apiCacheIdentity !== currentIdentity) { ++_apiEpoch; _apiCache = {}; _apiCacheTTL = {}; _apiInflight = {}; _apiCacheIdentity = currentIdentity; }
    var cacheKey = path;
    var now = Date.now();
    // Return cached if still fresh
    if (!noCache && _apiCache[cacheKey] && _apiCacheTTL[cacheKey] > now) {
      return Promise.resolve(_apiCache[cacheKey]);
    }
    // Dedup: if same request is already inflight, wait for it
    if (_apiInflight[cacheKey]) {
      return _apiInflight[cacheKey];
    }
    var epoch = _apiEpoch, identity = STATE.user ? STATE.user.id : '';
    var promise = fetch(CONFIG.API_BASE + path, { credentials: 'include' })
      .then(handleRes)
      .then(function (data) {
        if (epoch === _apiEpoch && identity === (STATE.user ? STATE.user.id : '')) {
          _apiCache[cacheKey] = data;
          _apiCacheTTL[cacheKey] = Date.now() + _cacheTTL(path);
        }
        if (_apiInflight[cacheKey] === promise) delete _apiInflight[cacheKey];
        return data;
      })
      .catch(function (err) {
        if (_apiInflight[cacheKey] === promise) delete _apiInflight[cacheKey];
        throw err;
      });
    _apiInflight[cacheKey] = promise;
    return promise;
  };
api.bust = function (path) {
    ++_apiEpoch;
    var base = path.split('?')[0];
    Array.from(new Set(Object.keys(_apiCache).concat(Object.keys(_apiInflight)))).forEach(function (k) {
      if (k === path || k.split('?')[0] === base) {
        delete _apiCache[k];
        delete _apiCacheTTL[k];
        delete _apiInflight[k];
      }
    });
    delete _apiInflight[path];
  };
var GSEARCH_epoch = 0;
(function () {
  var open = window.openGlobalSearch, search = window.doGlobalSearch;
  if (open) window.openGlobalSearch = function () { ++GSEARCH_epoch; return open.apply(this, arguments); };
  if (search) window.doGlobalSearch = function () { ++GSEARCH_epoch; return search.apply(this, arguments); };
})();
function _runGSearch(q) {
  var el = document.getElementById('global-search-results');
  if (!el) return;
  var epoch = GSEARCH_epoch;
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
    if (epoch !== GSEARCH_epoch || document.getElementById('global-search-results') !== el) return;
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
            ? '<span style="font-size:.68rem;color:var(--muted);margin-inline-start:auto">Joined</span>'
            : '<button onclick="event.stopPropagation();tgQuickJoin(\'' + escHtml(t.username) + '\',this)" style="margin-inline-start:auto;background:#229ED9;color:#fff;border:none;border-radius:14px;padding:.2rem .8rem;font-size:.7rem;font-weight:700;cursor:pointer">Join</button>';
          return '<div style="display:flex;align-items:center;gap:.65rem;padding:.55rem .5rem;cursor:pointer" onclick="document.getElementById(\'global-search-modal\').remove();openTelegramChannel(\'' + escHtml(t.username) + '\',\'' + escJs(t.title || t.username) + '\')">' +
            av +
            '<div style="min-width:0"><div style="font-size:.86rem;font-weight:600;unicode-bidi:plaintext;text-align:start;direction:ltr">' + escHtml(t.title || t.username) + '</div>' +
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
