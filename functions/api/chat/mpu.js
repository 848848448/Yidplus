// functions/api/chat/mpu.js
// Chunked (multipart) upload for large chat media, so files far bigger than a
// single request can carry go through — including on the Cloudflare Free plan,
// whose per-request body limit is 100MB. The file is sliced client-side into
// parts (each its own request, safely under that limit) and R2's multipart
// upload API stitches them back into one object.
//
// Flow (all POST /api/chat/mpu):
//   ?action=create   JSON  -> runs the same room/permission gate as /api/chat,
//                             opens an R2 multipart upload, returns {key, upload_id}
//   ?action=part     raw   -> body is one chunk; streams it as part N, returns {etag}
//   ?action=complete JSON  -> stitches the parts into the final object
//   ?action=abort    JSON  -> discards an upload that failed partway
//
// The message row itself is NOT written here. After 'complete' the client posts
// to /api/chat with { media_key: key }, so all message creation (disappearing,
// scheduling, notifications, the response shape) stays in one place.

import { json, corsHeaders, requireUser, isAdminRole } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

// Same extension derivation /api/chat uses, so keys look identical either way.
function deriveExt(name, contentType) {
  let ext = (name && name.includes('.')) ? name.split('.').pop().toLowerCase() : '';
  if (!ext || ext.length > 5 || /[^a-z0-9]/.test(ext)) {
    const ct = (contentType || '').toLowerCase();
    if (ct === 'video/quicktime') ext = 'mov';
    else if (ct.startsWith('video/')) ext = ct.split('/')[1] || 'mp4';
    else if (ct.startsWith('image/')) ext = (ct.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    else if (ct.startsWith('audio/')) ext = ct.split('/')[1] || 'm4a';
    else ext = 'bin';
  }
  return ext;
}

// Only a member (for a group, someone allowed to auto-join it) with the room's
// per-type permission may open an upload. Mirrors the gate in /api/chat so a
// 500MB upload is rejected up front instead of after the bytes are spent.
// Returns an error Response, or null when posting is allowed.
async function gateUpload(env, user, roomId, contentType, filename, type) {
  const room = await env.DB.prepare(
    `SELECT type, read_only, visibility, permissions FROM rooms WHERE id = ?`
  ).bind(roomId).first();
  if (!room) return json({ ok: false, error: 'Room not found' }, 404);

  if (room.type === 'private') {
    const isMember = await env.DB.prepare(
      'SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?'
    ).bind(roomId, user.id).first();
    if (!isMember) return json({ ok: false, error: 'Forbidden' }, 403);

    const { results: others } = await env.DB.prepare(
      `SELECT user_id FROM room_members WHERE room_id = ? AND user_id != ?`
    ).bind(roomId, user.id).all();
    const otherId = others[0] && others[0].user_id;
    if (otherId) {
      const blocked = await env.DB.prepare(
        `SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`
      ).bind(user.id, otherId, otherId, user.id).first();
      if (blocked) return json({ ok: false, error: 'You cannot message this user.' }, 403);
    }
  } else {
    // Invite-only group: only existing members may post.
    if (room.type === 'group' && room.visibility === 'private' && !isAdminRole(user, env.OWNER_EMAIL)) {
      const already = await env.DB.prepare(
        'SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?'
      ).bind(roomId, user.id).first();
      if (!already) return json({ ok: false, error: 'This is a private group. You need an invite to join.' }, 403);
    }
    // Auto-join the room, same as a normal post to it does.
    const exists = await env.DB.prepare(
      `SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?`
    ).bind(roomId, user.id).first();
    if (!exists) {
      await env.DB.prepare(
        `INSERT INTO room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)`
      ).bind(roomId, user.id, new Date().toISOString()).run();
    }
  }

  // Read-only group: only admins may post.
  if (room.type === 'group' && room.read_only && !isAdminRole(user, env.OWNER_EMAIL)) {
    const membership = await env.DB.prepare(
      `SELECT is_group_admin FROM room_members WHERE room_id = ? AND user_id = ?`
    ).bind(roomId, user.id).first();
    if (!membership || !membership.is_group_admin) {
      return json({ ok: false, error: 'This group is read-only. Only admins can post.' }, 403);
    }
  }

  // Per-type "what members can send" permission.
  if (room.type === 'group' && room.permissions && !isAdminRole(user, env.OWNER_EMAIL)) {
    let perms = null;
    try { perms = JSON.parse(room.permissions); } catch (e) {}
    if (perms) {
      const mem = await env.DB.prepare(
        `SELECT is_group_admin FROM room_members WHERE room_id = ? AND user_id = ?`
      ).bind(roomId, user.id).first();
      if (!mem || !mem.is_group_admin) {
        const ft = (contentType || '').toLowerCase();
        const nm = (filename || '').toLowerCase();
        let permKey = 'files';
        if (ft.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|heic|heif|bmp|svg)$/i.test(nm)) permKey = 'photos';
        else if (ft.startsWith('video/') || /\.(mp4|mov|webm|mkv|avi|m4v|3gp)$/i.test(nm)) permKey = 'videos';
        else if (ft.startsWith('audio/') || /\.(mp3|m4a|aac|wav|flac|ogg|opus|wma)$/i.test(nm)) permKey = (type === 'voice' ? 'voice' : 'music');
        const labels = { photos: 'photos', videos: 'videos', music: 'music', voice: 'voice messages', files: 'files' };
        if (perms[permKey] === false) {
          return json({ ok: false, error: 'The group admin has turned off sending ' + (labels[permKey] || permKey) + ' here.' }, 403);
        }
      }
    }
  }

  return null;
}

// A key must live under the room the caller is uploading into, and the caller
// must be a member of it, or one upload handle could be pointed at another
// room's object. Returns the roomId when valid, or an error Response.
async function authorizeKey(env, user, key) {
  if (typeof key !== 'string' || !key.startsWith('chat/')) {
    return { error: json({ ok: false, error: 'Invalid upload key' }, 400) };
  }
  const roomId = key.split('/')[1];
  if (!roomId) return { error: json({ ok: false, error: 'Invalid upload key' }, 400) };
  const member = await env.DB.prepare(
    'SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?'
  ).bind(roomId, user.id).first();
  if (!member) return { error: json({ ok: false, error: 'Forbidden' }, 403) };
  return { roomId };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const u = new URL(request.url);
    const action = u.searchParams.get('action');

    // ── Open a multipart upload ──
    if (action === 'create') {
      const body = await request.json();
      const roomId = body.room_id;
      const type = body.type || 'media';
      const filename = body.filename || '';
      const contentType = body.content_type || '';
      if (!roomId) return json({ ok: false, error: 'room_id is required' }, 400);

      const gate = await gateUpload(env, user, roomId, contentType, filename, type);
      if (gate) return gate;

      const ext = deriveExt(filename, contentType);
      const key = `chat/${roomId}/${Date.now()}_${crypto.randomUUID()}.${ext}`;
      const mpu = await env.MY_BUCKET.createMultipartUpload(key, {
        httpMetadata: { contentType: contentType || 'application/octet-stream' },
      });
      return json({ ok: true, key: mpu.key, upload_id: mpu.uploadId }, 201);
    }

    // ── Upload one chunk (raw body) ──
    if (action === 'part') {
      const key = u.searchParams.get('key');
      const uploadId = u.searchParams.get('upload_id');
      const partNumber = parseInt(u.searchParams.get('part') || '0', 10);
      if (!key || !uploadId || !partNumber || partNumber < 1) {
        return json({ ok: false, error: 'key, upload_id and part are required' }, 400);
      }
      const auth = await authorizeKey(env, user, key);
      if (auth.error) return auth.error;
      if (!request.body) return json({ ok: false, error: 'Empty chunk' }, 400);

      const mpu = env.MY_BUCKET.resumeMultipartUpload(key, uploadId);
      // request.body streams straight into R2 — the chunk is never buffered whole.
      const uploaded = await mpu.uploadPart(partNumber, request.body);
      return json({ ok: true, part_number: uploaded.partNumber, etag: uploaded.etag });
    }

    // ── Finish: stitch the parts into the object ──
    if (action === 'complete') {
      const body = await request.json();
      const key = body.key;
      const uploadId = body.upload_id;
      const parts = Array.isArray(body.parts) ? body.parts : null;
      if (!key || !uploadId || !parts || !parts.length) {
        return json({ ok: false, error: 'key, upload_id and parts are required' }, 400);
      }
      const auth = await authorizeKey(env, user, key);
      if (auth.error) return auth.error;

      const mpu = env.MY_BUCKET.resumeMultipartUpload(key, uploadId);
      try {
        await mpu.complete(parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })));
      } catch (e) {
        return json({ ok: false, error: 'Could not assemble upload: ' + e.message }, 400);
      }
      // The caller now posts /api/chat with { media_key: key } to send the message.
      return json({ ok: true, key });
    }

    // ── Give up on a partial upload ──
    if (action === 'abort') {
      const body = await request.json();
      const key = body.key;
      const uploadId = body.upload_id;
      if (!key || !uploadId) return json({ ok: false, error: 'key and upload_id are required' }, 400);
      const auth = await authorizeKey(env, user, key);
      if (auth.error) return auth.error;
      try {
        await env.MY_BUCKET.resumeMultipartUpload(key, uploadId).abort();
      } catch (e) {}
      return json({ ok: true });
    }

    return json({ ok: false, error: 'Unknown action' }, 400);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
