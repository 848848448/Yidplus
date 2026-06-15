// functions/api/auth/me.js
// GET /api/auth/me
// Reads the yp_session cookie, returns the logged-in user (or 401).

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const token = getCookie(request, 'yp_session');
    if (!token) return json({ ok: false, error: 'Not signed in' }, 401);

    const session = await env.DB.prepare(
      `SELECT user_id, expires_at FROM sessions WHERE token = ?`
    ).bind(token).first();

    if (!session || new Date(session.expires_at) < new Date()) {
      return json({ ok: false, error: 'Session expired' }, 401);
    }

    const user = await env.DB.prepare(
      `SELECT id, email, nickname, phone, role, verified, blocked, online, photo_url
       FROM users WHERE id = ?`
    ).bind(session.user_id).first();

    if (!user) return json({ ok: false, error: 'User not found' }, 404);
    if (user.blocked) return json({ ok: false, error: 'Account blocked' }, 403);

    const outUser = {
      id: user.id, email: user.email, nickname: user.nickname, phone: user.phone,
      role: user.role, verified: !!user.verified, blocked: !!user.blocked,
      online: !!user.online, photo: user.photo_url || null,
      isOwner: user.email === env.OWNER_EMAIL,
    };

    return json({ ok: true, user: outUser });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders });
}

function getCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? match[1] : null;
}
