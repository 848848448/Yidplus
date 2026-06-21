import { json, corsHeaders, getCookie } from '../_helpers.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const sessionId = getCookie(request, 'yp_session');
    if (sessionId) {
      const session = await env.DB.prepare('SELECT user_id FROM sessions WHERE id = ?').bind(sessionId).first();
      if (session) await env.DB.prepare('UPDATE users SET online = 0 WHERE id = ?').bind(session.user_id).run();
      await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
    }
    const headers = { ...corsHeaders, 'Set-Cookie': 'yp_session=; HttpOnly; Path=/; Max-Age=0' };
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', ...headers } });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
