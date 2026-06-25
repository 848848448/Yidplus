// functions/api/admin/ad-exempt.js
// GET  /api/admin/ad-exempt          -> list all no-ads users
// POST /api/admin/ad-exempt          -> { user_id } grant no-ads
// DELETE /api/admin/ad-exempt?id=X   -> revoke no-ads

import { json, corsHeaders, requireUser, isSuperOrOwner } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isSuperOrOwner(user, env.OWNER_EMAIL))
      return json({ ok: false, error: 'Forbidden' }, 403);

    const { results } = await env.DB.prepare(
      `SELECT id, nickname, email, no_ads FROM users WHERE no_ads = 1 ORDER BY nickname`
    ).all();
    return json({ ok: true, users: results });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isSuperOrOwner(user, env.OWNER_EMAIL))
      return json({ ok: false, error: 'Forbidden' }, 403);

    const { user_id } = await request.json();
    if (!user_id) return json({ ok: false, error: 'user_id required' }, 400);

    await env.DB.prepare(`UPDATE users SET no_ads = 1 WHERE id = ?`).bind(user_id).run();
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isSuperOrOwner(user, env.OWNER_EMAIL))
      return json({ ok: false, error: 'Forbidden' }, 403);

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return json({ ok: false, error: 'id required' }, 400);

    await env.DB.prepare(`UPDATE users SET no_ads = 0 WHERE id = ?`).bind(id).run();
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
