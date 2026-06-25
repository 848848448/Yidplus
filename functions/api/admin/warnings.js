import { json, corsHeaders, requireUser, isAdminRole } from '../_helpers.js';
export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
    const { user_id, message } = await request.json();
    if (!user_id || !message) return json({ ok: false, error: 'user_id and message required' }, 400);
    await env.DB.prepare('INSERT INTO user_warnings (id, user_id, message, sent_by, seen, created_at) VALUES (?, ?, ?, ?, 0, ?)').bind(crypto.randomUUID(), user_id, message, user.nickname, new Date().toISOString()).run();
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
