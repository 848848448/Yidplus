// functions/api/admin/rooms.js
// GET /api/admin/rooms -> list ALL rooms with member count + last message preview
// Requires admin role. Used by the "Chat Watch" admin panel.

import { json, corsHeaders, requireUser, isAdminRole } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const { results: rooms } = await env.DB.prepare(
      `SELECT id, type, name, emoji, created_at FROM rooms ORDER BY created_at DESC LIMIT 100`
    ).all();

    const out = [];
    for (const r of rooms) {
      const memberRow = await env.DB.prepare(
        `SELECT COUNT(*) AS c FROM room_members WHERE room_id = ?`
      ).bind(r.id).first();

      const lastMsg = await env.DB.prepare(
        `SELECT text, type, sender_nick, created_at FROM messages
         WHERE room_id = ? ORDER BY created_at DESC LIMIT 1`
      ).bind(r.id).first();

      let name = r.name;
      if (r.type === 'private') {
        const { results: members } = await env.DB.prepare(
          `SELECT u.nickname FROM room_members rm JOIN users u ON u.id = rm.user_id WHERE rm.room_id = ?`
        ).bind(r.id).all();
        name = members.map(m => '@' + m.nickname).join(' & ') || 'Private Chat';
      }

      out.push({
        id: r.id,
        type: r.type,
        name,
        emoji: r.emoji || (r.type === 'group' ? '👥' : '👤'),
        members: memberRow ? memberRow.c : 0,
        preview: lastMsg ? (lastMsg.sender_nick + ': ' + (lastMsg.type === 'text' ? lastMsg.text : '[' + lastMsg.type + ']')) : '(no messages)',
        created_at: r.created_at,
      });
    }

    return json({ ok: true, rooms: out });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
