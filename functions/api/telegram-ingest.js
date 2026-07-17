import { json, corsHeaders } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

// The schema work only needs doing once, not on every request. This ran
// CREATE TABLE plus fourteen ALTER TABLE ADD COLUMN statements — every one of
// which throws, because the columns already exist — before serving anything.
// A Worker isolate is reused across requests, so remembering it here means the
// cost is paid once per isolate rather than per request.
let _schemaReady = null;

async function ensureTable(env) {
  if (_schemaReady) return _schemaReady;
  _schemaReady = _migrate(env);
  return _schemaReady;
}

async function _migrate(env) {
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS telegram_posts (' +
    'id TEXT PRIMARY KEY, username TEXT NOT NULL, tg_msg_id INTEGER NOT NULL, ' +
    'text TEXT, media_url TEXT, media_type TEXT, link TEXT, posted_at TEXT, created_at TEXT NOT NULL, ' +
    'UNIQUE(username, tg_msg_id))'
  ).run().catch(() => {});
  // Lazy columns for the X-style card (older tables get them added here).
  const cols = ['author_name TEXT', 'author_handle TEXT', 'author_avatar TEXT', 'views INTEGER', 'forwards INTEGER', 'replies INTEGER', 'likes INTEGER',
    // What Telegram shows beside a track — the song name, performer, running
    // time and file name. Without these a track renders as a bare player.
    'media_title TEXT', 'media_performer TEXT', 'media_duration INTEGER', 'media_name TEXT', 'media_thumb INTEGER', 'entities TEXT', 'grouped_id TEXT'];
  for (const c of cols) {
    await env.DB.prepare('ALTER TABLE telegram_posts ADD COLUMN ' + c).run().catch(() => {});
  }
  // The unread count joins on username and compares posted_at. Without this it
  // scans every post in the table — for every user, every time the channel list
  // refreshes, which is once a minute each.
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_tgposts_user_posted ON telegram_posts(username, posted_at)'
  ).run().catch(() => {});
}

// POST from the external Telethon worker. Auth via a shared secret.
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const secret = env.TELEGRAM_INGEST_SECRET;
    if (!secret) return json({ ok: true, accepted: false, error: 'Server not configured (missing TELEGRAM_INGEST_SECRET)' });

    const body = await request.json().catch(() => ({}));
    if (!body || body.secret !== secret) return json({ ok: true, accepted: false, error: 'Bad secret' });

    const username = String(body.username || '').replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '');
    const msgId = parseInt(body.tg_msg_id);
    if (!username || !msgId) return json({ ok: true, accepted: false, error: 'username and tg_msg_id required' });

    await ensureTable(env);

    const text       = (body.text || '').toString().slice(0, 8000);
    const mediaUrl   = (body.media_url || '').toString().slice(0, 1000) || null;
    const mediaType  = (body.media_type || '').toString().slice(0, 20) || null;

    const link       = (body.link || ('https://t.me/' + username + '/' + msgId)).toString().slice(0, 300);
    const postedAt   = (body.posted_at || new Date().toISOString()).toString().slice(0, 40);
    const authorName = (body.author_name || '').toString().slice(0, 120) || null;
    const authorHndl = (body.author_handle || username).toString().replace(/^@/, '').slice(0, 60);
    const authorAv   = (body.author_avatar || '').toString().slice(0, 1000) || null;
    const mTitle     = (body.media_title || '').toString().slice(0, 200);
    const mPerformer = (body.media_performer || '').toString().slice(0, 200);
    const mDuration  = parseInt(body.media_duration) || 0;
    const mName      = (body.media_name || '').toString().slice(0, 200);
    const mThumb     = body.media_thumb ? 1 : 0;
    const ents       = (body.entities || '').toString().slice(0, 8000);
    const grouped    = (body.grouped_id || '').toString().slice(0, 40);
    const views      = parseInt(body.views) || null;
    const forwards   = parseInt(body.forwards) || null;

    await env.DB.prepare(
      'INSERT INTO telegram_posts (id, username, tg_msg_id, text, media_url, media_type, media_title, media_performer, media_duration, media_name, media_thumb, entities, grouped_id, link, posted_at, author_name, author_handle, author_avatar, views, forwards, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(username, tg_msg_id) DO UPDATE SET ' +
      'text = excluded.text, ' +
      // Only ever fill media in, never blank it out: a re-sync that couldn't
      // fetch the file (CPU, rate limit, size) sends an empty media_url, and
      // taking that literally would wipe a picture we already had.
      'media_url = COALESCE(NULLIF(excluded.media_url, \'\'), telegram_posts.media_url), ' +
      'media_type = COALESCE(NULLIF(excluded.media_type, \'\'), telegram_posts.media_type), ' +
      'media_title = excluded.media_title, media_performer = excluded.media_performer, ' +
      'media_duration = excluded.media_duration, media_name = excluded.media_name, ' +
      'media_thumb = excluded.media_thumb, entities = excluded.entities, ' +
      'grouped_id = excluded.grouped_id, ' +
      'views = excluded.views, forwards = excluded.forwards'
    ).bind(crypto.randomUUID(), username, msgId, text, mediaUrl, mediaType, mTitle, mPerformer, mDuration, mName, mThumb, ents, grouped, link, postedAt, authorName, authorHndl, authorAv, views, forwards, new Date().toISOString()).run();

    return json({ ok: true, accepted: true });
  } catch (err) {
    return json({ ok: true, accepted: false, error: err.message });
  }
}

// GET ?username=X → recent stored posts for the viewer (public).
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    await ensureTable(env);
    const username = (new URL(request.url).searchParams.get('username') || '').replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '');
    if (!username) return json({ ok: true, posts: [] });
    const res = await env.DB.prepare(
      'SELECT tg_msg_id, text, media_url, media_type, media_title, media_performer, media_duration, media_name, media_thumb, entities, grouped_id, link, posted_at, author_name, author_handle, author_avatar, views, forwards FROM telegram_posts WHERE username = ? ORDER BY tg_msg_id DESC LIMIT 50'
    ).bind(username).all();
    return json({ ok: true, posts: res.results || [] });
  } catch (err) {
    return json({ ok: true, posts: [], error: err.message });
  }
}
