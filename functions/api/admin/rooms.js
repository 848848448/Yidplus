import { json, corsHeaders, requireUser, isAdminRole } from '../_helpers.js';
export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
    const { results } = await env.DB.prepare(
      `SELECT r.id, r.type, r.name, r.emoji,
              (SELECT COUNT(*) FROM room_members rm WHERE rm.room_id = r.id) AS members,
              (SELECT text FROM messages m WHERE m.room_id = r.id ORDER BY m.created_at DESC LIMIT 1) AS preview,
              (SELECT created_at FROM messages m WHERE m.room_id = r.id ORDER BY m.created_at DESC LIMIT 1) AS last_active
       FROM rooms r ORDER BY last_active DESC LIMIT 100`
    ).all();
    return json({ ok: true, rooms: results });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
