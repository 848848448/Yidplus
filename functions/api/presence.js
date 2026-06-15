// functions/api/presence.js
// POST /api/presence  -> mark current user online/offline, update last_seen
// Body: { online: boolean }

import { json, corsHeaders, requireUser } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const body = await request.json().catch(() => ({}));
    const online = body.online !== false; // default true
    const now = new Date().toISOString();

    await env.DB.prepare('UPDATE users SET online = ? WHERE id = ?')
      .bind(online ? 1 : 0, user.id).run();

    await env.DB.prepare(
      `INSERT INTO presence (user_id, online, last_seen) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET online = excluded.online, last_seen = excluded.last_seen`
    ).bind(user.id, online ? 1 : 0, now).run();

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
