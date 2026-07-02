import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';
export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
    const uid = new URL(request.url).searchParams.get('user_id');
    if (!uid) return json({ ok: false, error: 'user_id required' }, 400);
    const { results } = await env.DB.prepare('SELECT * FROM admin_notes WHERE target_user_id = ? ORDER BY created_at DESC').bind(uid).all();
    return json({ ok: true, notes: results });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
    const { user_id, note } = await request.json();
    if (!user_id || !note) return json({ ok: false, error: 'user_id and note required' }, 400);
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO admin_notes (id, target_user_id, note, author_nick, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, user_id, note, user.nickname, new Date().toISOString()).run();
    return json({ ok: true, id });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
    const id = new URL(request.url).searchParams.get('id');
    await env.DB.prepare('DELETE FROM admin_notes WHERE id = ?').bind(id).run();
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
  }
