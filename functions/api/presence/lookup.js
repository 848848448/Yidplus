// functions/api/presence/lookup.js
// POST /api/presence/lookup  -> { ids: [user_id,...] } -> { online: { [id]: bool } }

import { json, corsHeaders, requireUser } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const body = await request.json();
    const ids = Array.isArray(body.ids) ? body.ids.slice(0, 100) : [];
    if (!ids.length) return json({ ok: true, online: {} });

    const placeholders = ids.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT id, online FROM users WHERE id IN (${placeholders})`
    ).bind(...ids).all();

    const online = {};
    for (const row of results) online[row.id] = !!row.online;

    return json({ ok: true, online });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
