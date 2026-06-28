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
    const inviteCode = body.invite_code;

    let room;
    if (inviteCode) {
      room = await env.DB.prepare('SELECT id, type FROM rooms WHERE invite_code = ?').bind(inviteCode).first();
      if (!room) return json({ ok: false, error: 'Invalid invite link' }, 404);
    } else if (roomId) {
      room = await env.DB.prepare('SELECT id, type FROM rooms WHERE id = ?').bind(roomId).first();
    }

    if (!room) return json({ ok: false, error: 'room_id or invite_code is required' }, 400);
    if (!['group', 'channel'].includes(room.type)) return json({ ok: false, error: 'Cannot join a private chat' }, 400);

    const exists = await env.DB.prepare(
      `SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?`
    ).bind(room.id, user.id).first();

    if (!exists) {
      await env.DB.prepare(
        `INSERT INTO room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)`
      ).bind(room.id, user.id, new Date().toISOString()).run();

      await env.DB.prepare(
        `INSERT INTO messages (id, room_id, sender_id, sender_nick, type, text, created_at, read)
         VALUES (?, ?, ?, ?, 'system', ?, ?, 1)`
      ).bind(
        crypto.randomUUID(), room.id, user.id, user.nickname,
        (user.nickname || 'Someone') + ' joined',
        new Date().toISOString()
      ).run();
    }

    return json({ ok: true, room_id: room.id });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
