// functions/api/notifications.js
//   GET            -> { ok, notifications:[...], unread }
//   GET ?count=1   -> { ok, unread }        (cheap poll for the badge)
//   POST {read:'all'} or {read:id}  -> mark read
//   DELETE         -> clear all

import { json, corsHeaders, requireUser } from './_helpers.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

async function ensure(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_id TEXT, type TEXT,
      actor_id TEXT, actor_nick TEXT, text TEXT, link TEXT, read INTEGER DEFAULT 0, created_at TEXT)`
  ).run().catch(() => {});
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    await ensure(env);
    const url = new URL(request.url);
    const unreadRow = await env.DB.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0').bind(user.id).first().catch(() => ({ c: 0 }));
    const unread = (unreadRow && unreadRow.c) || 0;
    if (url.searchParams.get('count')) return json({ ok: true, unread });
    const { results } = await env.DB.prepare(
      'SELECT id, type, actor_nick, text, link, read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
    ).bind(user.id).all().catch(() => ({ results: [] }));
    return json({ ok: true, notifications: results || [], unread });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    await ensure(env);
    const body = await request.json().catch(() => ({}));
    if (body.read === 'all') {
      await env.DB.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').bind(user.id).run();
    } else if (body.read) {
      await env.DB.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND id = ?').bind(user.id, body.read).run();
    }
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    await env.DB.prepare('DELETE FROM notifications WHERE user_id = ?').bind(user.id).run().catch(() => {});
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
