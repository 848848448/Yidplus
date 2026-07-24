// functions/api/chat.js
// GET    /api/chat?room_id=xxx  -> list messages for a room (auto-joins user to room)
// POST   /api/chat              -> send a message (json or multipart)
// PUT    /api/chat              -> { id, text } edit own message (sets edited_at)
//                                   OR { id, opened: true } mark a view-once message as opened
// DELETE /api/chat?id=xxx       -> delete a message (own message or admin)

import { json, corsHeaders, requireUser, isAdminRole, isOwnerOrCoOwner, canDeleteContent, logAudit } from './_helpers.js';
import { sendWebPush } from './_webpush.js';

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
    const url = new URL(request.url);
    const searchQ = url.searchParams.get('search');
    const roomId  = url.searchParams.get('room_id');

    if (!user) {
      // Guest read-only access to FEATURED groups only (Guest Mode).
      const gm = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'guest_mode'").first().catch(() => null);
      if (!(gm && gm.value === 'true')) return json({ ok: false, error: 'Not signed in' }, 401);
      if (!roomId) return json({ ok: true, messages: [] });
      const room = await env.DB.prepare(`SELECT id, type, featured FROM rooms WHERE id = ?`).bind(roomId).first().catch(() => null);
      if (!room || room.type !== 'group' || !room.featured) {
        return json({ ok: false, error: 'Sign in to view this chat' }, 403);
      }
      const nowIso = new Date().toISOString();
      // NOTE: these column names must match the real schema — sender_nick lives
      // on messages, and it's reply_to_id / edited_at (not reply_to / edited).
      // Getting them wrong makes the query throw and every guest sees an empty
      // room.
      let gMsgs = [];
      try {
        const r1 = await env.DB.prepare(
          `SELECT m.id, m.room_id, m.sender_id, m.sender_nick, m.type, m.text, m.media_key,
                  m.reply_to_id, m.view_once, m.opened, m.edited_at, m.created_at, m.topic_id,
                  u.photo_url AS sender_photo
           FROM messages m LEFT JOIN users u ON u.id = m.sender_id
           WHERE m.room_id = ? AND COALESCE(m.hidden,0) = 0
             AND (m.scheduled_for IS NULL OR m.scheduled_for <= ?)
             AND (m.expires_at IS NULL OR m.expires_at > ?)
           ORDER BY m.created_at ASC LIMIT 200`
        ).bind(roomId, nowIso, nowIso).all();
        gMsgs = r1.results || [];
      } catch (e) {
        // Older DB without hidden/scheduled/expires columns.
        const r2 = await env.DB.prepare(
          `SELECT m.id, m.room_id, m.sender_id, m.sender_nick, m.type, m.text, m.media_key,
                  m.reply_to_id, m.view_once, m.opened, m.created_at,
                  u.photo_url AS sender_photo
           FROM messages m LEFT JOIN users u ON u.id = m.sender_id
           WHERE m.room_id = ? ORDER BY m.created_at ASC LIMIT 200`
        ).bind(roomId).all().catch(() => ({ results: [] }));
        gMsgs = r2.results || [];
      }
      const guestMsgs = (gMsgs || []).map(function (r) {
        if (r.media_key) r.media_url = '/api/media/' + encodeURIComponent(r.media_key);
        return r;
      });
      return json({ ok: true, messages: guestMsgs, guest_view: true });
    }

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
    const roomInfo = await env.DB.prepare('SELECT type, visibility FROM rooms WHERE id = ?').bind(roomId).first().catch(() =>
      env.DB.prepare('SELECT type FROM rooms WHERE id = ?').bind(roomId).first().catch(() => null)
    );

    const isOwner = isOwnerOrCoOwner(user, env.OWNER_EMAIL);
    const isAdmin = isAdminRole(user, env.OWNER_EMAIL);

    // Admin-disabled rooms are invisible to regular users.
    if (!isAdmin) {
      const off = await env.DB.prepare('SELECT 1 FROM disabled_rooms WHERE room_id = ?').bind(roomId).first().catch(() => null);
      if (off) return json({ ok: false, error: 'This group is unavailable.' }, 403);
    }

    const isMember = await env.DB.prepare(
      'SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?'
    ).bind(roomId, user.id).first();

    if (roomInfo && roomInfo.type === 'private' && !isMember) {
      // Private 1-on-1 DM the caller isn't part of — only the two owner
      // accounts may spectate it for moderation. Regular moderators
      // (admin_limited / admin_super) are explicitly excluded, even though
      // they can god-mode into groups/channels.
      if (!isOwner) return json({ ok: false, error: 'Forbidden' }, 403);
    } else if (roomInfo && roomInfo.type === 'group' && roomInfo.visibility === 'private' && !isMember && !isAdmin) {
      // Private (invite-only) group — do NOT auto-join. A non-member can only
      // get in through the invite/join flow, which enforces the invite code.
      return json({ ok: false, error: 'This is a private group. You need an invite to join.' }, 403);
    } else if (!isAdmin) {
      // Regular member touching a PUBLIC group/channel — auto-join as before.
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
                m.scheduled_for, m.expires_at,
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

    // ── Scheduled + disappearing messages ──
    // These use the scheduled_for / expires_at columns, which may be absent on
    // an un-migrated DB — in that case the fields are simply undefined and the
    // checks below are no-ops, so normal chat is unaffected.
    // Auto-moderated / hidden messages: fetched separately so we never touch the
    // main SELECTs (keeps un-migrated DBs working). Admins still see them for review.
    let hiddenIds = new Set();
    if (!isAdmin) {
      const hr = await env.DB.prepare(
        'SELECT id FROM messages WHERE room_id = ? AND hidden = 1'
      ).bind(roomId).all().catch(() => ({ results: [] }));
      hiddenIds = new Set((hr.results || []).map(function (r) { return r.id; }));
    }

    const nowMs = Date.now();
    const senderId = user.id;
    results = results.filter(function (m) {
      if (hiddenIds.has(m.id)) return false;
      // A scheduled message stays hidden until its time — but its own author
      // always sees it (so they can tell it's queued).
      if (m.scheduled_for) {
        const relMs = new Date(m.scheduled_for).getTime();
        if (!isNaN(relMs) && relMs > nowMs && m.sender_id !== senderId) return false;
      }
      // An expired disappearing message is hidden for everyone.
      if (m.expires_at) {
        const expMs = new Date(m.expires_at).getTime();
        if (!isNaN(expMs) && expMs <= nowMs) return false;
      }
      return true;
    });
    // Mark scheduled-but-still-pending messages so the client can badge them.
    results.forEach(function (m) {
      if (m.scheduled_for && new Date(m.scheduled_for).getTime() > nowMs) m._scheduled_pending = 1;
    });
    // Best-effort: physically delete messages that have already expired, so the
    // table doesn't accumulate them. Never blocks the response.
    context.waitUntil(
      env.DB.prepare(`DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at <= ?`)
        .bind(new Date().toISOString()).run().catch(() => {})
    );
    // created_at. Requires the last_read_at column on room_members; if that
    // migration hasn't been run yet, this simply yields no seen counts.
    let memberReads = [];
    if (roomInfo && roomInfo.type === 'group') {
      const memberRes = await env.DB.prepare(
        `SELECT user_id, last_read_at FROM room_members WHERE room_id = ?`
      ).bind(roomId).all().catch(() => ({ results: [] }));
      memberReads = (memberRes.results || []).filter(m => m.last_read_at);
    }

    // Reply counts: how many messages in this room reply to each message,
    // so we can show a "X replied" thread indicator. Computed with a single
    // GROUP BY over the already-loaded room, not per-message.
    const replyCounts = {};
    results.forEach(row => {
      if (row.reply_to_id) replyCounts[row.reply_to_id] = (replyCounts[row.reply_to_id] || 0) + 1;
    });

    const out = results.map(row => {
      if (row.media_key) row.media_url = `/api/media/${encodeURIComponent(row.media_key)}`;
      if (memberReads.length) {
        row.seen_count = memberReads.filter(
          m => m.user_id !== row.sender_id && m.last_read_at >= row.created_at
        ).length;
      }
      if (replyCounts[row.id]) row.reply_count = replyCounts[row.id];
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
    let roomId, type, text, replyToId, file, viewOnce, topicId, scheduledFor, disappearSeconds;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      roomId    = form.get('room_id');
      type      = form.get('type') || 'media';
      text      = form.get('text') || '';
      replyToId = form.get('reply_to_id') || null;
      file      = form.get('file');
      viewOnce  = form.get('view_once') === 'true' || form.get('view_once') === '1';
      topicId   = form.get('topic_id') || null;
      scheduledFor = form.get('scheduled_for') || null;
      disappearSeconds = parseInt(form.get('disappear_seconds') || '0', 10) || 0;
    } else {
      const body = await request.json();
      roomId    = body.room_id;
      type      = body.type || 'text';
      text      = body.text || '';
      replyToId = body.reply_to_id || null;
      viewOnce  = !!body.view_once;
      topicId   = body.topic_id || null;
      scheduledFor = body.scheduled_for || null;
      disappearSeconds = parseInt(body.disappear_seconds || 0, 10) || 0;
    }

    // Validate scheduled time: must be a valid future ISO timestamp, at most
    // 30 days out. Anything invalid or in the past is treated as "send now".
    if (scheduledFor) {
      const t = new Date(scheduledFor).getTime();
      const maxAhead = Date.now() + 30 * 24 * 60 * 60 * 1000;
      if (isNaN(t) || t <= Date.now() || t > maxAhead) scheduledFor = null;
    }
    // Expiry window for disappearing messages: cap between 0 and 7 days.
    if (disappearSeconds < 0) disappearSeconds = 0;
    if (disappearSeconds > 7 * 24 * 60 * 60) disappearSeconds = 7 * 24 * 60 * 60;

    if (!roomId) return json({ ok: false, error: 'room_id is required' }, 400);

    // For private DMs: if either side has blocked the other, sending is disallowed.
    const room = await env.DB.prepare(`SELECT type, read_only, visibility FROM rooms WHERE id = ?`).bind(roomId).first();
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

    // Private (invite-only) group: only existing members (or admins) may post.
    if (room && room.type === 'group' && room.visibility === 'private' && !isAdminRole(user, env.OWNER_EMAIL)) {
      const already = await env.DB.prepare(
        'SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?'
      ).bind(roomId, user.id).first();
      if (!already) return json({ ok: false, error: 'This is a private group. You need an invite to join.' }, 403);
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

    // For a disappearing message, compute when it expires (from now, or from
    // its scheduled release time if it's also scheduled).
    let expiresAt = null;
    if (disappearSeconds > 0) {
      const base = scheduledFor ? new Date(scheduledFor).getTime() : Date.now();
      expiresAt = new Date(base + disappearSeconds * 1000).toISOString();
    }

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

    // Store scheduling / expiry in their own columns if they exist. Done as a
    // best-effort follow-up UPDATE so a not-yet-migrated DB still sends fine.
    if (scheduledFor || expiresAt) {
      await env.DB.prepare('UPDATE messages SET scheduled_for = ?, expires_at = ? WHERE id = ?')
        .bind(scheduledFor, expiresAt, id).run().catch(() => {});
    }

    const result = {
      id, room_id: roomId, sender_id: user.id, sender_nick: user.nickname || '',
      type, text, media_key: mediaKey, reply_to_id: replyToId, view_once: viewOnce ? 1 : 0, opened: 0,
      created_at: now, read: 0, topic_id: topicId,
    };
    if (mediaKey) result.media_url = `/api/media/${encodeURIComponent(mediaKey)}`;

    // Fire push notifications to recipients in the background — never let
    // this delay or break the send itself.
    context.waitUntil((async () => {
      try {
        const roomRow = await env.DB.prepare('SELECT type, name FROM rooms WHERE id = ?').bind(roomId).first();
        if (!roomRow) return;

        let recipientIds = [];
        if (roomRow.type === 'private') {
          const other = await env.DB.prepare(
            'SELECT user_id FROM room_members WHERE room_id = ? AND user_id != ?'
          ).bind(roomId, user.id).first();
          if (other) recipientIds = [other.user_id];
        } else if (roomRow.type === 'group') {
          let members;
          try {
            const res = await env.DB.prepare(
              'SELECT user_id FROM room_members WHERE room_id = ? AND user_id != ? AND (muted IS NULL OR muted = 0)'
            ).bind(roomId, user.id).all();
            members = res.results;
          } catch (e) {
            const res = await env.DB.prepare(
              'SELECT user_id FROM room_members WHERE room_id = ? AND user_id != ?'
            ).bind(roomId, user.id).all();
            members = res.results;
          }
          recipientIds = members.map(m => m.user_id);
        }
        if (!recipientIds.length) return;

        const placeholders = recipientIds.map(() => '?').join(',');
        const { results: subs } = await env.DB.prepare(
          `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id IN (${placeholders})`
        ).bind(...recipientIds).all();

        const notifText = type === 'text' ? text.slice(0, 100) : `[${type}]`;
        const notifTitle = roomRow.type === 'group' ? (roomRow.name || 'Group') : (user.nickname || 'New message');
        const notifBody = roomRow.type === 'group' ? `${user.nickname || 'Someone'}: ${notifText}` : notifText;

        for (const sub of subs) {
          try {
            await sendWebPush(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              { title: notifTitle, body: notifBody, icon: '/images/logo.png', badge: '/images/logo.png', url: '/chat', tag: 'yidplus-msg-' + roomId },
              env
            );
          } catch (e) { /* one bad subscription shouldn't stop the rest */ }
        }
      } catch (e) { /* never let notification failures affect the message send */ }
    })());

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
