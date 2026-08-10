// User-level block list: a person can block another person so they can't DM them.
import { json, corsHeaders, requireUser } from './_helpers.js';

async function ensure(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS user_blocks (
       user_id TEXT NOT NULL,
       blocked_id TEXT NOT NULL,
       created_at TEXT,
       PRIMARY KEY (user_id, blocked_id)
     )`
  ).run().catch(() => {});
}

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    await ensure(env);
    const { results } = await env.DB.prepare(
      `SELECT u.id, u.nickname, u.photo_url
         FROM user_blocks b JOIN users u ON u.id = b.blocked_id
        WHERE b.user_id = ? ORDER BY b.created_at DESC`
    ).bind(user.id).all().catch(() => ({ results: [] }));
    return json({ ok: true, users: results || [] });
  } catch (e) { return json({ ok: true, users: [] }); }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    await ensure(env);
    const body = await request.json().catch(() => ({}));
    const target = body.user_id;
    if (!target) return json({ ok: false, error: 'user_id required' }, 400);
    if (target === user.id) return json({ ok: false, error: "You can't block yourself" }, 400);
    if (body.action === 'unblock') {
      await env.DB.prepare('DELETE FROM user_blocks WHERE user_id = ? AND blocked_id = ?').bind(user.id, target).run();
      return json({ ok: true, blocked: false });
    }
    await env.DB.prepare(
      'INSERT OR IGNORE INTO user_blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?)'
    ).bind(user.id, target, new Date().toISOString()).run();
    return json({ ok: true, blocked: true });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}
