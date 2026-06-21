import { json, corsHeaders } from '../_helpers.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const email = (body.email || '').toLowerCase().trim();
    const password = (body.password || '').trim();
    if (!email || !password) return json({ ok: false, error: 'email and password are required' }, 400);

    const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
    const hash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');

    const user = await env.DB.prepare('SELECT id, email, nickname, role, verified, blocked FROM users WHERE email = ? AND password_hash = ?').bind(email, hash).first();
    if (!user) return json({ ok: false, error: 'Invalid email or password' }, 401);
    if (user.blocked) return json({ ok: false, error: 'Account suspended. Contact support.' }, 403);

    const sessionId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare('INSERT INTO sessions (id, user_id, created_at) VALUES (?, ?, ?)').bind(sessionId, user.id, now).run();
    await env.DB.prepare('UPDATE users SET online = 1 WHERE id = ?').bind(user.id).run();

    const headers = { ...corsHeaders, 'Set-Cookie': `yp_session=${sessionId}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000` };
    return new Response(JSON.stringify({ ok: true, user }), { status: 200, headers: { 'Content-Type': 'application/json', ...headers } });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
