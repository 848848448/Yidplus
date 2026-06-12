// functions/api/auth/logout.js
// POST /api/auth/logout
// Deletes the session row and clears the cookie.

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const token = getCookie(request, 'yp_session');

    if (token) {
      const session = await env.DB.prepare(
        `SELECT user_id FROM sessions WHERE token = ?`
      ).bind(token).first();

      if (session) {
        await env.DB.prepare('UPDATE users SET online = 0 WHERE id = ?').bind(session.user_id).run();
      }

      await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    }

    const headers = new Headers(corsHeaders);
    headers.append('Set-Cookie', 'yp_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: corsHeaders });
  }
}

function getCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? match[1] : null;
}
