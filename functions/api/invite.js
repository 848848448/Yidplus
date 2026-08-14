// GET  /api/invite?code=XXX -> get room info for this invite
// POST /api/invite { code } -> join the room (or send request if private)
import { json, corsHeaders, requireUser } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const code = new URL(request.url).searchParams.get('code');
    if (!code) return json({ ok: false, error: 'Missing code' }, 400);
    const room = await env.DB.prepare(
      `SELECT id, name, type, visibility, photo_key,
              (SELECT COUNT(*) FROM room_members WHERE room_id = rooms.id) AS members
       FROM rooms WHERE invite_code = ?`
    ).bind(code).first();
    if (!room) return json({ ok: false, error: 'Invalid invite link' }, 404);
    return json({ ok: true, room });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const { code } = await request.json();
    if (!code) return json({ ok: false, error: 'Missing code' }, 400);

    const room = await env.DB.prepare(
      `SELECT * FROM rooms WHERE invite_code = ?`
    ).bind(code).first();
    if (!room) return json({ ok: false, error: 'Invalid invite link' }, 404);
    // Invite links are for groups/channels only — a 'private' room is a fixed
    // 2-person DM, and letting anyone with a code join one would turn it into
    // a group without either original participant agreeing (mirrors the same
    // guard chat/join.js already applies on the room_id join path).
    if (!['group', 'channel'].includes(room.type)) {
      return json({ ok: false, error: 'Invalid invite link' }, 404);
    }

    // Already a member?
    const already = await env.DB.prepare(
      `SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?`
    ).bind(room.id, user.id).first();
    if (already) return json({ ok: true, status: 'already_member', room_id: room.id });

    if (room.visibility === 'private' || room.approve_members) {
      // Private: create a join request (reuse the same pending system)
      const existing = await env.DB.prepare(
        `SELECT status FROM room_join_requests WHERE room_id = ? AND user_id = ?`
      ).bind(room.id, user.id).first();
      if (existing) return json({ ok: true, status: existing.status });

      await env.DB.prepare(
        `INSERT OR IGNORE INTO room_join_requests (id, room_id, user_id, nickname, status, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?)`
      ).bind(crypto.randomUUID(), room.id, user.id, user.nickname || '', new Date().toISOString()).run();
      return json({ ok: true, status: 'pending' });
    }

    // Public: join immediately
    await env.DB.prepare(
      `INSERT OR IGNORE INTO room_members (room_id, user_id, is_group_admin, joined_at)
       VALUES (?, ?, 0, ?)`
    ).bind(room.id, user.id, new Date().toISOString()).run();
    await env.DB.prepare(
      `INSERT INTO messages (id, room_id, sender_id, sender_nick, type, text, created_at, read)
       VALUES (?, ?, ?, ?, 'system', ?, ?, 1)`
    ).bind(crypto.randomUUID(), room.id, user.id, user.nickname || '',
      (user.nickname || 'Someone') + ' joined via invite link',
      new Date().toISOString()).run();

    return json({ ok: true, status: 'joined', room_id: room.id });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
  }
