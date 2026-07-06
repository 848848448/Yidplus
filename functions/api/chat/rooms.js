// functions/api/chat/rooms.js
// GET  /api/chat/rooms          -> list rooms the current user is a member of,
//                                   plus PUBLIC group rooms not yet joined (join-first policy).
//                                   Super Admins additionally see ALL private groups (god-mode).
// POST /api/chat/rooms          -> create a room (group) or open/find a DM
//   Body for group: { type:'group', name, emoji, visibility:'public'|'private', read_only:bool }
//   Body for DM:    { type:'private', other_user_id }

import { json, corsHeaders, requireUser, isAdminRole, isOwnerOrCoOwner } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const url = new URL(request.url);

    // ── List all pinned messages ever pinned in this room (not just the
    //    current top-bar one) ──
    const pinnedHistoryRoomId = url.searchParams.get('pinned_history');
    if (pinnedHistoryRoomId) {
      try {
        const { results } = await env.DB.prepare(
          `SELECT pm.message_id, pm.pinned_at, pm.pinned_by, u.nickname as pinned_by_nick,
                  m.text, m.type, m.sender_nick, m.created_at
           FROM pinned_messages pm
           LEFT JOIN messages m ON m.id = pm.message_id
           LEFT JOIN users u ON u.id = pm.pinned_by
           WHERE pm.room_id = ?
           ORDER BY pm.pinned_at DESC`
        ).bind(pinnedHistoryRoomId).all();
        return json({ ok: true, pinned: results });
      } catch (e) {
        return json({ ok: true, pinned: [] }); // table not migrated yet
      }
    }

    // ── Search public groups by name (used by Explore) ──
    const searchQ = url.searchParams.get('search');
    if (searchQ && searchQ.trim()) {
      const { results } = await env.DB.prepare(
        `SELECT r.id, r.type, r.name, r.emoji, r.visibility, r.photo_key,
                COUNT(rm.user_id) as members
         FROM rooms r
         LEFT JOIN room_members rm ON rm.room_id = r.id
         WHERE r.type = 'group' AND r.visibility = 'public' AND r.name LIKE ?
         GROUP BY r.id
         ORDER BY members DESC LIMIT 30`
      ).bind('%' + searchQ.trim() + '%').all();
      return json({ ok: true, rooms: results.map(r => ({
        id: r.id, type: r.type, nick: r.name, emoji: r.emoji || '👥',
        photo_url: r.photo_key || null, visibility: r.visibility, members: r.members,
      })) });
    }

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
    const isOwner = isOwnerOrCoOwner(user, env.OWNER_EMAIL);

    // Rooms the user is a member of
    let myRooms;
    try {
      const res = await env.DB.prepare(
        `SELECT r.id, r.type, r.name, r.emoji, r.visibility, r.read_only, r.created_at,
                r.invite_code, r.pinned_message_id, r.photo_key,
                r.channel_admins, r.description, r.created_by, m.muted, r.has_topics
         FROM rooms r
         JOIN room_members m ON m.room_id = r.id
         WHERE m.user_id = ?`
      ).bind(user.id).all();
      myRooms = res.results;
    } catch (e) {
      // muted or has_topics column not migrated yet — fall back without them
      const res = await env.DB.prepare(
        `SELECT r.id, r.type, r.name, r.emoji, r.visibility, r.read_only, r.created_at,
                r.invite_code, r.pinned_message_id, r.photo_key,
                r.channel_admins, r.description, r.created_by
         FROM rooms r
         JOIN room_members m ON m.room_id = r.id
         WHERE m.user_id = ?`
      ).bind(user.id).all();
      myRooms = res.results;
    }

    // PUBLIC group rooms not yet joined ("Tap to Join" — discoverable).
    // Private groups never appear here unless you're already a member.
    const { results: publicRooms } = await env.DB.prepare(
      `SELECT r.id, r.type, r.name, r.emoji, r.visibility, r.read_only, r.created_at, r.invite_code, r.pinned_message_id, r.photo_key
       FROM rooms r
       WHERE r.type = 'group'
         AND r.visibility = 'public'
         AND r.id NOT IN (SELECT room_id FROM room_members WHERE user_id = ?)`
    ).bind(user.id).all();

    // God-mode visibility for moderation, split by privacy sensitivity:
    //   - Owners (avrumy + Jmittelman2 only) see EVERYTHING, including
    //     private 1-on-1 DMs between two other users.
    //   - Moderators/admin_super see every GROUP (public or private) so they
    //     can moderate and delete bad content, but NEVER see private DMs —
    //     those are between two people and stay between the owners' eyes only.
    let adminVisibleRooms = [];
    if (isOwner) {
      const { results: allRooms } = await env.DB.prepare(
        `SELECT r.id, r.type, r.name, r.emoji, r.visibility, r.read_only, r.created_at, r.invite_code, r.pinned_message_id, r.photo_key
         FROM rooms r
         WHERE r.id NOT IN (SELECT room_id FROM room_members WHERE user_id = ?)`
      ).bind(user.id).all();
      adminVisibleRooms = allRooms;
    } else if (isAdmin) {
      const { results: groupRooms } = await env.DB.prepare(
        `SELECT r.id, r.type, r.name, r.emoji, r.visibility, r.read_only, r.created_at, r.invite_code, r.pinned_message_id, r.photo_key
         FROM rooms r
         WHERE r.type = 'group'
           AND r.id NOT IN (SELECT room_id FROM room_members WHERE user_id = ?)`
      ).bind(user.id).all();
      adminVisibleRooms = groupRooms;
    }

    const rooms = [];
    const seen = new Set();

    // Dedupe rooms across myRooms/publicRooms/adminVisibleRooms up front,
    // then batch-fetch everything needed for ALL rooms in a handful of
    // queries instead of looping with sequential per-room awaits.
    const dedupedRooms = [];
    for (const r of [...myRooms, ...publicRooms, ...adminVisibleRooms]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      dedupedRooms.push(r);
    }

    const allRoomIds = dedupedRooms.map(r => r.id);
    const groupRoomIds = dedupedRooms.filter(r => r.type === 'group').map(r => r.id);
    const privateRoomIds = dedupedRooms.filter(r => r.type === 'private').map(r => r.id);

    let lastMsgByRoom = {}, unreadByRoom = {}, memberCountByRoom = {}, memberListByRoom = {}, otherUserByRoom = {};

    if (allRoomIds.length) {
      const placeholders = allRoomIds.map(() => '?').join(',');

      // Last message per room (window function — one query for every room).
      const { results: lastMsgs } = await env.DB.prepare(
        `SELECT room_id, text, type, sender_nick, created_at FROM (
           SELECT room_id, text, type, sender_nick, created_at,
                  ROW_NUMBER() OVER (PARTITION BY room_id ORDER BY created_at DESC) as rn
           FROM messages WHERE room_id IN (${placeholders})
         ) WHERE rn = 1`
      ).bind(...allRoomIds).all().catch(() => ({ results: [] }));
      for (const m of lastMsgs) lastMsgByRoom[m.room_id] = m;

      // Unread counts. Private DMs only have two participants, so the
      // shared `read` flag on the message is fine. Groups are different —
      // that same shared flag meant the FIRST member to open a group after
      // a new message would silently mark it "read" for every other
      // member too, since there was only one read flag per message, not
      // one per recipient. Groups now use each member's own last_read_at
      // timestamp instead, so unread counts are accurate per-person.
      if (privateRoomIds.length) {
        const privPlaceholders = privateRoomIds.map(() => '?').join(',');
        const { results: unreadRows } = await env.DB.prepare(
          `SELECT room_id, COUNT(*) AS c FROM messages
           WHERE room_id IN (${privPlaceholders}) AND sender_id != ? AND read = 0
           GROUP BY room_id`
        ).bind(...privateRoomIds, user.id).all().catch(() => ({ results: [] }));
        for (const u of unreadRows) unreadByRoom[u.room_id] = u.c;
      }

      if (groupRoomIds.length) {
        const grpPlaceholders = groupRoomIds.map(() => '?').join(',');
        try {
          const { results: unreadRows } = await env.DB.prepare(
            `SELECT m.room_id, COUNT(*) AS c
             FROM messages m
             JOIN room_members rm ON rm.room_id = m.room_id AND rm.user_id = ?
             WHERE m.room_id IN (${grpPlaceholders}) AND m.sender_id != ?
               AND (rm.last_read_at IS NULL OR m.created_at > rm.last_read_at)
             GROUP BY m.room_id`
          ).bind(user.id, ...groupRoomIds, user.id).all();
          for (const u of unreadRows) unreadByRoom[u.room_id] = u.c;
        } catch (e) {
          // last_read_at not migrated yet — fall back to the old shared
          // flag (imperfect for groups, but keeps unread counts working).
          const { results: unreadRows } = await env.DB.prepare(
            `SELECT room_id, COUNT(*) AS c FROM messages
             WHERE room_id IN (${grpPlaceholders}) AND sender_id != ? AND read = 0
             GROUP BY room_id`
          ).bind(...groupRoomIds, user.id).all().catch(() => ({ results: [] }));
          for (const u of unreadRows) unreadByRoom[u.room_id] = u.c;
        }
      }
    }

    if (groupRoomIds.length) {
      const gPlaceholders = groupRoomIds.map(() => '?').join(',');

      const { results: memberCounts } = await env.DB.prepare(
        `SELECT room_id, COUNT(*) AS c FROM room_members
         WHERE room_id IN (${gPlaceholders}) GROUP BY room_id`
      ).bind(...groupRoomIds).all().catch(() => ({ results: [] }));
      for (const c of memberCounts) memberCountByRoom[c.room_id] = c.c;

      let memRows;
      try {
        const res = await env.DB.prepare(
          `SELECT rm.room_id, u.id, u.nickname, u.online, u.role, u.photo_url, rm.is_group_admin, rm.title
           FROM room_members rm JOIN users u ON u.id = rm.user_id
           WHERE rm.room_id IN (${gPlaceholders})`
        ).bind(...groupRoomIds).all();
        memRows = res.results;
      } catch (e) {
        const res = await env.DB.prepare(
          `SELECT rm.room_id, u.id, u.nickname, u.online, u.role, u.photo_url, rm.is_group_admin
           FROM room_members rm JOIN users u ON u.id = rm.user_id
           WHERE rm.room_id IN (${gPlaceholders})`
        ).bind(...groupRoomIds).all().catch(() => ({ results: [] }));
        memRows = res.results;
      }
      for (const m of memRows) {
        (memberListByRoom[m.room_id] = memberListByRoom[m.room_id] || []).push(m);
      }
    }

    if (privateRoomIds.length) {
      const pPlaceholders = privateRoomIds.map(() => '?').join(',');
      const { results: otherRows } = await env.DB.prepare(
        `SELECT rm.room_id, u.id, u.nickname, u.photo_url,
                (CASE WHEN u.online = 1 AND u.last_ping >= datetime('now','-60 seconds') THEN 1 ELSE 0 END) AS online
         FROM room_members rm JOIN users u ON u.id = rm.user_id
         WHERE rm.room_id IN (${pPlaceholders}) AND rm.user_id != ?`
      ).bind(...privateRoomIds, user.id).all().catch(() => env.DB.prepare(
        `SELECT rm.room_id, u.id, u.nickname, u.online, u.photo_url
         FROM room_members rm JOIN users u ON u.id = rm.user_id
         WHERE rm.room_id IN (${pPlaceholders}) AND rm.user_id != ?`
      ).bind(...privateRoomIds, user.id).all().catch(() => ({ results: [] })));
      for (const o of otherRows) otherUserByRoom[o.room_id] = o;
    }

    for (const r of dedupedRooms) {
      const joined = myRooms.some(m => m.id === r.id);
      const isAdminSpectating = !joined && isAdmin;

      const lastMsg = lastMsgByRoom[r.id] || null;
      const unreadCount = unreadByRoom[r.id] || 0;

      let members = null;
      let memberList = null;
      if (r.type === 'group') {
        members = memberCountByRoom[r.id] || 0;
        memberList = memberListByRoom[r.id] || [];
      }

      let nick = r.name;
      let online = false;
      let photoUrl = null;
      let otherUserId = null;
      if (r.type === 'private') {
        const other = otherUserByRoom[r.id];
        if (other) { nick = other.nickname; online = !!other.online; photoUrl = other.photo_url; otherUserId = other.id; }
      }

      // Whether the current user is a sub-admin of this specific group
      const myMembership = (memberList || []).find(m => m.id === user.id);
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
        has_topics: !!r.has_topics,
        online,
        members,
        member_list: memberList,
        invite_code: r.invite_code || null,
        pinned_message_id: r.pinned_message_id || null,
        created_by: r.created_by || null,
        channel_admins: r.channel_admins || '[]',
        description: r.description || null,
        preview: lastMsg ? (lastMsg.type === 'text' ? lastMsg.text : '[' + lastMsg.type + ']') : '',
        unread: unreadCount,
        muted: !!r.muted,
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
      const inviteCode = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
      await env.DB.prepare(
        `INSERT INTO rooms (id, type, name, emoji, visibility, read_only, created_by, created_at, description, channel_admins, invite_code)
         VALUES (?, 'channel', ?, '📡', 'public', 1, ?, ?, ?, ?, ?)`
      ).bind(roomId, name, user.id, now, body.description || '', JSON.stringify([user.id]), inviteCode).run();

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
    const inviteCode = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    await env.DB.prepare(
      `INSERT INTO rooms (id, type, name, emoji, visibility, read_only, created_by, created_at, invite_code)
       VALUES (?, 'group', ?, ?, ?, ?, ?, ?, ?)`
    ).bind(roomId, name, emoji, visibility, readOnly, user.id, now, inviteCode).run();

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

    // Mute is a personal preference — any member can set it for themselves,
    // regardless of group-admin status. Must come before the admin-only
    // gate below, or every non-admin member would be rejected trying to
    // mute their own notifications.
    if (typeof body.muted === 'boolean') {
      try {
        await env.DB.prepare(
          `UPDATE room_members SET muted = ? WHERE room_id = ? AND user_id = ?`
        ).bind(body.muted ? 1 : 0, roomId, user.id).run();
      } catch (e) {
        return json({ ok: false, error: 'Mute column not migrated yet on the server.' }, 500);
      }
      return json({ ok: true });
    }

    if (!(await _isGroupAdminOrSuper(env, user, roomId))) {
      return json({ ok: false, error: 'Only the group admin can change group settings' }, 403);
    }

    if (typeof body.read_only === 'boolean') {
      await env.DB.prepare(`UPDATE rooms SET read_only = ? WHERE id = ?`).bind(body.read_only ? 1 : 0, roomId).run();
    }

    if (body.visibility === 'public' || body.visibility === 'private') {
      await env.DB.prepare(`UPDATE rooms SET visibility = ? WHERE id = ?`).bind(body.visibility, roomId).run();
    }

    if (typeof body.auto_delete_minutes !== 'undefined') {
      const minutes = body.auto_delete_minutes === null ? null : Number(body.auto_delete_minutes) || null;
      await env.DB.prepare(`UPDATE rooms SET auto_delete_minutes = ? WHERE id = ?`).bind(minutes, roomId).run();
    }

    if (typeof body.member_title !== 'undefined' && body.member_id) {
      try {
        await env.DB.prepare(
          `UPDATE room_members SET title = ? WHERE room_id = ? AND user_id = ?`
        ).bind((body.member_title || '').slice(0, 24) || null, roomId, body.member_id).run();
        return json({ ok: true });
      } catch (e) {
        return json({ ok: false, error: 'Member titles are not migrated yet on the server.' }, 500);
      }
    }

    if (body.generate_invite === true) {
      const existing = await env.DB.prepare(`SELECT invite_code FROM rooms WHERE id = ?`).bind(roomId).first();
      if (existing && existing.invite_code) {
        return json({ ok: true, invite_code: existing.invite_code });
      }
      const inviteCode = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
      await env.DB.prepare(`UPDATE rooms SET invite_code = ? WHERE id = ?`).bind(inviteCode, roomId).run();
      return json({ ok: true, invite_code: inviteCode });
    }

    if (body.pinned_message_id !== undefined) {
      if (!(await _isGroupAdminOrSuper(env, user, roomId))) {
        return json({ ok: false, error: 'Only group admins can pin messages' }, 403);
      }
      await env.DB.prepare(`UPDATE rooms SET pinned_message_id = ? WHERE id = ?`)
        .bind(body.pinned_message_id || null, roomId).run();
      // Also record in pin history so "View all pinned messages" works,
      // even though the top bar only ever shows the latest one.
      if (body.pinned_message_id) {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO pinned_messages (room_id, message_id, pinned_by, pinned_at) VALUES (?, ?, ?, ?)`
        ).bind(roomId, body.pinned_message_id, user.id, new Date().toISOString()).run().catch(() => {});
      }
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
