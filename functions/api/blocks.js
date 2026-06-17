// functions/api/blocks.js
// GET    /api/blocks            -> list users I've blocked
// POST   /api/blocks            -> { blocked_id } block a user
// DELETE /api/blocks?id=xxx     -> unblock a user (id = blocked_id)

import { json, corsHeaders, requireUser } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const { results } = await env.DB.prepare(
      `SELECT b.blocked_id, u.nickname FROM user_blocks b
       JOIN users u ON u.id = b.blocked_id
       WHERE b.blocker_id = ?`
    ).bind(user.id).all();

    return json({ ok: true, blocked: results });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const body = await request.json();
    const blockedId = body.blocked_id;
    if (!blockedId) return json({ ok: false, error: 'blocked_id is required' }, 400);
    if (blockedId === user.id) return json({ ok: false, error: 'Cannot block yourself' }, 400);

    await env.DB.prepare(
      `INSERT OR IGNORE INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`
    ).bind(user.id, blockedId, new Date().toISOString()).run();

    return json({ ok: true }, 201);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const url = new URL(request.url);
    const blockedId = url.searchParams.get('id');
    if (!blockedId) return json({ ok: false, error: 'id is required' }, 400);

    await env.DB.prepare(
      `DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?`
    ).bind(user.id, blockedId).run();

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
