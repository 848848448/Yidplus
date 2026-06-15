// ============================================================
// js/music.js — Music library + full player (curated catalog)
// Uses: api, STATE, toast, escHtml, navTo
// Screens: #screen-music, #screen-player, #mini-player
// Likes persisted in localStorage (per-browser)
// ============================================================

var ALBUMS = [
  { id: 'a1', emoji: '🎹', bg: '#F5EBFF', name: 'Niggunim Vol. 3', artist: 'Moshe Levi', year: '2024', trending: true,
    tl: [{ n: 'Shabbos Morning', d: '3:42' }, { n: 'Maariv Nigun', d: '4:15' }, { n: 'Havdalah', d: '2:58' }, { n: 'Friday Night', d: '5:01' }, { n: 'Zemirot', d: '3:33' }, { n: 'Kiddush', d: '2:47' }, { n: 'Al Hanisim', d: '4:22' }, { n: 'Closing Niggun', d: '6:10' }] },
  { id: 'a2', emoji: '🎤', bg: '#E8F4FF', name: 'Soulful Beats', artist: 'ShlomoBeats', year: '2024', trending: false,
    tl: [{ n: 'Opening', d: '2:55' }, { n: 'Dance Floor', d: '3:48' }, { n: 'Sunrise Prayer', d: '4:12' }, { n: 'Midnight', d: '3:29' }, { n: 'Unity', d: '5:15' }, { n: 'Celebration', d: '3:07' }, { n: 'Reflection', d: '4:44' }, { n: 'Journey', d: '3:55' }, { n: 'Together', d: '4:01' }, { n: 'Finale', d: '6:30' }] },
  { id: 'a3', emoji: '🎻', bg: '#E8FFF0', name: 'Klezmer Dreams', artist: 'FiddlerNY', year: '2023', trending: true,
    tl: [{ n: 'Wedding Dance', d: '3:20' }, { n: 'Village Song', d: '4:45' }, { n: 'Old Country', d: '3:55' }, { n: 'Hora Night', d: '5:10' }, { n: 'Sunset Melody', d: '3:38' }, { n: 'Farewell', d: '4:22' }] },
  { id: 'a4', emoji: '🕎', bg: '#FFF5E8', name: 'Chanukah Collection', artist: 'Various Artists', year: '2024', trending: false,
    tl: [{ n: 'Maoz Tzur', d: '2:45' }, { n: 'Candle Dance', d: '3:15' }, { n: 'Eight Nights', d: '4:00' }, { n: 'Latke Song', d: '2:30' }, { n: 'Miracle', d: '5:05' }, { n: 'Dreidel Mix', d: '3:22' }] },
];

var SINGLES = [
  { id: 's1', emoji: '🎵', bg: '#FFF0F0', name: 'Am Yisrael Chai', artist: 'ShlomoBeats', dur: '3:45', hasVideo: true, trending: true },
  { id: 's2', emoji: '🕊️', bg: '#E8FFF0', name: 'Shalom Aleichem', artist: 'Moshe Levi', dur: '4:12', hasVideo: false, trending: false },
  { id: 's3', emoji: '🌅', bg: '#FFF8E8', name: 'Modeh Ani', artist: 'RebbeChoir', dur: '2:58', hasVideo: false, trending: true },
  { id: 's4', emoji: '🎺', bg: '#E8FFFF', name: 'Rosh Hashana', artist: 'KlezmerBand', dur: '5:20', hasVideo: true, trending: false },
  { id: 's5', emoji: '🌙', bg: '#F0E8FF', name: 'Lecha Dodi', artist: 'ShlomoBeats', dur: '4:08', hasVideo: false, trending: true },
  { id: 's6', emoji: '🔥', bg: '#FFE8E0', name: 'Simchas Torah', artist: 'FiddlerNY', dur: '3:33', hasVideo: true, trending: false },
];

var MVS = [
  { id: 'mv1', emoji: '🎹', name: 'Niggun #1 — Official MV', artist: 'Moshe Levi', views: '112K' },
  { id: 'mv2', emoji: '🎤', name: 'Am Yisrael Chai (MV)', artist: 'ShlomoBeats', views: '87K' },
  { id: 'mv3', emoji: '🎻', name: 'Wedding Dance (Live)', artist: 'FiddlerNY', views: '44K' },
  { id: 'mv4', emoji: '🕎', name: 'Maoz Tzur (Animated)', artist: 'Various', views: '211K' },
];

var MUSIC_allTracks = [];
var MUSIC_likedSet = new Set();
var MUSIC_curTrack = null, MUSIC_curIdx = 0, MUSIC_playing = false, MUSIC_prog = 0, MUSIC_totalSec = 0;
var MUSIC_shuffle = false, MUSIC_repeat = false, MUSIC_progTimer = null, MUSIC_mode = 'song', MUSIC_curAlbum = null;

function MUSIC_buildAll() {
  MUSIC_allTracks = SINGLES.slice();
  ALBUMS.forEach(function (a) {
    a.tl.forEach(function (t, i) {
      MUSIC_allTracks.push({ id: a.id + '_' + i, emoji: a.emoji, bg: a.bg, name: t.n, artist: a.artist, dur: t.d, hasVideo: false, trending: a.trending });
    });
  });
}

function MUSIC_loadLiked() {
  try {
    var raw = localStorage.getItem('yp_music_liked');
    if (raw) MUSIC_likedSet = new Set(JSON.parse(raw));
  } catch (e) {}
}
function MUSIC_saveLiked() {
  localStorage.setItem('yp_music_liked', JSON.stringify([...MUSIC_likedSet]));
}

// ============================================================
// INIT
// ============================================================
window.init_music = function () {
  if (!MUSIC_allTracks.length) MUSIC_buildAll();
  MUSIC_loadLiked();
  buildAlbums();
  buildTracks('singles-list', SINGLES);
  buildMVs();
  buildLiked();
};

// ============================================================
// BUILD ALBUMS
// ============================================================
function buildAlbums() {
  var r = document.getElementById('albums-row');
  if (!r) return;
  r.innerHTML = ALBUMS.map(function (a) {
    return '<div class="album-card" onclick="openAlbum(\'' + a.id + '\')">' +
      '<div class="album-cover" style="background:' + a.bg + '">' +
        '<div class="album-cover-bg">' + a.emoji + '</div>' +
        '<div class="album-cover-emoji">' + a.emoji + '</div>' +
        (a.trending ? '<div class="trending-star">⭐</div>' : '') +
      '</div>' +
      '<div class="album-name">' + escHtml(a.name) + '</div>' +
      '<div class="album-artist">' + escHtml(a.artist) + '</div>' +
      '<div class="album-tracks">' + a.tl.length + ' tracks · ' + a.year + '</div>' +
    '</div>';
  }).join('');
}

// ============================================================
// BUILD TRACK LIST
// ============================================================
function buildTracks(elId, list) {
  var el = document.getElementById(elId);
  if (!el) return;

  el.innerHTML = list.map(function (t) {
    var isPlaying = MUSIC_curTrack && MUSIC_curTrack.id === t.id && MUSIC_playing;
    var liked = MUSIC_likedSet.has(t.id);
    return '<div class="track-item" onclick="playTrack(\'' + t.id + '\')">' +
      '<div class="track-thumb" style="background:' + (t.bg || 'var(--bg3)') + '">' +
        '<div class="track-thumb-bg">' + t.emoji + '</div>' +
        '<div class="track-thumb-emoji">' + t.emoji + '</div>' +
        (isPlaying ? '<div class="playing-bars"><div class="pbar"></div><div class="pbar"></div><div class="pbar"></div></div>' : '') +
      '</div>' +
      '<div class="track-info">' +
        '<div class="track-name' + (isPlaying ? ' playing' : '') + '">' + escHtml(t.name) + (t.trending ? '<span class="trending-badge">⭐ Trending</span>' : '') + '</div>' +
        '<div class="track-artist">' + escHtml(t.artist) + (t.hasVideo ? ' · 🎬' : '') + '</div>' +
      '</div>' +
      '<div class="track-dur">' + t.dur + '</div>' +
      '<div class="track-heart" onclick="event.stopPropagation();heartTrack(\'' + t.id + '\')">' + (liked ? '❤️' : '🤍') + '</div>' +
      '<div class="track-more" onclick="event.stopPropagation();shareTrackById(\'' + t.id + '\')">📤</div>' +
    '</div>';
  }).join('');
}

// ============================================================
// BUILD MVS
// ============================================================
function buildMVs() {
  var r = document.getElementById('mv-row');
  if (!r) return;
  r.innerHTML = MVS.map(function (mv) {
    return '<div class="mv-card" onclick="playMV(\'' + mv.id + '\')">' +
      '<div class="mv-thumb">' + mv.emoji + '<div class="mv-play"><div class="mv-play-icon">▶</div></div></div>' +
      '<div class="mv-name">' + escHtml(mv.name) + '</div>' +
      '<div class="mv-artist">' + escHtml(mv.artist) + ' · 👁 ' + mv.views + '</div>' +
    '</div>';
  }).join('');
}

window.playMV = function (mvId) {
  var mv = MVS.find(function (x) { return x.id === mvId; });
  if (!mv) return;
  playTrack(null, { id: mv.id, emoji: mv.emoji, bg: '#111', name: mv.name, artist: mv.artist, dur: '3:45', hasVideo: true, trending: false });
  setPlayerMode('video');
};

// ============================================================
// LIKED
// ============================================================
function buildLiked() {
  buildTracks('liked-list', MUSIC_allTracks.filter(function (t) { return MUSIC_likedSet.has(t.id); }));
}

window.openLikedSongs = function () {
  document.querySelectorAll('.mtab').forEach(function (t) { t.classList.remove('active'); });
  switchMusicTab(document.querySelectorAll('.mtab')[document.querySelectorAll('.mtab').length - 1] || document.querySelector('.mtab'), 'liked');
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
// PLAY TRACK
// ============================================================
window.playTrack = function (trackId, overrideTrack) {
  var t = overrideTrack || MUSIC_allTracks.find(function (x) { return x.id === trackId; });
  if (!t) return;

  MUSIC_curTrack = t;
  MUSIC_curIdx = MUSIC_allTracks.findIndex(function (x) { return x.id === t.id; });
  if (MUSIC_curIdx < 0) MUSIC_curIdx = 0;
  MUSIC_playing = true;
  MUSIC_prog = 0;

  var parts = t.dur.split(':');
  MUSIC_totalSec = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);

  document.getElementById('player-name').textContent = t.name;
  document.getElementById('player-artist').textContent = t.artist;
  document.getElementById('artwork-emoji').textContent = t.emoji;
  document.getElementById('artwork-bg').textContent = t.emoji;
  document.getElementById('artwork').style.background = t.bg || 'var(--bg3)';
  var vpEmoji = document.getElementById('vp-emoji');
  if (vpEmoji) vpEmoji.textContent = t.emoji;
  document.getElementById('heart-big').textContent = MUSIC_likedSet.has(t.id) ? '❤️' : '🤍';
  document.getElementById('t-tot').textContent = t.dur;
  document.getElementById('mini-thumb').textContent = t.emoji;
  document.getElementById('mini-name').textContent = t.name;
  document.getElementById('mini-artist').textContent = t.artist;
  document.getElementById('mini-player').classList.add('show');

  setPlayBtn('⏸');
  startProgress();
  buildQueue();
  buildTracks('singles-list', SINGLES);
  buildLiked();

  setPlayerMode(t.hasVideo ? MUSIC_mode : 'song');
  navTo('player');
};

function startProgress() {
  clearInterval(MUSIC_progTimer);
  MUSIC_progTimer = setInterval(function () {
    if (!MUSIC_playing) return;
    MUSIC_prog = Math.min(1, MUSIC_prog + 1 / MUSIC_totalSec);
    var pct = (MUSIC_prog * 100).toFixed(2) + '%';
    var fill = document.getElementById('prog-fill');
    var dot = document.getElementById('prog-dot');
    var miniProg = document.getElementById('mini-prog');
    if (fill) fill.style.width = pct;
    if (dot) dot.style.left = pct;
    if (miniProg) miniProg.style.width = pct;
    var c = Math.floor(MUSIC_prog * MUSIC_totalSec);
    var tcur = document.getElementById('t-cur');
    if (tcur) tcur.textContent = Math.floor(c / 60) + ':' + String(c % 60).padStart(2, '0');
    if (MUSIC_prog >= 1) { clearInterval(MUSIC_progTimer); nextTrack(); }
  }, 1000);
}

window.togglePlay = function () {
  MUSIC_playing = !MUSIC_playing;
  setPlayBtn(MUSIC_playing ? '⏸' : '▶');
  document.getElementById('artwork').classList.toggle('playing', MUSIC_playing);
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
  document.getElementById('shuf-btn').classList.toggle('on', MUSIC_shuffle);
};
window.toggleRepeat = function () {
  MUSIC_repeat = !MUSIC_repeat;
  document.getElementById('rep-btn').classList.toggle('on', MUSIC_repeat);
};
window.seekTo = function (e) {
  var b = document.getElementById('prog-bar');
  var r = b.getBoundingClientRect();
  MUSIC_prog = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  startProgress();
};

window.toggleLike = function () {
  if (!MUSIC_curTrack) return;
  heartTrack(MUSIC_curTrack.id);
  document.getElementById('heart-big').textContent = MUSIC_likedSet.has(MUSIC_curTrack.id) ? '❤️' : '🤍';
};

window.heartTrack = function (id) {
  if (MUSIC_likedSet.has(id)) MUSIC_likedSet.delete(id);
  else MUSIC_likedSet.add(id);
  MUSIC_saveLiked();
  buildTracks('singles-list', SINGLES);
  buildLiked();
  if (MUSIC_curTrack && MUSIC_curTrack.id === id) {
    document.getElementById('heart-big').textContent = MUSIC_likedSet.has(id) ? '❤️' : '🤍';
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
  ql.innerHTML = MUSIC_allTracks.slice(MUSIC_curIdx + 1, MUSIC_curIdx + 6).map(function (t, i) {
    return '<div class="queue-item" onclick="playTrack(\'' + t.id + '\')">' +
      '<div class="queue-num">' + (i + 1) + '</div>' +
      '<div class="queue-thumb">' + t.emoji + '</div>' +
      '<div class="queue-info"><div class="queue-name">' + escHtml(t.name) + '</div><div class="queue-artist">' + escHtml(t.artist) + '</div></div>' +
      '<div style="font-size:.68rem;color:var(--muted2)">' + t.dur + '</div>' +
    '</div>';
  }).join('');
}

// ============================================================
// ALBUM DETAIL — reuses #screen-channel's grid? No, build inline overlay
// ============================================================
window.openAlbum = function (albumId) {
  var a = ALBUMS.find(function (x) { return x.id === albumId; });
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
          '<div class="album-hero-art" id="alb-art"></div>' +
          '<div><div class="album-hero-label">Album</div><div class="album-hero-name" id="alb-name"></div><div class="album-hero-artist" id="alb-artist"></div><div class="album-hero-year" id="alb-year"></div></div>' +
        '</div>' +
        '<div class="album-play-row"><button class="album-play-btn" onclick="playAlbum()">▶ Play All</button><div class="album-shuffle-btn" onclick="toggleShuffle();toast(\'🔀 Shuffle \' + (MUSIC_shuffle?\'on\':\'off\'))">🔀</div></div>' +
        '<div id="alb-tracks"></div>' +
      '</div>';
    document.body.appendChild(existing);
  }

  document.getElementById('alb-screen-title').textContent = a.name;
  document.getElementById('alb-art').textContent = a.emoji;
  document.getElementById('alb-art').style.background = a.bg;
  document.getElementById('alb-name').textContent = a.name;
  document.getElementById('alb-artist').textContent = a.artist;
  document.getElementById('alb-year').textContent = a.year + ' · ' + a.tl.length + ' tracks';

  buildTracks('alb-tracks', a.tl.map(function (t, i) {
    return { id: a.id + '_' + i, emoji: a.emoji, bg: a.bg, name: t.n, artist: a.artist, dur: t.d, hasVideo: false, trending: a.trending };
  }));

  document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
  existing.classList.add('active');
};

window.closeAlbum = function () {
  var el = document.getElementById('screen-album');
  if (el) el.classList.remove('active');
  navTo('music');
};

window.playAlbum = function () {
  if (!MUSIC_curAlbum) return;
  playTrack(MUSIC_curAlbum.id + '_0');
};

console.log('[YID PLUS] music.js loaded ✓');
