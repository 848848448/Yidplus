// functions/api/chat/topics.js
// GET    /api/chat/topics?room_id=X    -> list topics for a group, each with last message + unread count
// POST   /api/chat/topics              -> create a topic { room_id, name, emoji }
// PUT    /api/chat/topics              -> rename/close a topic { id, name?, emoji?, closed? } (group admin only)
// DELETE /api/chat/topics?id=X         -> delete a topic and its messages (group admin only)

import { json, corsHeaders, requireUser } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

async function _isGroupAdminOrOwner(env, user, roomId) {
  const room = await env.DB.prepare('SELECT created_by FROM rooms WHERE id = ?').bind(roomId).first();
  if (!room) return false;
  if (room.created_by === user.id) return true;
  const membership = await env.DB.prepare(
    'SELECT is_group_admin FROM room_members WHERE room_id = ? AND user_id = ?'
  ).bind(roomId, user.id).first();
  return !!(membership && membership.is_group_admin);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const url = new URL(request.url);
    const roomId = url.searchParams.get('room_id');
    if (!roomId) return json({ ok: false, error: 'room_id is required' }, 400);

    const { results: topics } = await env.DB.prepare(
      `SELECT id, room_id, name, emoji, created_by, created_at, closed FROM topics
       WHERE room_id = ? ORDER BY created_at ASC`
    ).bind(roomId).all();

    // Batch-fetch last message + unread count per topic (including the
    // virtual "General" topic, represented by topic_id IS NULL).
    const topicIds = topics.map(t => t.id);
    const lastMsgByTopic = {};
    const unreadByTopic = {};

    async function fillFor(topicId, whereClause, bindArgs) {
      const lastMsg = await env.DB.prepare(
        `SELECT text, type, sender_nick, created_at FROM messages
         WHERE room_id = ? AND ${whereClause} ORDER BY created_at DESC LIMIT 1`
      ).bind(...bindArgs).first();
      const unread = await env.DB.prepare(
        `SELECT COUNT(*) AS c FROM messages
         WHERE room_id = ? AND ${whereClause} AND sender_id != ? AND read = 0`
      ).bind(...bindArgs, user.id).first();
      lastMsgByTopic[topicId] = lastMsg || null;
      unreadByTopic[topicId] = unread ? unread.c : 0;
    }

    // General (no topic assigned)
    await fillFor('general', 'topic_id IS NULL', [roomId]);
    for (const t of topics) {
      await fillFor(t.id, 'topic_id = ?', [roomId, t.id]);
    }

    const out = topics.map(t => ({
      id: t.id,
      room_id: t.room_id,
      name: t.name,
      emoji: t.emoji || '💬',
      created_by: t.created_by,
      created_at: t.created_at,
      closed: !!t.closed,
      preview: lastMsgByTopic[t.id] ? (lastMsgByTopic[t.id].type === 'text' ? lastMsgByTopic[t.id].text : '[' + lastMsgByTopic[t.id].type + ']') : '',
      last_time: lastMsgByTopic[t.id] ? lastMsgByTopic[t.id].created_at : t.created_at,
      unread: unreadByTopic[t.id],
    }));

    // Only surface "General" as a pseudo-topic if it actually has messages,
    // so a freshly topic-enabled group doesn't show a confusing empty one.
    if (lastMsgByTopic.general) {
      out.unshift({
        id: null,
        room_id: roomId,
        name: 'General',
        emoji: '💬',
        created_by: null,
        created_at: null,
        closed: false,
        preview: lastMsgByTopic.general.type === 'text' ? lastMsgByTopic.general.text : '[' + lastMsgByTopic.general.type + ']',
        last_time: lastMsgByTopic.general.created_at,
        unread: unreadByTopic.general,
      });
    }

    return json({ ok: true, topics: out });
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
    const roomId = body.room_id;
    const name = (body.name || '').trim();
    if (!roomId || !name) return json({ ok: false, error: 'room_id and name are required' }, 400);
    if (name.length > 40) return json({ ok: false, error: 'Topic name is too long' }, 400);

    const isMember = await env.DB.prepare(
      'SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?'
    ).bind(roomId, user.id).first();
    if (!isMember) return json({ ok: false, error: 'You must be a member of this group' }, 403);

    // A regular group does NOT have Topics by default, and it should never
    // get silently switched into Topics-mode just because some member
    // clicked the option once. Only a group admin/owner is allowed to turn
    // Topics on for a group (by creating its first topic). Once it's on,
    // any member can add further topics to it.
    let hasTopicsAlready = false;
    try {
      const room = await env.DB.prepare('SELECT has_topics FROM rooms WHERE id = ?').bind(roomId).first();
      hasTopicsAlready = !!(room && room.has_topics);
    } catch (e) { hasTopicsAlready = false; }

    if (!hasTopicsAlready) {
      const isAdminHere = await _isGroupAdminOrOwner(env, user, roomId);
      if (!isAdminHere) {
        return json({ ok: false, error: 'Only a group admin can turn on Topics for this group' }, 403);
      }
    }

    const topicId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO topics (id, room_id, name, emoji, created_by, created_at, closed)
       VALUES (?, ?, ?, ?, ?, ?, 0)`
    ).bind(topicId, roomId, name, body.emoji || '💬', user.id, now).run();

    // Mark the room as topic-enabled the first time a topic is created.
    await env.DB.prepare('UPDATE rooms SET has_topics = 1 WHERE id = ?').bind(roomId).run().catch(() => {});

    return json({ ok: true, topic: { id: topicId, room_id: roomId, name, emoji: body.emoji || '💬', created_at: now } });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const body = await request.json();
    if (!body.id) return json({ ok: false, error: 'id is required' }, 400);

    const topic = await env.DB.prepare('SELECT room_id FROM topics WHERE id = ?').bind(body.id).first();
    if (!topic) return json({ ok: false, error: 'Topic not found' }, 404);
    if (!(await _isGroupAdminOrOwner(env, user, topic.room_id))) {
      return json({ ok: false, error: 'Only group admins can edit topics' }, 403);
    }

    const updates = []; const params = [];
    if (typeof body.name === 'string' && body.name.trim()) { updates.push('name = ?'); params.push(body.name.trim()); }
    if (typeof body.emoji === 'string') { updates.push('emoji = ?'); params.push(body.emoji); }
    if (typeof body.closed === 'boolean') { updates.push('closed = ?'); params.push(body.closed ? 1 : 0); }
    if (!updates.length) return json({ ok: true });

    params.push(body.id);
    await env.DB.prepare(`UPDATE topics SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return json({ ok: false, error: 'id is required' }, 400);

    const topic = await env.DB.prepare('SELECT room_id FROM topics WHERE id = ?').bind(id).first();
    if (!topic) return json({ ok: false, error: 'Topic not found' }, 404);
    if (!(await _isGroupAdminOrOwner(env, user, topic.room_id))) {
      return json({ ok: false, error: 'Only group admins can delete topics' }, 403);
    }

    await env.DB.prepare('DELETE FROM messages WHERE topic_id = ?').bind(id).run().catch(() => {});
    await env.DB.prepare('DELETE FROM topics WHERE id = ?').bind(id).run();
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
