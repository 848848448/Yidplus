import { json, corsHeaders } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

async function ensureTable(env) {
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
    'media_title TEXT', 'media_performer TEXT', 'media_duration INTEGER', 'media_name TEXT'];
  for (const c of cols) {
    await env.DB.prepare('ALTER TABLE telegram_posts ADD COLUMN ' + c).run().catch(() => {});
  }
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
    let   mediaUrl   = (body.media_url || '').toString().slice(0, 1000) || null;
    const mediaType  = (body.media_type || '').toString().slice(0, 20) || null;

    // Optional inline media: the script base64-encodes the file; we store it in R2.
    if (!mediaUrl && body.media_b64 && env.MY_BUCKET) {
      try {
        const bin = Uint8Array.from(atob(body.media_b64), c => c.charCodeAt(0));
        const ext = (mediaType === 'video') ? 'mp4' : 'jpg';
        const key = 'tg/' + username + '/' + msgId + '.' + ext;
        await env.MY_BUCKET.put(key, bin, { httpMetadata: { contentType: mediaType === 'video' ? 'video/mp4' : 'image/jpeg' } });
        mediaUrl = '/api/media/' + key;
      } catch (e) { /* keep going without media */ }
    }
    const link       = (body.link || ('https://t.me/' + username + '/' + msgId)).toString().slice(0, 300);
    const postedAt   = (body.posted_at || new Date().toISOString()).toString().slice(0, 40);
    const authorName = (body.author_name || '').toString().slice(0, 120) || null;
    const authorHndl = (body.author_handle || username).toString().replace(/^@/, '').slice(0, 60);
    const authorAv   = (body.author_avatar || '').toString().slice(0, 1000) || null;
    const mTitle     = (body.media_title || '').toString().slice(0, 200);
    const mPerformer = (body.media_performer || '').toString().slice(0, 200);
    const mDuration  = parseInt(body.media_duration) || 0;
    const mName      = (body.media_name || '').toString().slice(0, 200);
    const views      = parseInt(body.views) || null;
    const forwards   = parseInt(body.forwards) || null;

    await env.DB.prepare(
      'INSERT INTO telegram_posts (id, username, tg_msg_id, text, media_url, media_type, media_title, media_performer, media_duration, media_name, link, posted_at, author_name, author_handle, author_avatar, views, forwards, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(username, tg_msg_id) DO UPDATE SET ' +
      'text = excluded.text, ' +
      // Only ever fill media in, never blank it out: a re-sync that couldn't
      // fetch the file (CPU, rate limit, size) sends an empty media_url, and
      // taking that literally would wipe a picture we already had.
      'media_url = COALESCE(NULLIF(excluded.media_url, \'\'), telegram_posts.media_url), ' +
      'media_type = COALESCE(NULLIF(excluded.media_type, \'\'), telegram_posts.media_type), ' +
      'media_title = excluded.media_title, media_performer = excluded.media_performer, ' +
      'media_duration = excluded.media_duration, media_name = excluded.media_name, ' +
      'views = excluded.views, forwards = excluded.forwards'
    ).bind(crypto.randomUUID(), username, msgId, text, mediaUrl, mediaType, mTitle, mPerformer, mDuration, mName, link, postedAt, authorName, authorHndl, authorAv, views, forwards, new Date().toISOString()).run();

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
      'SELECT tg_msg_id, text, media_url, media_type, media_title, media_performer, media_duration, media_name, link, posted_at, author_name, author_handle, author_avatar, views, forwards FROM telegram_posts WHERE username = ? ORDER BY tg_msg_id DESC LIMIT 50'
    ).bind(username).all();
    return json({ ok: true, posts: res.results || [] });
  } catch (err) {
    return json({ ok: true, posts: [], error: err.message });
  }
}
