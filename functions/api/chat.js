// functions/api/chat.js
// Cloudflare Pages Function — chat messages via D1, media via R2
// Routes (all under /api/chat):
//   GET    /api/chat?room_id=xxx          -> list messages for a room
//   POST   /api/chat                       -> send a message (json or multipart)
//   DELETE /api/chat?id=xxx                -> delete a message

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // ── GET: list messages for a room ──────────────────
    if (request.method === 'GET') {
      const roomId = url.searchParams.get('room_id');
      if (!roomId) {
        return json({ ok: false, error: 'room_id is required' }, 400);
      }

      const { results } = await env.DB.prepare(
        `SELECT id, room_id, sender_id, sender_nick, type, text, media_key,
                reply_to_id, created_at, read
         FROM messages
         WHERE room_id = ?
         ORDER BY created_at ASC
         LIMIT 200`
      ).bind(roomId).all();

      // Resolve media URLs for any messages with media_key
      const out = [];
      for (const row of results) {
        if (row.media_key) {
          row.media_url = `/api/media/${encodeURIComponent(row.media_key)}`;
        }
        out.push(row);
      }

      return json({ ok: true, messages: out });
    }

    // ── POST: send a message (text, sticker, voice, media) ──
    if (request.method === 'POST') {
      const contentType = request.headers.get('content-type') || '';
      let roomId, senderId, senderNick, type, text, replyToId, file;

      if (contentType.includes('multipart/form-data')) {
        const form = await request.formData();
        roomId     = form.get('room_id');
        senderId   = form.get('sender_id');
        senderNick = form.get('sender_nick');
        type       = form.get('type') || 'media';
        text       = form.get('text') || '';
        replyToId  = form.get('reply_to_id') || null;
        file       = form.get('file');
      } else {
        const body = await request.json();
        roomId     = body.room_id;
        senderId   = body.sender_id;
        senderNick = body.sender_nick;
        type       = body.type || 'text';
        text       = body.text || '';
        replyToId  = body.reply_to_id || null;
      }

      if (!roomId || !senderId) {
        return json({ ok: false, error: 'room_id and sender_id are required' }, 400);
      }

      let mediaKey = null;

      // Upload media to R2 if a file was provided
      if (file && typeof file === 'object' && file.arrayBuffer) {
        const ext = (file.name && file.name.includes('.'))
          ? file.name.split('.').pop()
          : 'bin';
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
      ).bind(id, roomId, senderId, senderNick || '', type, text, mediaKey, replyToId, now).run();

      const result = {
        id, room_id: roomId, sender_id: senderId, sender_nick: senderNick || '',
        type, text, media_key: mediaKey, reply_to_id: replyToId,
        created_at: now, read: 0,
      };
      if (mediaKey) result.media_url = `/api/media/${encodeURIComponent(mediaKey)}`;

      return json({ ok: true, message: result }, 201);
    }

    // ── DELETE: remove a message ───────────────────────
    if (request.method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) return json({ ok: false, error: 'id is required' }, 400);

      // Find message to clean up R2 media if present
      const row = await env.DB.prepare(
        `SELECT media_key FROM messages WHERE id = ?`
      ).bind(id).first();

      if (row && row.media_key) {
        await env.MY_BUCKET.delete(row.media_key);
      }

      await env.DB.prepare(`DELETE FROM messages WHERE id = ?`).bind(id).run();
      return json({ ok: true });
    }

    return json({ ok: false, error: 'Method not allowed' }, 405);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders });
        }
