// functions/api/chat.js
// GET    /api/chat?room_id=xxx  -> list messages for a room (auto-joins user to room)
// POST   /api/chat              -> send a message (json or multipart)
// PUT    /api/chat              -> { id, text } edit own message (sets edited_at)
//                                   OR { id, opened: true } mark a view-once message as opened
// DELETE /api/chat?id=xxx       -> delete a message (own message or admin)

import { json, corsHeaders, requireUser, isAdminRole, isOwnerOrCoOwner, canDeleteContent, logAudit } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPut(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const body = await request.json();
    if (!body.id) return json({ ok: false, error: 'id is required' }, 400);

    const msg = await env.DB.prepare(`SELECT sender_id, view_once, opened FROM messages WHERE id = ?`).bind(body.id).first();
    if (!msg) return json({ ok: false, error: 'Message not found' }, 404);

    // ── Mark a view-once message as opened (any recipient can trigger this) ──
    if (body.opened === true) {
      if (!msg.opened) {
        await env.DB.prepare(`UPDATE messages SET opened = 1 WHERE id = ?`).bind(body.id).run();
      }
      return json({ ok: true });
    }

    // ── Edit message text (sender only) ──
    if (typeof body.text === 'string') {
      if (msg.sender_id !== user.id) return json({ ok: false, error: 'You can only edit your own messages' }, 403);
      const newText = body.text.trim();
      if (!newText) return json({ ok: false, error: 'Message text cannot be empty' }, 400);

      await env.DB.prepare(`UPDATE messages SET text = ?, edited_at = ? WHERE id = ?`)
        .bind(newText, new Date().toISOString(), body.id).run();

      return json({ ok: true });
    }

    return json({ ok: false, error: 'No valid action specified' }, 400);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const url = new URL(request.url);
    const searchQ = url.searchParams.get('search');
    const roomId  = url.searchParams.get('room_id');

    // ── Search mode: look across every room the user is a member of ──
    if (searchQ && searchQ.trim()) {
      // Only the two owner accounts can search across EVERY room, including
      // private DMs between other people. Everyone else — regular members
      // and moderators alike — only searches rooms they're actually in.
      const isOwner = isOwnerOrCoOwner(user, env.OWNER_EMAIL);
      let rows;
      if (isOwner) {
        rows = await env.DB.prepare(
          `SELECT m.id, m.room_id, m.sender_nick, m.text, m.created_at, r.name as room_name, r.type as room_type
           FROM messages m JOIN rooms r ON r.id = m.room_id
           WHERE m.text LIKE ? AND m.type = 'text'
           ORDER BY m.created_at DESC LIMIT 50`
        ).bind('%' + searchQ.trim() + '%').all();
      } else {
        rows = await env.DB.prepare(
          `SELECT m.id, m.room_id, m.sender_nick, m.text, m.created_at, r.name as room_name, r.type as room_type
           FROM messages m
           JOIN rooms r ON r.id = m.room_id
           JOIN room_members rm ON rm.room_id = m.room_id AND rm.user_id = ?
           WHERE m.text LIKE ? AND m.type = 'text'
           ORDER BY m.created_at DESC LIMIT 50`
        ).bind(user.id, '%' + searchQ.trim() + '%').all();
      }
      return json({ ok: true, messages: rows.results || [] });
    }

    if (!roomId) return json({ ok: false, error: 'room_id is required' }, 400);

    // Fetch room type up front — needed to decide access below.
    const roomInfo = await env.DB.prepare('SELECT type FROM rooms WHERE id = ?').bind(roomId).first().catch(() => null);

    const isOwner = isOwnerOrCoOwner(user, env.OWNER_EMAIL);
    const isAdmin = isAdminRole(user, env.OWNER_EMAIL);
    const isMember = await env.DB.prepare(
      'SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?'
    ).bind(roomId, user.id).first();

    if (roomInfo && roomInfo.type === 'private' && !isMember) {
      // Private 1-on-1 DM the caller isn't part of — only the two owner
      // accounts may spectate it for moderation. Regular moderators
      // (admin_limited / admin_super) are explicitly excluded, even though
      // they can god-mode into groups/channels.
      if (!isOwner) return json({ ok: false, error: 'Forbidden' }, 403);
    } else if (!isAdmin) {
      // Regular member touching a group/channel — auto-join as before.
      await ensureMember(env, roomId, user.id);
    }

    // Increment view count for channel messages
    if (roomInfo && roomInfo.type === 'channel') {
      await env.DB.prepare('UPDATE messages SET view_count = view_count + 1 WHERE room_id = ?').bind(roomId).run().catch(() => {});
    }

    const topicId = url.searchParams.get('topic_id');
    let topicFilter = '';
    let topicParams = [];
    if (topicId === 'general') {
      topicFilter = ' AND m.topic_id IS NULL';
    } else if (topicId) {
      topicFilter = ' AND m.topic_id = ?';
      topicParams = [topicId];
    }

    let results;
    try {
      const res = await env.DB.prepare(
        `SELECT m.id, m.room_id, m.sender_id, m.sender_nick, m.type, m.text, m.media_key,
                m.reply_to_id, m.view_once, m.opened, m.edited_at, m.created_at, m.read, m.topic_id,
                u.photo_url as sender_photo, rm.title as sender_title
         FROM messages m
         LEFT JOIN users u ON u.id = m.sender_id
         LEFT JOIN room_members rm ON rm.room_id = m.room_id AND rm.user_id = m.sender_id
         WHERE m.room_id = ?${topicFilter}
         ORDER BY m.created_at ASC
         LIMIT 200`
      ).bind(roomId, ...topicParams).all();
      results = res.results;
    } catch (colErr) {
      // topic_id column doesn't exist yet (migration not run) — fall back to
      // the pre-topics query so normal chat keeps working regardless.
      const res = await env.DB.prepare(
        `SELECT m.id, m.room_id, m.sender_id, m.sender_nick, m.type, m.text, m.media_key,
                m.reply_to_id, m.view_once, m.opened, m.edited_at, m.created_at, m.read,
                u.photo_url as sender_photo
         FROM messages m
         LEFT JOIN users u ON u.id = m.sender_id
         WHERE m.room_id = ?
         ORDER BY m.created_at ASC
         LIMIT 200`
      ).bind(roomId).all();
      results = res.results;
    }

    // Group "Seen by N" — compare each member's last_read_at to each message's
    // created_at. Requires the last_read_at column on room_members; if that
    // migration hasn't been run yet, this simply yields no seen counts.
    let memberReads = [];
    if (roomInfo && roomInfo.type === 'group') {
      const memberRes = await env.DB.prepare(
        `SELECT user_id, last_read_at FROM room_members WHERE room_id = ?`
      ).bind(roomId).all().catch(() => ({ results: [] }));
      memberReads = (memberRes.results || []).filter(m => m.last_read_at);
    }

    const out = results.map(row => {
      if (row.media_key) row.media_url = `/api/media/${encodeURIComponent(row.media_key)}`;
      if (memberReads.length) {
        row.seen_count = memberReads.filter(
          m => m.user_id !== row.sender_id && m.last_read_at >= row.created_at
        ).length;
      }
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
    let roomId, type, text, replyToId, file, viewOnce, topicId;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      roomId    = form.get('room_id');
      type      = form.get('type') || 'media';
      text      = form.get('text') || '';
      replyToId = form.get('reply_to_id') || null;
      file      = form.get('file');
      viewOnce  = form.get('view_once') === 'true' || form.get('view_once') === '1';
      topicId   = form.get('topic_id') || null;
    } else {
      const body = await request.json();
      roomId    = body.room_id;
      type      = body.type || 'text';
      text      = body.text || '';
      replyToId = body.reply_to_id || null;
      viewOnce  = !!body.view_once;
      topicId   = body.topic_id || null;
    }

    if (!roomId) return json({ ok: false, error: 'room_id is required' }, 400);

    // For private DMs: if either side has blocked the other, sending is disallowed.
    const room = await env.DB.prepare(`SELECT type, read_only FROM rooms WHERE id = ?`).bind(roomId).first();
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

    // Read-only groups: only the group's sub-admins and Super Admins may post.
    if (room && room.type === 'group' && room.read_only) {
      const isSuper = isAdminRole(user, env.OWNER_EMAIL);
      if (!isSuper) {
        const membership = await env.DB.prepare(
          `SELECT is_group_admin FROM room_members WHERE room_id = ? AND user_id = ?`
        ).bind(roomId, user.id).first();
        if (!membership || !membership.is_group_admin) {
          return json({ ok: false, error: 'This group is read-only. Only admins can post.' }, 403);
        }
      }
    }

    let mediaKey = null;
    if (file && typeof file === 'object' && file.arrayBuffer) {
      const ext = (file.name && file.name.includes('.')) ? file.name.split('.').pop() : 'bin';
      mediaKey = `chat/${roomId}/${Date.now()}_${crypto.randomUUID()}.${ext}`;
      try {
        await env.MY_BUCKET.put(mediaKey, await file.arrayBuffer(), {
          httpMetadata: { contentType: file.type || 'application/octet-stream' },
        });
      } catch (uploadErr) {
        return json({ ok: false, error: 'Media upload failed: ' + uploadErr.message }, 500);
      }
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      await env.DB.prepare(
        `INSERT INTO messages
           (id, room_id, sender_id, sender_nick, type, text, media_key, reply_to_id, view_once, opened, created_at, read, topic_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?)`
      ).bind(id, roomId, user.id, user.nickname || '', type, text, mediaKey, replyToId, viewOnce ? 1 : 0, now, topicId).run();
    } catch (insertErr) {
      // The topic_id column may not exist yet if the migration hasn't been
      // run — fall back to inserting without it rather than failing the
      // whole send.
      await env.DB.prepare(
        `INSERT INTO messages
           (id, room_id, sender_id, sender_nick, type, text, media_key, reply_to_id, view_once, opened, created_at, read)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0)`
      ).bind(id, roomId, user.id, user.nickname || '', type, text, mediaKey, replyToId, viewOnce ? 1 : 0, now).run();
    }

    const result = {
      id, room_id: roomId, sender_id: user.id, sender_nick: user.nickname || '',
      type, text, media_key: mediaKey, reply_to_id: replyToId, view_once: viewOnce ? 1 : 0, opened: 0,
      created_at: now, read: 0, topic_id: topicId,
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
