// functions/api/chat.js
// GET    /api/chat?room_id=xxx  -> list messages for a room (auto-joins user to room)
// POST   /api/chat              -> send a message (json or multipart)
// DELETE /api/chat?id=xxx       -> delete a message (own message or admin)

import { json, corsHeaders, requireUser, isAdminRole, canDeleteContent, logAudit } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const url = new URL(request.url);
    const roomId = url.searchParams.get('room_id');
    if (!roomId) return json({ ok: false, error: 'room_id is required' }, 400);

    // Admins can view ANY room (including private DMs) without joining it.
    // Regular users get auto-joined to public rooms they touch.
    if (!isAdminRole(user, env.OWNER_EMAIL)) {
      await ensureMember(env, roomId, user.id);
    }

    const { results } = await env.DB.prepare(
      `SELECT id, room_id, sender_id, sender_nick, type, text, media_key,
              reply_to_id, created_at, read
       FROM messages
       WHERE room_id = ?
       ORDER BY created_at ASC
       LIMIT 200`
    ).bind(roomId).all();

    const out = results.map(row => {
      if (row.media_key) row.media_url = `/api/media/${encodeURIComponent(row.media_key)}`;
      return row;
    });

    return json({ ok: true, messages: out });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const contentType = request.headers.get('content-type') || '';
    let roomId, type, text, replyToId, file;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      roomId    = form.get('room_id');
      type      = form.get('type') || 'media';
      text      = form.get('text') || '';
      replyToId = form.get('reply_to_id') || null;
      file      = form.get('file');
    } else {
      const body = await request.json();
      roomId    = body.room_id;
      type      = body.type || 'text';
      text      = body.text || '';
      replyToId = body.reply_to_id || null;
    }

    if (!roomId) return json({ ok: false, error: 'room_id is required' }, 400);

    // For private DMs: if either side has blocked the other, sending is disallowed.
    const room = await env.DB.prepare(`SELECT type FROM rooms WHERE id = ?`).bind(roomId).first();
    if (room && room.type === 'private') {
      const { results: members } = await env.DB.prepare(
        `SELECT user_id FROM room_members WHERE room_id = ? AND user_id != ?`
      ).bind(roomId, user.id).all();
      const otherId = members[0] && members[0].user_id;
      if (otherId) {
        const isBlocked = await env.DB.prepare(
          `SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`
        ).bind(user.id, otherId, otherId, user.id).first();
        if (isBlocked) return json({ ok: false, error: 'You cannot message this user.' }, 403);
      }
    }

    await ensureMember(env, roomId, user.id);

    let mediaKey = null;
    if (file && typeof file === 'object' && file.arrayBuffer) {
      const ext = (file.name && file.name.includes('.')) ? file.name.split('.').pop() : 'bin';
      mediaKey = `chat/${roomId}/${Date.now()}_${crypto.randomUUID()}.${ext}`;
      await env.MY_BUCKET.put(mediaKey, await file.arrayBuffer(), {
        httpMetadata: { contentType: file.type || 'application/octet-stream' },
      });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO messages
         (id, room_id, sender_id, sender_nick, type, text, media_key, reply_to_id, created_at, read)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).bind(id, roomId, user.id, user.nickname || '', type, text, mediaKey, replyToId, now).run();

    const result = {
      id, room_id: roomId, sender_id: user.id, sender_nick: user.nickname || '',
      type, text, media_key: mediaKey, reply_to_id: replyToId,
      created_at: now, read: 0,
    };
    if (mediaKey) result.media_url = `/api/media/${encodeURIComponent(mediaKey)}`;

    return json({ ok: true, message: result }, 201);
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

    const row = await env.DB.prepare(
      `SELECT sender_id, media_key FROM messages WHERE id = ?`
    ).bind(id).first();

    if (!row) return json({ ok: false, error: 'Message not found' }, 404);

    if (!canDeleteContent(user, row.sender_id, env.OWNER_EMAIL)) {
      return json({ ok: false, error: 'Forbidden' }, 403);
    }

    if (row.media_key) await env.MY_BUCKET.delete(row.media_key);
    await env.DB.prepare(`DELETE FROM messages WHERE id = ?`).bind(id).run();

    if (user.id !== row.sender_id && isAdminRole(user, env.OWNER_EMAIL)) {
      await logAudit(env, user, 'delete_message', 'message', id, 'Deleted a message sent by another user');
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

// Auto-create membership row the first time a user touches a room
// (rooms themselves are created via /api/chat/rooms)
async function ensureMember(env, roomId, userId) {
  const exists = await env.DB.prepare(
    `SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?`
  ).bind(roomId, userId).first();

  if (!exists) {
    const room = await env.DB.prepare(`SELECT id FROM rooms WHERE id = ?`).bind(roomId).first();
    if (room) {
      await env.DB.prepare(
        `INSERT INTO room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)`
      ).bind(roomId, userId, new Date().toISOString()).run();
    }
  }
                         }
