// functions/api/chat/read.js
// POST /api/chat/read  -> { room_id } mark all messages in this room as read by the current user.
//
// Super Admin invisibility: when a Super Admin is god-mode-spectating a room they are
// NOT a member of, this call is a silent no-op — it must never mark messages read or
// otherwise leave a trace that the admin was watching.

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
    if (!body.room_id) return json({ ok: false, error: 'room_id is required' }, 400);

    const membership = await env.DB.prepare(
      `SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?`
    ).bind(body.room_id, user.id).first();

    // Not an actual member (e.g. an admin spectating) — invisible, do nothing.
    if (!membership) return json({ ok: true, invisible: true });

    await env.DB.prepare(
      `UPDATE messages SET read = 1 WHERE room_id = ? AND sender_id != ?`
    ).bind(body.room_id, user.id).run();

    // Per-member read tracking (needed for group "Seen by N" — requires the
    // last_read_at column on room_members; silently no-ops until that
    // migration has been run, so this never breaks the basic read marking above).
    await env.DB.prepare(
      `UPDATE room_members SET last_read_at = ? WHERE room_id = ? AND user_id = ?`
    ).bind(new Date().toISOString(), body.room_id, user.id).run().catch(() => {});

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
