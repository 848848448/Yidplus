import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';
export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
    const { results } = await env.DB.prepare(
      `SELECT s.id, s.created_at, u.id as user_id, u.nickname, u.email, u.online
       FROM sessions s JOIN users u ON u.id = s.user_id
       ORDER BY s.created_at DESC LIMIT 200`
    ).all();
    return json({ ok: true, sessions: results });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('id');
    const userId = url.searchParams.get('user_id');
    const all = url.searchParams.get('all');
    if (all) {
      await env.DB.prepare('DELETE FROM sessions').run();
      await env.DB.prepare('UPDATE users SET online = 0').run();
    } else if (userId) {
      await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
      await env.DB.prepare('UPDATE users SET online = 0 WHERE id = ?').bind(userId).run();
    } else if (sessionId) {
      await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
    }
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
        }
