// functions/api/statuses.js
// GET  /api/statuses              -> list recent statuses (last 24h), grouped by user
// POST /api/statuses              -> create a status (text or media)
//
// Requires the yp_session cookie (see functions/api/auth/*.js)

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { results } = await env.DB.prepare(
      `SELECT s.id, s.user_id, s.type, s.text, s.bg, s.media_key, s.created_at,
              u.nickname, u.photo_url
       FROM statuses s
       JOIN users u ON u.id = s.user_id
       WHERE s.created_at > ?
       ORDER BY s.created_at DESC
       LIMIT 100`
    ).bind(cutoff).all();

    // Group by user
    const byUser = {};
    for (const row of results) {
      if (!byUser[row.user_id]) {
        byUser[row.user_id] = {
          user_id: row.user_id,
          nickname: row.nickname,
          photo: row.photo_url || null,
          slides: [],
        };
      }
      const slide = { id: row.id, type: row.type, text: row.text, bg: row.bg, created_at: row.created_at };
      if (row.media_key) slide.media_url = `/api/media/${encodeURIComponent(row.media_key)}`;
      byUser[row.user_id].slides.push(slide);
    }

    return json({ ok: true, statuses: Object.values(byUser) });
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
    let type, text, bg, file;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      type = form.get('type') || 'media';
      text = form.get('text') || '';
      bg   = form.get('bg') || null;
      file = form.get('file');
    } else {
      const body = await request.json();
      type = body.type || 'text';
      text = body.text || '';
      bg   = body.bg || null;
    }

    let mediaKey = null;
    if (file && typeof file === 'object' && file.arrayBuffer) {
      const ext = (file.name && file.name.includes('.')) ? file.name.split('.').pop() : 'bin';
      mediaKey = `statuses/${user.id}/${Date.now()}_${crypto.randomUUID()}.${ext}`;
      await env.MY_BUCKET.put(mediaKey, await file.arrayBuffer(), {
        httpMetadata: { contentType: file.type || 'application/octet-stream' },
      });
    }

    if (type === 'text' && !text) {
      return json({ ok: false, error: 'text is required for text statuses' }, 400);
    }
    if (type === 'media' && !mediaKey) {
      return json({ ok: false, error: 'file is required for media statuses' }, 400);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO statuses (id, user_id, type, text, bg, media_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, user.id, type, text, bg, mediaKey, now).run();

    return json({ ok: true, status: { id, type, text, bg, media_key: mediaKey, created_at: now } }, 201);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

// ── HELPERS ───────────────────────────────────────────────
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders });
}

function getCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? match[1] : null;
}

async function requireUser(request, env) {
  const token = getCookie(request, 'yp_session');
  if (!token) return null;

  const session = await env.DB.prepare(
    `SELECT user_id, expires_at FROM sessions WHERE token = ?`
  ).bind(token).first();

  if (!session || new Date(session.expires_at) < new Date()) return null;

  const user = await env.DB.prepare(
    `SELECT id, email, nickname, role, blocked FROM users WHERE id = ?`
  ).bind(session.user_id).first();

  if (!user || user.blocked) return null;
  return user;
}
