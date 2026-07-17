// Emoji reactions on Telegram channel posts.
//
// Deliberately the same shape as /api/chat/reactions — same toggle behaviour,
// same summary format — so the client can reuse the reaction pills the chats
// already have. The only difference is the key: a channel post is identified by
// (username, tg_msg_id) rather than by a message id.
//
// POST { username, tg_msg_id, emoji } -> toggle (re-tapping the same emoji removes it)
// GET  ?username=xxx                  -> bulk summary for that channel

import { json, corsHeaders, requireUser } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

let _schemaReady = null;

async function ensureTable(env) {
  if (_schemaReady) return _schemaReady;
  _schemaReady = _migrate(env);
  return _schemaReady;
}

async function _migrate(env) {
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS telegram_reactions (' +
    'username TEXT NOT NULL, tg_msg_id INTEGER NOT NULL, user_id TEXT NOT NULL, ' +
    'emoji TEXT NOT NULL, created_at TEXT NOT NULL, ' +
    'PRIMARY KEY (username, tg_msg_id, user_id))'
  ).run().catch(() => {});
  // Fetching "what did I react to in this channel" filters on username+user_id,
  // and user_id is the third column of the PK — so that index can't serve it.
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_tgreactions_user ON telegram_reactions(username, user_id)'
  ).run().catch(() => {});
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: true, error: 'Not signed in' });
    await ensureTable(env);

    const body = await request.json().catch(() => ({}));
    const username = String(body.username || '').replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '');
    const msgId = parseInt(body.tg_msg_id);
    const emoji = String(body.emoji || '').slice(0, 8);
    if (!username || !msgId || !emoji) return json({ ok: true, error: 'username, tg_msg_id and emoji are required' });

    const existing = await env.DB.prepare(
      'SELECT emoji FROM telegram_reactions WHERE username = ? AND tg_msg_id = ? AND user_id = ?'
    ).bind(username, msgId, user.id).first();

    let mine = emoji;
    if (existing && existing.emoji === emoji) {
      // Same emoji again = take it back.
      await env.DB.prepare('DELETE FROM telegram_reactions WHERE username = ? AND tg_msg_id = ? AND user_id = ?')
        .bind(username, msgId, user.id).run();
      mine = null;
    } else {
      // One reaction per person per post, so a different emoji replaces it.
      await env.DB.prepare(
        'INSERT INTO telegram_reactions (username, tg_msg_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT(username, tg_msg_id, user_id) DO UPDATE SET emoji = excluded.emoji, created_at = excluded.created_at'
      ).bind(username, msgId, user.id, emoji, new Date().toISOString()).run();
    }

    const counts = await env.DB.prepare(
      'SELECT emoji, COUNT(*) AS n FROM telegram_reactions WHERE username = ? AND tg_msg_id = ? GROUP BY emoji'
    ).bind(username, msgId).all();

    const out = {};
    for (const r of (counts.results || [])) out[r.emoji] = r.n;
    return json({ ok: true, counts: out, my_reaction: mine });
  } catch (err) {
    return json({ ok: true, error: err.message });
  }
}

// GET ?username= -> { reactions: { <tg_msg_id>: { counts: {emoji:n}, my_reaction } } }
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    await ensureTable(env);
    const username = (new URL(request.url).searchParams.get('username') || '')
      .replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '');
    if (!username) return json({ ok: true, reactions: {} });

    const user = await requireUser(request, env).catch(() => null);

    const all = await env.DB.prepare(
      'SELECT tg_msg_id, emoji, COUNT(*) AS n FROM telegram_reactions WHERE username = ? GROUP BY tg_msg_id, emoji'
    ).bind(username).all();

    const reactions = {};
    for (const r of (all.results || [])) {
      if (!reactions[r.tg_msg_id]) reactions[r.tg_msg_id] = { counts: {}, my_reaction: null };
      reactions[r.tg_msg_id].counts[r.emoji] = r.n;
    }

    if (user) {
      const mine = await env.DB.prepare(
        'SELECT tg_msg_id, emoji FROM telegram_reactions WHERE username = ? AND user_id = ?'
      ).bind(username, user.id).all();
      for (const r of (mine.results || [])) {
        if (!reactions[r.tg_msg_id]) reactions[r.tg_msg_id] = { counts: {}, my_reaction: null };
        reactions[r.tg_msg_id].my_reaction = r.emoji;
      }
    }

    return json({ ok: true, reactions });
  } catch (err) {
    return json({ ok: true, reactions: {}, error: err.message });
  }
}
