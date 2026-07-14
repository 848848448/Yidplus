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
}

// POST from the external Telethon worker. Auth via a shared secret so only your
// script can push posts. Always returns ok:true (status in the body).
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

    const text = (body.text || '').toString().slice(0, 8000);
    const mediaUrl = (body.media_url || '').toString().slice(0, 1000) || null;
    const mediaType = (body.media_type || '').toString().slice(0, 20) || null;
    const link = (body.link || ('https://t.me/' + username + '/' + msgId)).toString().slice(0, 300);
    const postedAt = (body.posted_at || new Date().toISOString()).toString().slice(0, 40);

    // Insert; ignore if we already have this (username, msg_id).
    await env.DB.prepare(
      'INSERT OR IGNORE INTO telegram_posts (id, username, tg_msg_id, text, media_url, media_type, link, posted_at, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), username, msgId, text, mediaUrl, mediaType, link, postedAt, new Date().toISOString()).run();

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
      'SELECT tg_msg_id, text, media_url, media_type, link, posted_at FROM telegram_posts WHERE username = ? ORDER BY tg_msg_id DESC LIMIT 50'
    ).bind(username).all();
    return json({ ok: true, posts: res.results || [] });
  } catch (err) {
    return json({ ok: true, posts: [], error: err.message });
  }
}
