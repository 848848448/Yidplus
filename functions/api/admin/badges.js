import { json, corsHeaders, requireUser, isSuperOrOwner } from '../_helpers.js';
export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isSuperOrOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
    const uid = new URL(request.url).searchParams.get('user_id');
    const q = uid
      ? env.DB.prepare('SELECT * FROM user_badges WHERE user_id = ? ORDER BY created_at DESC').bind(uid)
      : env.DB.prepare('SELECT ub.*, u.nickname FROM user_badges ub JOIN users u ON u.id = ub.user_id ORDER BY ub.created_at DESC LIMIT 100');
    const { results } = await q.all();
    return json({ ok: true, badges: results });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isSuperOrOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
    const { user_id, badge_text, badge_color } = await request.json();
    if (!user_id || !badge_text) return json({ ok: false, error: 'user_id and badge_text required' }, 400);
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO user_badges (id, user_id, badge_text, badge_color, granted_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, user_id, badge_text, badge_color || '#1565C0', user.nickname, new Date().toISOString()).run();
    return json({ ok: true, id });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isSuperOrOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
    const id = new URL(request.url).searchParams.get('id');
    await env.DB.prepare('DELETE FROM user_badges WHERE id = ?').bind(id).run();
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
