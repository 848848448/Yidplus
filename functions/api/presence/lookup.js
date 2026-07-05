// functions/api/presence/lookup.js
// POST /api/presence/lookup  -> { ids: [user_id,...] } -> { online: { [id]: bool } }
// Online status is ONLY returned to admins. Regular users always get false.

import { json, corsHeaders, requireUser, isAdminRole } from '../_helpers.js';

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

    // Non-admins always get empty online status
    if (!isAdminRole(user, env.OWNER_EMAIL)) {
      const empty = {};
      for (const id of ids) empty[id] = false;
      return json({ ok: true, online: empty });
    }

    const placeholders = ids.map(() => '?').join(',');
    let results;
    try {
      const r = await env.DB.prepare(
        `SELECT id, (CASE WHEN online = 1 AND last_ping >= datetime('now','-60 seconds') THEN 1 ELSE 0 END) AS online
         FROM users WHERE id IN (${placeholders})`
      ).bind(...ids).all();
      results = r.results;
    } catch (e) {
      // last_ping column not migrated yet — fall back to the raw flag
      const r = await env.DB.prepare(`SELECT id, online FROM users WHERE id IN (${placeholders})`).bind(...ids).all();
      results = r.results;
    }

    const online = {};
    for (const row of results) online[row.id] = !!row.online;

    return json({ ok: true, online });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
                     }
