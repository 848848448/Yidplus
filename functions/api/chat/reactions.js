// functions/api/chat/reactions.js
// POST   /api/chat/reactions   -> { message_id, emoji } toggle a reaction (re-tapping the same emoji removes it)
// GET    /api/chat/reactions?room_id=xxx -> bulk reaction summary for all messages in a room

import { json, corsHeaders, requireUser, isAdminRole, isOwnerOrCoOwner } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

// Neither handler used to check the caller actually belonged to the room a
// message/reaction lives in — only that they were signed in — so anyone who
// learned a message_id or room_id (private DM or private group included)
// could react to it or read its reaction summary. Mirrors the access rules
// chat.js already applies when reading messages themselves.
async function canAccessRoom(env, room, userId) {
  if (!room) return false;
  const isMember = await env.DB.prepare(
    'SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?'
  ).bind(room.id, userId).first().catch(() => null);
  if (isMember) return true;
  const user = await env.DB.prepare('SELECT id, email, role FROM users WHERE id = ?').bind(userId).first().catch(() => null);
  if (room.type === 'private') return isOwnerOrCoOwner(user, env.OWNER_EMAIL);
  if (room.type === 'group' && room.visibility === 'private') return isAdminRole(user, env.OWNER_EMAIL);
  return true; // public group/channel — visible without membership, as elsewhere
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const body = await request.json();
    const { message_id, emoji } = body;
    if (!message_id || !emoji) return json({ ok: false, error: 'message_id and emoji are required' }, 400);

    const msgRoom = await env.DB.prepare(
      `SELECT r.id, r.type, r.visibility FROM messages m JOIN rooms r ON r.id = m.room_id WHERE m.id = ?`
    ).bind(message_id).first().catch(() => null);
    if (!msgRoom) return json({ ok: false, error: 'Message not found' }, 404);
    if (!(await canAccessRoom(env, msgRoom, user.id))) return json({ ok: false, error: 'Forbidden' }, 403);

    const existing = await env.DB.prepare(
      `SELECT emoji FROM message_reactions WHERE message_id = ? AND user_id = ?`
    ).bind(message_id, user.id).first();

    if (existing && existing.emoji === emoji) {
      // Tapping the same emoji again removes the reaction.
      await env.DB.prepare(`DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?`)
        .bind(message_id, user.id).run();
    } else {
      // Either a fresh reaction or switching to a different emoji — upsert.
      await env.DB.prepare(
        `INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(message_id, user_id) DO UPDATE SET emoji = excluded.emoji, created_at = excluded.created_at`
      ).bind(message_id, user.id, emoji, new Date().toISOString()).run();
    }

    const { results } = await env.DB.prepare(
      `SELECT emoji, user_id FROM message_reactions WHERE message_id = ?`
    ).bind(message_id).all();

    const counts = {};
    results.forEach(r => { counts[r.emoji] = (counts[r.emoji] || 0) + 1; });

    return json({ ok: true, reactions: counts, my_reaction: results.find(r => r.user_id === user.id)?.emoji || null });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env).catch(() => null);
    const url = new URL(request.url);
    const roomId = url.searchParams.get('room_id');
    if (!roomId) return json({ ok: false, error: 'room_id is required' }, 400);

    const room = await env.DB.prepare('SELECT id, type, visibility FROM rooms WHERE id = ?').bind(roomId).first().catch(() => null);
    if (!user || !(await canAccessRoom(env, room, user.id))) return json({ ok: false, error: 'Forbidden' }, 403);

    const { results } = await env.DB.prepare(
      `SELECT mr.message_id, mr.emoji, mr.user_id
       FROM message_reactions mr
       JOIN messages m ON m.id = mr.message_id
       WHERE m.room_id = ?`
    ).bind(roomId).all();

    const byMessage = {};
    for (const r of results) {
      if (!byMessage[r.message_id]) byMessage[r.message_id] = { counts: {}, my_reaction: null };
      byMessage[r.message_id].counts[r.emoji] = (byMessage[r.message_id].counts[r.emoji] || 0) + 1;
      if (user && r.user_id === user.id) byMessage[r.message_id].my_reaction = r.emoji;
    }

    return json({ ok: true, reactions: byMessage });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
                 }
