// functions/api/profile.js
// PUT /api/profile  -> update the logged-in user's nickname/bio
// Body: { nickname, bio }

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPut(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const body = await request.json();
    const nickname = (body.nickname || '').trim();
    const bio       = (body.bio || '').trim();

    if (nickname.length < 3) {
      return json({ ok: false, error: 'Nickname must be at least 3 characters' }, 400);
    }

    await env.DB.prepare(
      `UPDATE users SET nickname = ?, bio = ? WHERE id = ?`
    ).bind(nickname, bio, user.id).run();

    // Keep the user's channel nickname in sync too
    await env.DB.prepare(
      `UPDATE channels SET nickname = ? WHERE owner_id = ?`
    ).bind(nickname, user.id).run();

    return json({ ok: true, nickname: nickname, bio: bio });
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
