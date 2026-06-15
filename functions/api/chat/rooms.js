// functions/api/chat/rooms.js
// GET  /api/chat/rooms          -> list rooms the current user is a member of,
//                                   plus the global default rooms everyone sees.
// POST /api/chat/rooms          -> create a room (group) or open/find a DM
//   Body for group: { type:'group', name, emoji }
//   Body for DM:    { type:'private', other_user_id }

import { json, corsHeaders, requireUser } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    // Rooms the user is a member of
    const { results: myRooms } = await env.DB.prepare(
      `SELECT r.id, r.type, r.name, r.emoji, r.created_at
       FROM rooms r
       JOIN room_members m ON m.room_id = r.id
       WHERE m.user_id = ?`
    ).bind(user.id).all();

    // Public group rooms not yet joined (so they show as "Tap to Join")
    const { results: publicRooms } = await env.DB.prepare(
      `SELECT r.id, r.type, r.name, r.emoji, r.created_at
       FROM rooms r
       WHERE r.type = 'group'
         AND r.id NOT IN (SELECT room_id FROM room_members WHERE user_id = ?)`
    ).bind(user.id).all();

    const allRoomIds = [...myRooms, ...publicRooms].map(r => r.id);
    const rooms = [];

    for (const r of [...myRooms, ...publicRooms]) {
      const joined = myRooms.some(m => m.id === r.id);

      // Last message preview
      const lastMsg = await env.DB.prepare(
        `SELECT text, type, sender_nick, created_at FROM messages
         WHERE room_id = ? ORDER BY created_at DESC LIMIT 1`
      ).bind(r.id).first();

      // Unread count (messages after user joined, not sent by user, not read)
      const unreadRow = await env.DB.prepare(
        `SELECT COUNT(*) AS c FROM messages
         WHERE room_id = ? AND sender_id != ? AND read = 0`
      ).bind(r.id, user.id).first();

      // Member count for groups
      let members = null;
      if (r.type === 'group') {
        const mc = await env.DB.prepare(
          `SELECT COUNT(*) AS c FROM room_members WHERE room_id = ?`
        ).bind(r.id).first();
        members = mc ? mc.c : 0;
      }

      // For DMs, resolve the other user's nickname + online status
      let nick = r.name;
      let online = false;
      if (r.type === 'private') {
        const other = await env.DB.prepare(
          `SELECT u.nickname, u.online FROM room_members rm
           JOIN users u ON u.id = rm.user_id
           WHERE rm.room_id = ? AND rm.user_id != ?`
        ).bind(r.id, user.id).first();
        if (other) { nick = other.nickname; online = !!other.online; }
      }

      rooms.push({
        id: r.id,
        type: r.type,
        nick,
        emoji: r.emoji || (r.type === 'group' ? '👥' : '👤'),
        joined,
        online,
        members,
        preview: lastMsg ? (lastMsg.type === 'text' ? lastMsg.text : '[' + lastMsg.type + ']') : '',
        unread: unreadRow ? unreadRow.c : 0,
        last_time: lastMsg ? lastMsg.created_at : r.created_at,
      });
    }

    rooms.sort((a, b) => new Date(b.last_time) - new Date(a.last_time));

    return json({ ok: true, rooms });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const body = await request.json();
    const now = new Date().toISOString();

    if (body.type === 'private') {
      const otherId = body.other_user_id;
      if (!otherId) return json({ ok: false, error: 'other_user_id is required' }, 400);

      // Find existing DM room between these two users
      const existing = await env.DB.prepare(
        `SELECT r.id FROM rooms r
         JOIN room_members m1 ON m1.room_id = r.id AND m1.user_id = ?
         JOIN room_members m2 ON m2.room_id = r.id AND m2.user_id = ?
         WHERE r.type = 'private'
         LIMIT 1`
      ).bind(user.id, otherId).first();

      if (existing) return json({ ok: true, room_id: existing.id });

      const roomId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO rooms (id, type, name, emoji, created_by, created_at) VALUES (?, 'private', '', '👤', ?, ?)`
      ).bind(roomId, user.id, now).run();

      await env.DB.prepare(
        `INSERT INTO room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)`
      ).bind(roomId, user.id, now).run();
      await env.DB.prepare(
        `INSERT INTO room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)`
      ).bind(roomId, otherId, now).run();

      return json({ ok: true, room_id: roomId }, 201);
    }

    // Group room
    const name  = (body.name || '').trim();
    const emoji = body.emoji || '👥';
    if (!name) return json({ ok: false, error: 'name is required' }, 400);

    const roomId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO rooms (id, type, name, emoji, created_by, created_at) VALUES (?, 'group', ?, ?, ?, ?)`
    ).bind(roomId, name, emoji, user.id, now).run();

    await env.DB.prepare(
      `INSERT INTO room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)`
    ).bind(roomId, user.id, now).run();

    return json({ ok: true, room_id: roomId }, 201);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
