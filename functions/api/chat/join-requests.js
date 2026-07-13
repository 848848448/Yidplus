import { json, corsHeaders, requireUser } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

// Is this user allowed to manage requests for the room? (creator or group admin)
async function canManage(env, roomId, userId) {
  const room = await env.DB.prepare('SELECT created_by FROM rooms WHERE id = ?').bind(roomId).first();
  if (room && room.created_by === userId) return true;
  const mem = await env.DB.prepare(
    'SELECT is_group_admin FROM room_members WHERE room_id = ? AND user_id = ?'
  ).bind(roomId, userId).first();
  return !!(mem && mem.is_group_admin);
}

// GET ?room_id=  → list this room's pending join requests (managers only)
// GET ?count=1   → total pending across all rooms I manage (for a badge)
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
    const url = new URL(request.url);

    if (url.searchParams.get('count')) {
      // Count pending requests for every room this user created or admins.
      const rooms = await env.DB.prepare(
        `SELECT DISTINCT r.id FROM rooms r
         LEFT JOIN room_members m ON m.room_id = r.id AND m.user_id = ?
         WHERE r.created_by = ? OR m.is_group_admin = 1`
      ).bind(user.id, user.id).all().catch(() => ({ results: [] }));
      const ids = (rooms.results || []).map(r => r.id);
      if (!ids.length) return json({ ok: true, count: 0 });
      const ph = ids.map(() => '?').join(',');
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS c FROM room_join_requests WHERE status = 'pending' AND room_id IN (${ph})`
      ).bind(...ids).first().catch(() => ({ c: 0 }));
      return json({ ok: true, count: row ? row.c : 0 });
    }

    const roomId = url.searchParams.get('room_id');
    if (!roomId) return json({ ok: false, error: 'room_id required' }, 400);
    if (!(await canManage(env, roomId, user.id))) return json({ ok: false, error: 'Forbidden' }, 403);

    const res = await env.DB.prepare(
      `SELECT jr.id, jr.user_id, jr.nickname, jr.created_at, u.photo_url, u.online
       FROM room_join_requests jr LEFT JOIN users u ON u.id = jr.user_id
       WHERE jr.room_id = ? AND jr.status = 'pending' ORDER BY jr.created_at ASC`
    ).bind(roomId).all().catch(() => ({ results: [] }));
    return json({ ok: true, requests: res.results || [] });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

// POST { request_id, action:'approve'|'reject' }
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
    const { request_id, action } = await request.json();
    if (!request_id || !['approve', 'reject'].includes(action)) return json({ ok: false, error: 'Bad request' }, 400);

    const jr = await env.DB.prepare(
      'SELECT id, room_id, user_id, nickname FROM room_join_requests WHERE id = ?'
    ).bind(request_id).first();
    if (!jr) return json({ ok: false, error: 'Request not found' }, 404);
    if (!(await canManage(env, jr.room_id, user.id))) return json({ ok: false, error: 'Forbidden' }, 403);

    if (action === 'approve') {
      const now = new Date().toISOString();
      await env.DB.prepare(
        `INSERT OR IGNORE INTO room_members (room_id, user_id, is_group_admin, joined_at) VALUES (?, ?, 0, ?)`
      ).bind(jr.room_id, jr.user_id, now).run();
      await env.DB.prepare("UPDATE room_join_requests SET status = 'approved' WHERE id = ?").bind(request_id).run();
      // Post a small system line so the group sees the new member.
      await env.DB.prepare(
        `INSERT INTO messages (id, room_id, sender_id, sender_nick, type, text, created_at, read)
         VALUES (?, ?, ?, ?, 'system', ?, ?, 0)`
      ).bind(crypto.randomUUID(), jr.room_id, 'system', 'System', (jr.nickname || 'Someone') + ' was added to the group', now)
        .run().catch(() => {});
      return json({ ok: true, status: 'approved' });
    } else {
      await env.DB.prepare("UPDATE room_join_requests SET status = 'rejected' WHERE id = ?").bind(request_id).run();
      return json({ ok: true, status: 'rejected' });
    }
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
