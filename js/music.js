// ============================================================
// js/music.js — Music library + full player (Cloudflare D1 + R2)
// Real upload pipeline: POST /api/music (multipart audio/video/cover)
// Likes synced server-side via /api/music PUT.
// Screens: #screen-music, #screen-player, #mini-player
// ============================================================

var MUSIC_allTracks = [];   // flat list of all tracks from /api/music
var MUSIC_albums    = [];   // grouped by album_id
var MUSIC_singles    = [];  // type === 'single'
var MUSIC_mvs        = [];  // tracks that have a video_key

var MUSIC_curTrack = null, MUSIC_curIdx = 0, MUSIC_playing = false, MUSIC_prog = 0, MUSIC_totalSec = 0;
var MUSIC_shuffle = false, MUSIC_repeat = false, MUSIC_mode = 'song', MUSIC_curAlbum = null;
var MUSIC_audioEl = null; // real <audio> element driving playback

// ============================================================
// LOAD FROM BACKEND
// ============================================================
window.init_music = function () {
  var scroll = document.getElementById('music-scroll');
  if (window.FeatureBlock && scroll) {
    FeatureBlock.guard('music', scroll).then(function (blocked) {
      if (!blocked) loadMusicLibrary();
    });
  } else {
    loadMusicLibrary();
  }
};

function loadMusicLibrary() {
  var scroll = document.getElementById('music-scroll');
  if (scroll) {
    document.getElementById('sec-albums').style.opacity = '.4';
    document.getElementById('sec-singles').innerHTML = document.getElementById('sec-singles').innerHTML; // no-op, keep structure
  }

  api.get('/music')
    .then(function (res) {
      MUSIC_allTracks = res.tracks || [];
      _bucketTracks();
      buildAlbums();
      buildTracks('singles-list', MUSIC_singles);
      buildMVs();
      buildLiked();
      if (document.getElementById('sec-albums')) document.getElementById('sec-albums').style.opacity = '1';
    })
    .catch(function (err) {
      var el = document.getElementById('singles-list');
      if (el) el.innerHTML = '<div class="feed-state"><div style="font-size:2rem">⚠️</div><div>Could not load music</div><div style="font-size:.75rem">' + escHtml(err.message) + '</div></div>';
    });
}
window.loadMusicLibrary = loadMusicLibrary;

function _bucketTracks() {
  MUSIC_singles = MUSIC_allTracks.filter(function (t) { return t.type === 'single'; });
  MUSIC_mvs     = MUSIC_allTracks.filter(function (t) { return !!t.video_url; });

  var albumMap = {};
  MUSIC_allTracks.forEach(function (t) {
    if (t.type === 'album_track' && t.album_id) {
      if (!albumMap[t.album_id]) {
        albumMap[t.album_id] = { id: t.album_id, name: t.album_name || 'Album', artist: t.artist, tracks: [] };
      }
      albumMap[t.album_id].tracks.push(t);
    }
  });
  MUSIC_albums = Object.values(albumMap);
}

function _durationLabel(sec) {
  sec = sec || 0;
  return Math.floor(sec / 60) + ':' + String(Math.floor(sec % 60)).padStart(2, '0');
}

// ============================================================
// BUILD ALBUMS
// ============================================================
function buildAlbums() {
  var r = document.getElementById('albums-row');
  if (!r) return;
  if (!MUSIC_albums.length) {
    r.innerHTML = '<div style="padding:.5rem 1rem;font-size:.78rem;color:var(--muted)">No albums yet — uploads with an album name will appear here.</div>';
    return;
  }
  r.innerHTML = MUSIC_albums.map(function (a) {
    var emoji = '💿';
    var cover = a.tracks[0] && a.tracks[0].cover_url;
    return '<div class="album-card" onclick="openAlbum(\'' + a.id + '\')">' +
      '<div class="album-cover" style="background:var(--bg3)">' +
        (cover ? '<img src="' + cover + '" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">' : '<div class="album-cover-emoji">' + emoji + '</div>') +
      '</div>' +
      '<div class="album-name">' + escHtml(a.name) + '</div>' +
      '<div class="album-artist">' + escHtml(a.artist) + '</div>' +
      '<div class="album-tracks">' + a.tracks.length + ' tracks</div>' +
    '</div>';
  }).join('');
}

// ============================================================
// BUILD TRACK LIST
// ============================================================
function buildTracks(elId, list) {
  var el = document.getElementById(elId);
  if (!el) return;

  if (!list.length) {
    el.innerHTML = '<div style="padding:1rem;text-align:center;font-size:.8rem;color:var(--muted)">No tracks yet</div>';
    return;
  }

  el.innerHTML = list.map(function (t) {
    var isPlaying = MUSIC_curTrack && MUSIC_curTrack.id === t.id && MUSIC_playing;
    var liked = !!t.liked;
    var emoji = t.video_url ? '🎬' : '🎵';
    var canDelete = STATE.user && (STATE.user.id === t.owner_id || isAnyAdmin());
    var deleteBtn = canDelete
      ? '<div class="track-more" onclick="event.stopPropagation();deleteTrack(\'' + t.id + '\')" title="Delete"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></div>'
      : '';
    return '<div class="track-item" onclick="playTrack(\'' + t.id + '\')">' +
      '<div class="track-thumb" style="background:var(--bg3)">' +
        (t.cover_url ? '<img src="' + t.cover_url + '" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">' : '<div class="track-thumb-emoji">' + emoji + '</div>') +
        (isPlaying ? '<div class="playing-bars"><div class="pbar"></div><div class="pbar"></div><div class="pbar"></div></div>' : '') +
      '</div>' +
      '<div class="track-info">' +
        '<div class="track-name' + (isPlaying ? ' playing' : '') + '">' + escHtml(t.title) + (t.trending ? '<span class="trending-badge">⭐ Trending</span>' : '') + '</div>' +
        '<div class="track-artist">' + escHtml(t.artist) + (t.video_url ? ' · 🎬' : '') + '</div>' +
      '</div>' +
      '<div class="track-dur">' + _durationLabel(t.duration_sec) + '</div>' +
      '<div class="track-heart" onclick="event.stopPropagation();heartTrack(\'' + t.id + '\')">' + (liked ? '❤️' : '🤍') + '</div>' +
      '<div class="track-more" onclick="event.stopPropagation();shareTrackById(\'' + t.id + '\')">📤</div>' +
      deleteBtn +
    '</div>';
  }).join('');
}

// ============================================================
// BUILD MVS
// ============================================================
function buildMVs() {
  var r = document.getElementById('mv-row');
  if (!r) return;
  if (!MUSIC_mvs.length) {
    r.innerHTML = '<div style="padding:.5rem 1rem;font-size:.78rem;color:var(--muted)">No music videos yet</div>';
    return;
  }
  r.innerHTML = MUSIC_mvs.map(function (mv) {
    return '<div class="mv-card" onclick="playTrack(\'' + mv.id + '\');setPlayerMode(\'video\')">' +
      '<div class="mv-thumb">' +
        (mv.cover_url ? '<img src="' + mv.cover_url + '" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">' : '🎬') +
        '<div class="mv-play"><div class="mv-play-icon">▶</div></div>' +
      '</div>' +
      '<div class="mv-name">' + escHtml(mv.title) + '</div>' +
      '<div class="mv-artist">' + escHtml(mv.artist) + ' · ▶ ' + fmtN(mv.plays || 0) + '</div>' +
    '</div>';
  }).join('');
}

// ============================================================
// LIKED
// ============================================================
function buildLiked() {
  buildTracks('liked-list', MUSIC_allTracks.filter(function (t) { return t.liked; }));
}

window.openLikedSongs = function () {
  var tabs = document.querySelectorAll('.mtab');
  document.querySelectorAll('.mtab').forEach(function (t) { t.classList.remove('active'); });
  switchMusicTab(tabs[tabs.length - 1] || null, 'liked');
};

// ============================================================
// SEARCH — the header search icon called this but it was never
// implemented, so it silently did nothing on every tap.
// ============================================================
window.openMusicSearch = function () {
  var existing = document.getElementById('music-search-modal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'music-search-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:8000;background:var(--surface);display:flex;flex-direction:column';
  modal.innerHTML =
    '<div style="display:flex;align-items:center;gap:.5rem;padding:.6rem .75rem;border-bottom:1px solid var(--border);flex-shrink:0">' +
      '<button onclick="document.getElementById(\'music-search-modal\').remove()" style="background:none;border:none;cursor:pointer;color:var(--text);padding:.3rem;display:flex">' +
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>' +
      '</button>' +
      '<div style="flex:1;background:var(--bg3);border-radius:10px;display:flex;align-items:center;gap:.4rem;padding:.4rem .75rem">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
        '<input id="music-search-inp" placeholder="Search songs, artists..." oninput="doMusicSearch()" style="flex:1;background:none;border:none;outline:none;font-size:.9rem;color:var(--text);font-family:inherit">' +
      '</div>' +
    '</div>' +
    '<div id="music-search-results" style="flex:1;overflow-y:auto;padding:.5rem">' +
      '<div style="text-align:center;padding:3rem 1rem;color:var(--muted);font-size:.85rem">Type to search your music library</div>' +
    '</div>';
  document.body.appendChild(modal);
  setTimeout(function () { var i = document.getElementById('music-search-inp'); if (i) i.focus(); }, 100);
};

window.doMusicSearch = function () {
  var q = (document.getElementById('music-search-inp') || {}).value || '';
  q = q.trim().toLowerCase();
  var el = document.getElementById('music-search-results');
  if (!el) return;
  if (q.length < 1) {
    el.innerHTML = '<div style="text-align:center;padding:3rem 1rem;color:var(--muted);font-size:.85rem">Type to search your music library</div>';
    return;
  }
  var matches = MUSIC_allTracks.filter(function (t) {
    return (t.title && t.title.toLowerCase().indexOf(q) !== -1) ||
           (t.artist && t.artist.toLowerCase().indexOf(q) !== -1);
  });
  if (!matches.length) {
    el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--muted);font-size:.85rem">No results found</div>';
    return;
  }
  el.innerHTML = matches.map(function (t) {
    var cover = t.cover_url
      ? 'background-image:url(\'' + t.cover_url + '\');background-size:cover;background-position:center'
      : 'background:var(--bg3)';
    return '<div style="display:flex;align-items:center;gap:.65rem;padding:.55rem .5rem;cursor:pointer" onclick="document.getElementById(\'music-search-modal\').remove();playTrack(\'' + t.id + '\')">' +
      '<div style="width:42px;height:42px;border-radius:8px;flex-shrink:0;' + cover + '"></div>' +
      '<div style="min-width:0">' +
        '<div style="font-size:.86rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(t.title || 'Untitled') + '</div>' +
        '<div style="font-size:.74rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(t.artist || '') + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
};

window.deleteTrack = function (trackId) {
  if (!confirm('Delete this track? This cannot be undone.')) return;
  api.del('/music?id=' + encodeURIComponent(trackId))
    .then(function () {
      toast('🗑 Track deleted');
      MUSIC_allTracks = MUSIC_allTracks.filter(function (t) { return t.id !== trackId; });
      MUSIC_albums = MUSIC_albums.filter(function (t) { return t.id !== trackId; });
      MUSIC_singles = MUSIC_singles.filter(function (t) { return t.id !== trackId; });
      MUSIC_mvs = MUSIC_mvs.filter(function (t) { return t.id !== trackId; });
      buildAlbums();
      buildTracks('singles-list', MUSIC_singles);
      buildMVs();
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

window.switchMusicTab = function (btn, tab) {
  document.querySelectorAll('.mtab').forEach(function (t) { t.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  document.getElementById('sec-albums').style.display = (tab === 'all' || tab === 'albums') ? 'block' : 'none';
  document.getElementById('sec-singles').style.display = (tab === 'all' || tab === 'singles') ? 'block' : 'none';
  document.getElementById('sec-videos').style.display = (tab === 'all' || tab === 'videos') ? 'block' : 'none';
  document.getElementById('sec-liked').style.display = (tab === 'liked') ? 'block' : 'none';
  if (tab === 'liked') buildLiked();
};

// ============================================================
// PLAY TRACK — real <audio>/<video> playback from R2
// ============================================================
window.toggleCurrentTrackSave = function () {
  if (!STATE.user) return toast('⚠ Please sign in first.');
  if (!MUSIC_curTrack) return;
  var t = MUSIC_curTrack;
  var newSaved = !t.saved;
  var req = newSaved
    ? api.post('/saves', { item_type: 'music', item_id: t.id })
    : api.del('/saves?item_type=music&item_id=' + encodeURIComponent(t.id));
  req.then(function () {
    t.saved = newSaved;
    _syncPlayerSaveButton();
    toast(newSaved ? '🔖 Saved!' : 'Removed from saved');
  }).catch(function (err) { toast('❌ ' + err.message); });
};

function _syncPlayerSaveButton() {
  var icon = document.getElementById('player-save-icon');
  if (!icon || !MUSIC_curTrack) return;
  // filled bookmark when saved, outline when not
  icon.setAttribute('fill', MUSIC_curTrack.saved ? 'currentColor' : 'none');
}

window.playTrack = function (trackId) {
  var t = MUSIC_allTracks.find(function (x) { return x.id === trackId; });
  if (!t) return;

  MUSIC_curTrack = t;
  MUSIC_curIdx = MUSIC_allTracks.findIndex(function (x) { return x.id === t.id; });
  MUSIC_playing = true;
  MUSIC_prog = 0;

  // Set up real audio element
  if (!MUSIC_audioEl) {
    MUSIC_audioEl = new Audio();
    MUSIC_audioEl.addEventListener('timeupdate', _onAudioTick);
    MUSIC_audioEl.addEventListener('ended', function () { nextTrack(); });
    MUSIC_audioEl.addEventListener('loadedmetadata', function () {
      MUSIC_totalSec = MUSIC_audioEl.duration || 0;
      var totEl = document.getElementById('t-tot');
      if (totEl) totEl.textContent = _durationLabel(MUSIC_totalSec);
    });
  }
  MUSIC_audioEl.src = t.audio_url || '';
  MUSIC_audioEl.play().catch(function () {});

  // Track play count (fire and forget)
  api.put('/music', { id: t.id, play: true }).catch(function () {});

  _syncPlayerSaveButton();

  var nameEl = document.getElementById('player-name');
  var artistEl = document.getElementById('player-artist');
  var artworkEmoji = document.getElementById('artwork-emoji');
  var artworkBg = document.getElementById('artwork-bg');
  if (nameEl) nameEl.textContent = t.title;
  if (artistEl) artistEl.textContent = t.artist;
  if (artworkEmoji) artworkEmoji.textContent = t.video_url ? '🎬' : '🎵';
  if (artworkBg) artworkBg.textContent = t.video_url ? '🎬' : '🎵';
  var artworkEl = document.getElementById('artwork');
  if (artworkEl) {
    artworkEl.style.background = 'var(--bg3)';
    artworkEl.classList.add('playing');
    var existingImg = artworkEl.querySelector('img');
    if (existingImg) existingImg.remove();
    if (t.cover_url) {
      var img = document.createElement('img');
      img.src = t.cover_url;
      img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0';
      artworkEl.insertBefore(img, artworkEl.firstChild);
    }
  }

  var vpEmoji = document.getElementById('vp-emoji');
  if (vpEmoji) vpEmoji.textContent = t.title;

  var heartBig = document.getElementById('heart-big');
  if (heartBig) heartBig.textContent = t.liked ? '❤️' : '🤍';

  var miniThumb = document.getElementById('mini-thumb');
  var miniName  = document.getElementById('mini-name');
  var miniArtist = document.getElementById('mini-artist');
  if (miniThumb) miniThumb.textContent = t.video_url ? '🎬' : '🎵';
  if (miniName) miniName.textContent = t.title;
  if (miniArtist) miniArtist.textContent = t.artist;
  var miniPlayer = document.getElementById('mini-player');
  if (miniPlayer) miniPlayer.classList.add('show');

  setPlayBtn('⏸');
  buildQueue();
  buildTracks('singles-list', MUSIC_singles);
  buildLiked();

  setPlayerMode(t.video_url ? MUSIC_mode : 'song');

  // Hook video element if in video mode
  _syncVideoElement(t);

  navTo('player');
};

function _syncVideoElement(t) {
  var vidWrap = document.getElementById('vid-player-wrap');
  if (!vidWrap) return;
  var existingVideo = vidWrap.querySelector('video');
  if (existingVideo) existingVideo.remove();

  if (t.video_url) {
    var vid = document.createElement('video');
    vid.src = t.video_url;
    vid.style.cssText = 'width:100%;height:100%;object-fit:cover;position:absolute;inset:0';
    vid.muted = true; // audio plays through the separate <audio> element to keep sync simple
    vidWrap.querySelector('div').insertBefore(vid, vidWrap.querySelector('div').firstChild);
    if (MUSIC_playing) vid.play().catch(function () {});
  }
}

function _onAudioTick() {
  if (!MUSIC_audioEl || !MUSIC_totalSec) return;
  MUSIC_prog = MUSIC_audioEl.currentTime / MUSIC_totalSec;
  var pct = (MUSIC_prog * 100).toFixed(2) + '%';
  var fill = document.getElementById('prog-fill');
  var dot = document.getElementById('prog-dot');
  var miniProg = document.getElementById('mini-prog');
  if (fill) fill.style.width = pct;
  if (dot) dot.style.left = pct;
  if (miniProg) miniProg.style.width = pct;
  var tcur = document.getElementById('t-cur');
  if (tcur) tcur.textContent = _durationLabel(MUSIC_audioEl.currentTime);
}

window.togglePlay = function () {
  if (!MUSIC_audioEl) return;
  MUSIC_playing = !MUSIC_playing;
  if (MUSIC_playing) MUSIC_audioEl.play().catch(function () {});
  else MUSIC_audioEl.pause();
  setPlayBtn(MUSIC_playing ? '⏸' : '▶');
  var artworkEl = document.getElementById('artwork');
  if (artworkEl) artworkEl.classList.toggle('playing', MUSIC_playing);
  var vid = document.querySelector('#vid-player-wrap video');
  if (vid) { if (MUSIC_playing) vid.play().catch(function(){}); else vid.pause(); }
};

function setPlayBtn(ic) {
  var big = document.getElementById('play-big-btn');
  var mini = document.getElementById('mini-play-btn');
  var vp = document.getElementById('vp-btn');
  if (big) big.textContent = ic;
  if (mini) mini.textContent = ic;
  if (vp) vp.textContent = ic;
}

window.nextTrack = function () {
  if (!MUSIC_allTracks.length) return;
  var ni = MUSIC_shuffle ? Math.floor(Math.random() * MUSIC_allTracks.length) : MUSIC_curIdx + 1;
  if (ni < MUSIC_allTracks.length) playTrack(MUSIC_allTracks[ni].id);
  else if (MUSIC_repeat) playTrack(MUSIC_allTracks[0].id);
  else { MUSIC_playing = false; setPlayBtn('▶'); }
};
window.prevTrack = function () {
  if (MUSIC_curIdx > 0) playTrack(MUSIC_allTracks[MUSIC_curIdx - 1].id);
};
window.toggleShuffle = function () {
  MUSIC_shuffle = !MUSIC_shuffle;
  var btn = document.getElementById('shuf-btn');
  if (btn) btn.classList.toggle('on', MUSIC_shuffle);
};
window.toggleRepeat = function () {
  MUSIC_repeat = !MUSIC_repeat;
  var btn = document.getElementById('rep-btn');
  if (btn) btn.classList.toggle('on', MUSIC_repeat);
};
window.seekTo = function (e) {
  if (!MUSIC_audioEl || !MUSIC_totalSec) return;
  var b = document.getElementById('prog-bar');
  var r = b.getBoundingClientRect();
  var pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  MUSIC_audioEl.currentTime = pct * MUSIC_totalSec;
};

window.toggleLike = function () {
  if (!MUSIC_curTrack) return;
  heartTrack(MUSIC_curTrack.id);
  var heartBig = document.getElementById('heart-big');
  if (heartBig) heartBig.textContent = MUSIC_curTrack.liked ? '❤️' : '🤍';
};

window.heartTrack = function (id) {
  if (!STATE.user) return toast('⚠ Please sign in first.');
  var t = MUSIC_allTracks.find(function (x) { return x.id === id; });
  if (!t) return;
  t.liked = !t.liked;

  api.put('/music', { id: id, like: t.liked }).catch(function (err) {
    t.liked = !t.liked; // revert on failure
    toast('❌ ' + err.message);
  });

  buildTracks('singles-list', MUSIC_singles);
  buildLiked();
  if (MUSIC_curTrack && MUSIC_curTrack.id === id) {
    var heartBig = document.getElementById('heart-big');
    if (heartBig) heartBig.textContent = t.liked ? '❤️' : '🤍';
  }
};

window.shareTrack = function () {
  if (MUSIC_curTrack) toast('🔗 Link copied: yidplus.com/music/' + MUSIC_curTrack.id);
};
window.shareTrackById = function (id) {
  toast('🔗 Link copied: yidplus.com/music/' + id);
};

// ============================================================
// MODE (song / video)
// ============================================================
window.setPlayerMode = function (m) {
  MUSIC_mode = m;
  var songBtn = document.getElementById('song-mode-btn');
  var vidBtn = document.getElementById('video-mode-btn');
  var artworkWrap = document.getElementById('artwork-wrap');
  var vidWrap = document.getElementById('vid-player-wrap');
  if (songBtn) songBtn.classList.toggle('active', m === 'song');
  if (vidBtn) vidBtn.classList.toggle('active', m === 'video');
  if (artworkWrap) artworkWrap.style.display = (m === 'song') ? 'block' : 'none';
  if (vidWrap) vidWrap.style.display = (m === 'video') ? 'block' : 'none';
};

// ============================================================
// QUEUE
// ============================================================
function buildQueue() {
  var ql = document.getElementById('queue-list');
  if (!ql) return;
  var upcoming = MUSIC_allTracks.slice(MUSIC_curIdx + 1, MUSIC_curIdx + 6);
  if (!upcoming.length) { ql.innerHTML = '<div style="font-size:.75rem;color:var(--muted);padding:.5rem 0">End of queue</div>'; return; }
  ql.innerHTML = upcoming.map(function (t, i) {
    return '<div class="queue-item" onclick="playTrack(\'' + t.id + '\')">' +
      '<div class="queue-num">' + (i + 1) + '</div>' +
      '<div class="queue-thumb">' + (t.video_url ? '🎬' : '🎵') + '</div>' +
      '<div class="queue-info"><div class="queue-name">' + escHtml(t.title) + '</div><div class="queue-artist">' + escHtml(t.artist) + '</div></div>' +
      '<div style="font-size:.68rem;color:var(--muted2)">' + _durationLabel(t.duration_sec) + '</div>' +
    '</div>';
  }).join('');
}

// ============================================================
// ALBUM DETAIL
// ============================================================
window.openAlbum = function (albumId) {
  var a = MUSIC_albums.find(function (x) { return x.id === albumId; });
  if (!a) return;
  MUSIC_curAlbum = a;

  var existing = document.getElementById('screen-album');
  if (!existing) {
    existing = document.createElement('div');
    existing.className = 'screen';
    existing.id = 'screen-album';
    existing.innerHTML =
      '<div class="album-topbar"><div class="album-back" onclick="closeAlbum()">‹</div><div style="font-size:.85rem;font-weight:700" id="alb-screen-title">Album</div></div>' +
      '<div class="scroll-area" style="padding-bottom:150px">' +
        '<div class="album-hero">' +
          '<div class="album-hero-art" id="alb-art">💿</div>' +
          '<div><div class="album-hero-label">Album</div><div class="album-hero-name" id="alb-name"></div><div class="album-hero-artist" id="alb-artist"></div><div class="album-hero-year" id="alb-year"></div></div>' +
        '</div>' +
        '<div class="album-play-row"><button class="album-play-btn" onclick="playAlbum()">▶ Play All</button><div class="album-shuffle-btn" onclick="toggleShuffle();toast(\'🔀 Shuffle \' + (MUSIC_shuffle?\'on\':\'off\'))">🔀</div></div>' +
        '<div id="alb-tracks"></div>' +
      '</div>';
    document.body.appendChild(existing);
  }

  document.getElementById('alb-screen-title').textContent = a.name;
  document.getElementById('alb-name').textContent = a.name;
  document.getElementById('alb-artist').textContent = a.artist;
  document.getElementById('alb-year').textContent = a.tracks.length + ' tracks';

  buildTracks('alb-tracks', a.tracks);

  document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
  existing.classList.add('active');
};

window.closeAlbum = function () {
  var el = document.getElementById('screen-album');
  if (el) el.classList.remove('active');
  navTo('music');
};

window.playAlbum = function () {
  if (!MUSIC_curAlbum || !MUSIC_curAlbum.tracks.length) return;
  playTrack(MUSIC_curAlbum.tracks[0].id);
};

// ============================================================
// UPLOAD
// ============================================================
window.openMusicUpload = function () {
  if (!STATE.user) return toast('⚠ Please sign in first.');
  document.getElementById('music-upload-modal').classList.add('open');
};
window.closeMusicUpload = function () {
  document.getElementById('music-upload-modal').classList.remove('open');
};

window.submitMusicUpload = function () {
  var title = (document.getElementById('mu-title').value || '').trim();
  var artist = (document.getElementById('mu-artist').value || '').trim() || (STATE.user && STATE.user.nickname) || 'Unknown';
  var albumName = (document.getElementById('mu-album').value || '').trim();
  var audioFile = document.getElementById('mu-audio').files[0];
  var videoFile = document.getElementById('mu-video').files[0];
  var coverFile = document.getElementById('mu-cover').files[0];

  if (!title) return toast('⚠ Title is required.');
  if (!audioFile) return toast('⚠ Please select an audio file.');

  var form = new FormData();
  form.append('title', title);
  form.append('artist', artist);
  form.append('type', albumName ? 'album_track' : 'single');
  if (albumName) form.append('album_name', albumName);
  form.append('audio', audioFile);
  if (videoFile) form.append('video', videoFile);
  if (coverFile) form.append('cover', coverFile);

  toast('📤 Uploading...');
  api.post('/music', form, true)
    .then(function () {
      toast('✅ Track uploaded!');
      closeMusicUpload();
      document.getElementById('mu-title').value = '';
      document.getElementById('mu-artist').value = '';
      document.getElementById('mu-album').value = '';
      document.getElementById('mu-audio').value = '';
      document.getElementById('mu-video').value = '';
      document.getElementById('mu-cover').value = '';
      loadMusicLibrary();
    })
    .catch(function (err) { toast('❌ ' + err.message); });
};

console.log('[YID PLUS] music.js loaded ✓ (real upload pipeline)');
