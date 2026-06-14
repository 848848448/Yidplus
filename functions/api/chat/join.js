// functions/api/chat/join.js
// POST /api/chat/join  -> { room_id } -> join a group room

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

    const room = await env.DB.prepare('SELECT id, type FROM rooms WHERE id = ?').bind(roomId).first();
    if (!room) return json({ ok: false, error: 'Room not found' }, 404);
    if (room.type !== 'group') return json({ ok: false, error: 'Cannot join a private chat' }, 400);

    const exists = await env.DB.prepare(
      `SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?`
    ).bind(roomId, user.id).first();

    if (!exists) {
      await env.DB.prepare(
        `INSERT INTO room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)`
      ).bind(roomId, user.id, new Date().toISOString()).run();
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
      }
