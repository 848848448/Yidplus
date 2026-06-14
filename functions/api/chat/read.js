// functions/api/chat/read.js
// POST /api/chat/read  -> { room_id } -> mark all messages in the room
//   (not sent by the current user) as read.

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
    const roomId = body.room_id;
    if (!roomId) return json({ ok: false, error: 'room_id is required' }, 400);

    await env.DB.prepare(
      `UPDATE messages SET read = 1 WHERE room_id = ? AND sender_id != ?`
    ).bind(roomId, user.id).run();

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
      }
