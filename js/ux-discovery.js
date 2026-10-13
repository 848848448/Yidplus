// Guest discovery and privacy-aware channel previews.
function _doExploreSearch(q) {
  var body = document.getElementById('explore-body');
  if (!body) return;
  body.innerHTML = '<div style="padding:2rem;text-align:center"><div class="spinner"></div></div>';

  api.get('/channels?search=' + encodeURIComponent(q), true).catch(function(){ return { channels: [] }; })
    .then(function (res) {
      var channels = res.channels || [];
      if (!channels.length) {
        body.innerHTML = '<div style="padding:3rem;text-align:center;color:var(--muted);font-size:.88rem">No channels for "' + escHtml(q) + '"</div>';
        return;
      }
      _renderExploreDirectory(body, channels);
    });
}

function _loadExploreAll() {
  var body = document.getElementById('explore-body');
  if (!body) return;
  body.innerHTML = '<div style="padding:2rem;text-align:center"><div class="spinner"></div></div>';

  (window.FeatureBlock ? FeatureBlock.check('channels') : Promise.resolve(null)).then(function (channelsBlock) {
    if (channelsBlock) {
      FeatureBlock.renderBlockedScreen(body, 'channels', channelsBlock);
      return;
    }
    api.get('/channels?limit=5000', true).catch(function(){ return { channels: [] }; }).then(function (res) {
      var channels = res.channels || [];
      if (!channels.length) {
        body.innerHTML = '<div style="padding:3.5rem 1.5rem;text-align:center;color:var(--muted)">' +
          '<div style="font-size:2.5rem;margin-bottom:.5rem">📡</div>' +
          '<div style="font-weight:700;font-size:.95rem;margin-bottom:.2rem">No channels yet</div>' +
          '<div style="font-size:.8rem">Channels will appear here once they\'re created.</div>' +
        '</div>';
        return;
      }
      _renderExploreDirectory(body, channels);
    });
  });
}

var EXPLORE_filter = 'all';
var EXPLORE_results = [];
window.filterExploreDirectory = function (value) { EXPLORE_filter = value; _renderExploreDirectory(document.getElementById('explore-body'), EXPLORE_results); };
function _renderExploreDirectory(body, channels) {
  EXPLORE_results = channels;
  var active = channels.filter(function (c) { return !!c.last_post_at; }).sort(function (a,b) { return String(b.last_post_at).localeCompare(String(a.last_post_at)); });
  var intro = !STATE.user ? '<section class="discover-welcome"><h2>' + 'Welcome to YID PLUS' + '</h2><p>' + 'Discover channels, watch Shorts and stay in touch with your community.' + '</p><button class="btn-primary" onclick="_guestGoSignIn()">' + 'Sign In' + '</button></section>' : '';
  var filters = '<div class="discover-filters" aria-label="' + 'Channel filters' + '">' + [['all','All channels'],['active','Recently active'],['popular','Popular']].map(function (item) { return '<button aria-pressed="' + (EXPLORE_filter === item[0]) + '" onclick="filterExploreDirectory(\'' + item[0] + '\')">' + item[1] + '</button>'; }).join('') + '</div>';
  var shown = EXPLORE_filter === 'active' ? active : EXPLORE_filter === 'popular' ? channels.slice().sort(function (a,b) { return (b.followers||0)-(a.followers||0); }) : channels;
  body.innerHTML = intro + filters + (active.length && EXPLORE_filter === 'all' ? _exploreSection('Recently active', active.slice(0,4).map(_channelRow).join('')) : '') + _exploreSection((EXPLORE_filter === 'active' ? 'Recently active' : EXPLORE_filter === 'popular' ? 'Popular' : 'All channels'), shown.map(_channelRow).join('') || '<p class="channel-description" style="padding:1rem">' + 'No recent posts yet' + '</p>');
  // Use the existing privacy-aware channel endpoint. No schema changes or
  // inferred topics: only show descriptions supplied by the owner.
  var previewChannels = active.slice(0,4).concat(channels.slice(0,4)).filter(function (c,i,all) { return all.findIndex(function (x) { return x.owner_id === c.owner_id; }) === i; });
  previewChannels.forEach(function (c) {
    api.get('/channels?owner_id=' + encodeURIComponent(c.owner_id), true).then(function (res) {
      if (res.locked || !res.wall || !res.wall.length) return;
      var item = res.wall[0];
      var text = item.caption || item.content || 'New media post';
      body.querySelectorAll('[data-channel-preview]').forEach(function (el) {
        if (el.getAttribute('data-channel-preview') === String(c.owner_id)) el.textContent = 'Latest post' + ': ' + String(text).slice(0,140);
      });
    }).catch(function () {});
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
  var name = escHtml(c.nickname || 'Channel');
  // New-post indicator: show a dot when the channel's latest post is newer than
  // the last time this user opened that channel.
  var seen = '';
  try { seen = localStorage.getItem('yp_ch_seen_' + c.owner_id) || ''; } catch (e) {}
  var hasNew = c.last_post_at && (!seen || c.last_post_at > seen);
  var ring = hasNew ? ';box-shadow:0 0 0 2px var(--surface),0 0 0 4px #1F6F5C' : '';
  var av = c.photo_url
    ? '<div style="width:54px;height:54px;border-radius:50%;background-image:url(' + c.photo_url + ');background-size:cover;background-position:center;flex-shrink:0;border:1px solid var(--border)' + ring + '"></div>'
    : '<div style="width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,var(--gold),var(--gold-l));display:flex;align-items:center;justify-content:center;font-size:1.25rem;font-weight:800;color:#fff;flex-shrink:0' + ring + '">' + (c.nickname || 'C').slice(0, 1).toUpperCase() + '</div>';
  var verified = c.verified
    ? ' <svg width="14" height="14" viewBox="0 0 24 24" fill="#1d9bf0" style="vertical-align:-2px;flex-shrink:0"><path d="M12 2l2.4 2.4 3.3-.6.6 3.3L21 12l-2.7 2.4.6 3.3-3.3.6L12 22l-2.4-2.7-3.3.6-.6-3.3L3 12l2.7-2.4-.6-3.3 3.3.6z"/><path d="M10.5 14.5l-2-2 1-1 1 1 3-3 1 1z" fill="#fff"/></svg>'
    : '';
  var sub = c.bio
    ? escHtml(c.bio)
    : 'Community channel';
  var newBadge = hasNew ? '<span style="background:#1F6F5C;color:#fff;font-size:.62rem;font-weight:800;padding:.1rem .4rem;border-radius:8px;flex-shrink:0">' + 'NEW' + '</span>' : '';
  var seenSet = c.last_post_at ? ("try{localStorage.setItem('yp_ch_seen_' + '" + c.owner_id + "', '" + c.last_post_at + "')}catch(e){};") : '';
  return '<div style="display:flex;align-items:center;gap:.8rem;padding:.6rem 1rem;cursor:pointer" onclick="' + seenSet + 'CHANNEL_pendingOwnerId=\'' + c.owner_id + '\';navTo(\'channel\')">' +
    av +
    '<div style="flex:1;min-width:0">' +
      '<div style="font-size:.92rem;font-weight:' + (hasNew ? '800' : '600') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;unicode-bidi:plaintext;display:flex;align-items:center;gap:.3rem">' + name + verified + newBadge + '</div>' +
      '<div class="channel-description" dir="auto">' + sub + '</div>' +
      '<div class="channel-meta">' + fmtN(c.followers || 0) + ' ' + 'followers' + '</div>' +
      '<div class="channel-preview" dir="auto" data-channel-preview="' + escHtml(c.owner_id) + '"></div>' +
    '</div>' +
  '</div>';
}
