// functions/api/chat/rooms.js
// GET  /api/chat/rooms          -> list rooms the current user is a member of,
//                                   plus PUBLIC group rooms not yet joined (join-first policy).
//                                   Super Admins additionally see ALL private groups (god-mode).
// POST /api/chat/rooms          -> create a room (group) or open/find a DM
//   Body for group: { type:'group', name, emoji, visibility:'public'|'private', read_only:bool }
//   Body for DM:    { type:'private', other_user_id }

import { json, corsHeaders, requireUser, isAdminRole } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const url = new URL(request.url);

    // ── Invite code lookup (for join link preview) ──
    const inviteCode = url.searchParams.get('invite');
    if (inviteCode) {
      const room = await env.DB.prepare(
        `SELECT r.id, r.type, r.name, r.emoji, r.photo_key,
                COUNT(rm.user_id) as members
         FROM rooms r
         LEFT JOIN room_members rm ON rm.room_id = r.id
         WHERE r.invite_code = ?
         GROUP BY r.id`
      ).bind(inviteCode).first().catch(() => null);
      if (!room) return json({ ok: false, error: 'Invalid invite link' }, 404);
      return json({ ok: true, room: {
        id: room.id,
        type: room.type,
        name: room.name,
        emoji: room.emoji,
        members: room.members || 0,
        photo_url: room.photo_key ? `/api/media/${encodeURIComponent(room.photo_key)}` : null,
      }});
    }

    const isAdmin = isAdminRole(user, env.OWNER_EMAIL);

    // Rooms the user is a member of
    const { results: myRooms } = await env.DB.prepare(
      `SELECT r.id, r.type, r.name, r.emoji, r.visibility, r.read_only, r.created_at,
              r.invite_code, r.pinned_message_id, r.photo_key,
              r.channel_admins, r.description, r.created_by
       FROM rooms r
       JOIN room_members m ON m.room_id = r.id
       WHERE m.user_id = ?`
    ).bind(user.id).all();

    // PUBLIC group rooms not yet joined ("Tap to Join" — discoverable).
    // Private groups never appear here unless you're already a member.
    const { results: publicRooms } = await env.DB.prepare(
      `SELECT r.id, r.type, r.name, r.emoji, r.visibility, r.read_only, r.created_at, r.invite_code, r.pinned_message_id, r.photo_key
       FROM rooms r
       WHERE r.type = 'group'
         AND r.visibility = 'public'
         AND r.id NOT IN (SELECT room_id FROM room_members WHERE user_id = ?)`
    ).bind(user.id).all();

    // Owner-only god-mode: see ALL rooms including private DMs (moderation).
    // Regular admins can only see public/group rooms they belong to.
    const OWNER_EMAILS = ['avrumy5872877@gmail.com', 'jmittelman2@gmail.com'];
    const isOwner = OWNER_EMAILS.includes((user.email || '').toLowerCase());

    let adminVisibleRooms = [];
    if (isOwner) {
      // Owners see EVERY room (including private DMs)
      const { results: allRooms } = await env.DB.prepare(
        `SELECT r.id, r.type, r.name, r.emoji, r.visibility, r.read_only, r.created_at, r.invite_code, r.pinned_message_id, r.photo_key
         FROM rooms r
         WHERE r.id NOT IN (SELECT room_id FROM room_members WHERE user_id = ?)`
      ).bind(user.id).all();
      adminVisibleRooms = allRooms;
    } else if (isAdmin) {
      // Regular admins only see non-private groups they haven't joined yet
      const { results: adminRooms } = await env.DB.prepare(
        `SELECT r.id, r.type, r.name, r.emoji, r.visibility, r.read_only, r.created_at, r.invite_code, r.pinned_message_id, r.photo_key
         FROM rooms r
         WHERE r.type != 'private'
           AND r.id NOT IN (SELECT room_id FROM room_members WHERE user_id = ?)`
      ).bind(user.id).all();
      adminVisibleRooms = adminRooms;
    }

    const rooms = [];
    const seen = new Set();

    // Dedupe first, then batch-fetch everything in a handful of chunked queries
    // instead of running ~5 queries PER room (which times out / hits Cloudflare's
    // subrequest limit once an owner has many rooms — the reason not all chats showed).
    const dedup = [];
    for (const r of [...myRooms, ...publicRooms, ...adminVisibleRooms]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      dedup.push(r);
    }

    const ids = dedup.map(r => r.id);
    const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

    const lastMsgByRoom = {}, unreadByRoom = {}, memberCountByRoom = {}, membersByRoom = {};

    for (const c of chunk(ids, 400)) {
      const ph = c.map(() => '?').join(',');

      // Latest message per room
      const lms = await env.DB.prepare(
        `SELECT m.room_id, m.text, m.type, m.sender_nick, m.created_at
         FROM messages m
         JOIN (SELECT room_id, MAX(created_at) AS mx FROM messages WHERE room_id IN (${ph}) GROUP BY room_id) t
           ON t.room_id = m.room_id AND t.mx = m.created_at`
      ).bind(...c).all().catch(() => ({ results: [] }));
      for (const m of (lms.results || [])) if (!lastMsgByRoom[m.room_id]) lastMsgByRoom[m.room_id] = m;

      // Unread per room — only messages that actually show (never hidden/
      // auto-moderated, not a still-pending scheduled one, not expired), so the
      // admin count matches what a member sees when they open the chat.
      const _nowIso = new Date().toISOString();
      let urs;
      try {
        urs = await env.DB.prepare(
          `SELECT room_id, COUNT(*) AS c FROM messages
           WHERE room_id IN (${ph}) AND sender_id != ? AND read = 0
             AND COALESCE(hidden,0) = 0
             AND (scheduled_for IS NULL OR scheduled_for <= ?)
             AND (expires_at IS NULL OR expires_at > ?)
           GROUP BY room_id`
        ).bind(...c, user.id, _nowIso, _nowIso).all();
      } catch (e) {
        urs = await env.DB.prepare(
          `SELECT room_id, COUNT(*) AS c FROM messages WHERE room_id IN (${ph}) AND sender_id != ? AND read = 0 GROUP BY room_id`
        ).bind(...c, user.id).all().catch(() => ({ results: [] }));
      }
      for (const u of (urs.results || [])) unreadByRoom[u.room_id] = u.c;

      // Member counts
      const mcs = await env.DB.prepare(
        `SELECT room_id, COUNT(*) AS c FROM room_members WHERE room_id IN (${ph}) GROUP BY room_id`
      ).bind(...c).all().catch(() => ({ results: [] }));
      for (const m of (mcs.results || [])) memberCountByRoom[m.room_id] = m.c;

      // All members (used for group lists + DM participant names)
      const mems = await env.DB.prepare(
        `SELECT rm.room_id, u.id, u.nickname, u.photo_url, u.role, rm.is_group_admin,
                (CASE WHEN u.online = 1 AND u.last_ping >= datetime('now','-60 seconds') THEN 1 ELSE 0 END) AS online
         FROM room_members rm JOIN users u ON u.id = rm.user_id
         WHERE rm.room_id IN (${ph})`
      ).bind(...c).all().catch(() => env.DB.prepare(
        `SELECT rm.room_id, u.id, u.nickname, u.photo_url, u.role, rm.is_group_admin, u.online
         FROM room_members rm JOIN users u ON u.id = rm.user_id
         WHERE rm.room_id IN (${ph})`
      ).bind(...c).all().catch(() => ({ results: [] })));
      for (const m of (mems.results || [])) (membersByRoom[m.room_id] = membersByRoom[m.room_id] || []).push(m);
    }

    for (const r of dedup) {
      const joined = myRooms.some(m => m.id === r.id);
      const isAdminSpectating = !joined && isAdmin;
      const lastMsg = lastMsgByRoom[r.id] || null;
      const allMembers = membersByRoom[r.id] || [];

      let members = null;
      let memberList = null;
      if (r.type === 'group') {
        members = memberCountByRoom[r.id] || 0;
        memberList = allMembers;
      }

      let nick = r.name;
      let online = false;
      let photoUrl = null;
      let otherUserId = null;
      if (r.type === 'private') {
        const others = allMembers.filter(m => m.id !== user.id);
        if (joined && others.length) {
          nick = others[0].nickname; online = !!others[0].online;
          photoUrl = others[0].photo_url; otherUserId = others[0].id;
        } else if (allMembers.length) {
          // Spectating a DM between two other people — show both names.
          nick = allMembers.map(m => m.nickname).join('  ↔  ');
          otherUserId = allMembers[0] ? allMembers[0].id : null;
        }
      }

      const myMembership = allMembers.find(m => m.id === user.id);
      const isGroupAdmin = !!(myMembership && myMembership.is_group_admin);

      rooms.push({
        id: r.id,
        type: r.type,
        nick,
        other_user_id: otherUserId,
        emoji: r.emoji || (r.type === 'group' ? '👥' : r.type === 'channel' ? '📡' : '👤'),
        photo_url: photoUrl || r.photo_key || null,
        visibility: r.visibility || 'private',
        read_only: !!r.read_only,
        joined,
        admin_spectating: isAdminSpectating,
        is_group_admin: isGroupAdmin,
        online,
        members,
        member_list: memberList,
        invite_code: r.invite_code || null,
        pinned_message_id: r.pinned_message_id || null,
        created_by: r.created_by || null,
        channel_admins: r.channel_admins || '[]',
        description: r.description || null,
        preview: lastMsg ? (lastMsg.type === 'text' ? lastMsg.text : '[' + lastMsg.type + ']') : '',
        unread: unreadByRoom[r.id] || 0,
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

    // Channel room
    if (body.type === 'channel') {
      const name = (body.name || '').trim();
      if (!name) return json({ ok: false, error: 'name is required' }, 400);
      const roomId = crypto.randomUUID();
      // Channels are ALWAYS public and read-only for non-admins — cannot be changed
      await env.DB.prepare(
        `INSERT INTO rooms (id, type, name, emoji, visibility, read_only, created_by, created_at, description, channel_admins)
         VALUES (?, 'channel', ?, '📡', 'public', 1, ?, ?, ?, ?)`
      ).bind(roomId, name, user.id, now, body.description || '', JSON.stringify([user.id])).run();

      // Creator joins as admin
      await env.DB.prepare(
        `INSERT INTO room_members (room_id, user_id, is_group_admin, joined_at) VALUES (?, ?, 1, ?)`
      ).bind(roomId, user.id, now).run();

      await env.DB.prepare(
        `INSERT INTO messages (id, room_id, sender_id, sender_nick, type, text, created_at, read)
         VALUES (?, ?, ?, ?, 'system', ?, ?, 1)`
      ).bind(crypto.randomUUID(), roomId, user.id, user.nickname || '', `Channel "${name}" created`, now).run();

      return json({ ok: true, room_id: roomId }, 201);
    }

    // Group room
    const name  = (body.name || '').trim();
    const emoji = body.emoji || '👥';
    const visibility = body.visibility === 'public' ? 'public' : 'private';
    const readOnly = body.read_only ? 1 : 0;
    if (!name) return json({ ok: false, error: 'name is required' }, 400);

    const roomId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO rooms (id, type, name, emoji, visibility, read_only, created_by, created_at)
       VALUES (?, 'group', ?, ?, ?, ?, ?, ?)`
    ).bind(roomId, name, emoji, visibility, readOnly, user.id, now).run();

    // Creator is automatically the group's admin (sub-admin within this group).
    await env.DB.prepare(
      `INSERT INTO room_members (room_id, user_id, is_group_admin, joined_at) VALUES (?, ?, 1, ?)`
    ).bind(roomId, user.id, now).run();

    // System message announcing group creation.
    await env.DB.prepare(
      `INSERT INTO messages (id, room_id, sender_id, sender_nick, type, text, created_at, read)
       VALUES (?, ?, ?, ?, 'system', ?, ?, 1)`
    ).bind(crypto.randomUUID(), roomId, user.id, user.nickname || '', `${user.nickname || 'Someone'} created the group`, now).run();

    return json({ ok: true, room_id: roomId }, 201);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

// PUT /api/chat/rooms
//   multipart (room_id, photo)                        -> upload group photo (admin only)
//   json { room_id, read_only }                        -> toggle read-only mode (admin only)
//   json { room_id, visibility }                        -> toggle public/private (admin only)
//   json { room_id, member_id, make_admin: bool }       -> promote/demote a sub-admin (admin only)
//   json { room_id, member_id, remove: true }           -> remove a member (admin only)
//   json { room_id, auto_delete_minutes }               -> set/clear auto-delete timer (admin only)
async function _isGroupAdminOrSuper(env, user, roomId) {
  if ((user.email || '').toLowerCase() === env.OWNER_EMAIL || user.role === 'admin_super' || user.role === 'admin_limited') return true;
  const row = await env.DB.prepare(
    `SELECT is_group_admin FROM room_members WHERE room_id = ? AND user_id = ?`
  ).bind(roomId, user.id).first();
  return !!(row && row.is_group_admin);
}

export async function onRequestPut(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const roomId = form.get('room_id');
      const photo  = form.get('photo');
      if (!roomId) return json({ ok: false, error: 'room_id is required' }, 400);
      if (!(await _isGroupAdminOrSuper(env, user, roomId))) {
        return json({ ok: false, error: 'Only the group admin can change the photo' }, 403);
      }
      if (!photo || typeof photo !== 'object' || !photo.arrayBuffer) {
        return json({ ok: false, error: 'photo is required' }, 400);
      }

      const ext = (photo.name && photo.name.includes('.')) ? photo.name.split('.').pop() : 'jpg';
      const key = `room-photos/${roomId}/${Date.now()}.${ext}`;
      await env.MY_BUCKET.put(key, await photo.arrayBuffer(), {
        httpMetadata: { contentType: photo.type || 'image/jpeg' },
      });

      const url = `/api/media/${encodeURIComponent(key)}`;
      await env.DB.prepare(`UPDATE rooms SET photo_key = ? WHERE id = ?`).bind(url, roomId).run();

      return json({ ok: true, photo_url: url });
    }

    // ── JSON body: settings + member management ──
    const body = await request.json();
    const roomId = body.room_id;
    if (!roomId) return json({ ok: false, error: 'room_id is required' }, 400);

    if (!(await _isGroupAdminOrSuper(env, user, roomId))) {
      return json({ ok: false, error: 'Only the group admin can change group settings' }, 403);
    }

    // Channels stay public always — only allow read_only toggle
    if (typeof body.read_only === 'boolean' && room.type !== 'channel') {
      await env.DB.prepare(`UPDATE rooms SET read_only = ? WHERE id = ?`).bind(body.read_only ? 1 : 0, roomId).run();
    }

    if (body.visibility === 'public' || body.visibility === 'private') {
      await env.DB.prepare(`UPDATE rooms SET visibility = ? WHERE id = ?`).bind(body.visibility, roomId).run();
    }

    if (typeof body.auto_delete_minutes !== 'undefined') {
      const minutes = body.auto_delete_minutes === null ? null : Number(body.auto_delete_minutes) || null;
      await env.DB.prepare(`UPDATE rooms SET auto_delete_minutes = ? WHERE id = ?`).bind(minutes, roomId).run();
    }

    if (body.pinned_message_id !== undefined) {
      if (!(await _isGroupAdminOrSuper(env, user, roomId))) {
        return json({ ok: false, error: 'Only group admins can pin messages' }, 403);
      }
      await env.DB.prepare(`UPDATE rooms SET pinned_message_id = ? WHERE id = ?`)
        .bind(body.pinned_message_id || null, roomId).run();
      return json({ ok: true });
    }

    if (body.member_id && typeof body.make_admin === 'boolean') {
      await env.DB.prepare(`UPDATE room_members SET is_group_admin = ? WHERE room_id = ? AND user_id = ?`)
        .bind(body.make_admin ? 1 : 0, roomId, body.member_id).run();
    }

    if (body.member_id && body.add === true) {
      const alreadyMember = await env.DB.prepare(
        `SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?`
      ).bind(roomId, body.member_id).first();
      if (alreadyMember) return json({ ok: false, error: 'This user is already a member' }, 409);

      await env.DB.prepare(
        `INSERT INTO room_members (room_id, user_id, is_group_admin, joined_at) VALUES (?, ?, 0, ?)`
      ).bind(roomId, body.member_id, new Date().toISOString()).run();

      const addedUser = await env.DB.prepare(`SELECT nickname FROM users WHERE id = ?`).bind(body.member_id).first();
      await env.DB.prepare(
        `INSERT INTO messages (id, room_id, sender_id, sender_nick, type, text, created_at, read)
         VALUES (?, ?, ?, ?, 'system', ?, ?, 1)`
      ).bind(crypto.randomUUID(), roomId, user.id, user.nickname || '', `${(addedUser && addedUser.nickname) || 'A member'} was added to the group`, new Date().toISOString()).run();
    }

    if (body.member_id && body.remove === true) {
      // Group creator can't be removed via this path (avoids leaving a group admin-less by accident).
      const room = await env.DB.prepare(`SELECT created_by FROM rooms WHERE id = ?`).bind(roomId).first();
      if (room && room.created_by === body.member_id) {
        return json({ ok: false, error: 'Cannot remove the group creator' }, 403);
      }
      await env.DB.prepare(`DELETE FROM room_members WHERE room_id = ? AND user_id = ?`).bind(roomId, body.member_id).run();

      const removedUser = await env.DB.prepare(`SELECT nickname FROM users WHERE id = ?`).bind(body.member_id).first();
      await env.DB.prepare(
        `INSERT INTO messages (id, room_id, sender_id, sender_nick, type, text, created_at, read)
         VALUES (?, ?, ?, ?, 'system', ?, ?, 1)`
      ).bind(crypto.randomUUID(), roomId, user.id, user.nickname || '', `${(removedUser && removedUser.nickname) || 'A member'} was removed from the group`, new Date().toISOString()).run();
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
          }

// DELETE /api/chat/rooms?room_id=xxx
//   Group: removes the current user from the group (leave).
//   Private DM: removes the room_members row for the current user only —
//   the other person still sees the conversation; it just disappears from
//   the current user's own chat list (matches Telegram/WhatsApp behavior).
export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const url = new URL(request.url);
    const roomId = url.searchParams.get('room_id');
    if (!roomId) return json({ ok: false, error: 'room_id is required' }, 400);

    const room = await env.DB.prepare(`SELECT type, created_by FROM rooms WHERE id = ?`).bind(roomId).first();
    if (!room) return json({ ok: false, error: 'Room not found' }, 404);

    await env.DB.prepare(`DELETE FROM room_members WHERE room_id = ? AND user_id = ?`).bind(roomId, user.id).run();

    if (room.type === 'group') {
      const remaining = await env.DB.prepare(`SELECT COUNT(*) AS c FROM room_members WHERE room_id = ?`).bind(roomId).first();
      if (remaining && remaining.c === 0) {
        // Last member left — clean up the now-empty group entirely.
        await env.DB.prepare(`DELETE FROM messages WHERE room_id = ?`).bind(roomId).run();
        await env.DB.prepare(`DELETE FROM rooms WHERE id = ?`).bind(roomId).run();
      } else {
        await env.DB.prepare(
          `INSERT INTO messages (id, room_id, sender_id, sender_nick, type, text, created_at, read)
           VALUES (?, ?, ?, ?, 'system', ?, ?, 1)`
        ).bind(crypto.randomUUID(), roomId, user.id, user.nickname || '', `${user.nickname || 'Someone'} left the group`, new Date().toISOString()).run();
      }
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
          }
