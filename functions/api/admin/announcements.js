import { json, corsHeaders, requireUser, isAdminRole, isOwnerOrCoOwner } from '../_helpers.js';
export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const { results } = await env.DB.prepare('SELECT * FROM pinned_announcements WHERE active = 1 ORDER BY created_at DESC LIMIT 5').all().catch(() => ({ results: [] }));
    return json({ ok: true, announcements: results });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
    const { text } = await request.json();
    if (!text) return json({ ok: false, error: 'text required' }, 400);
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO pinned_announcements (id, text, created_by, created_at, active) VALUES (?, ?, ?, ?, 1)').bind(id, text, user.nickname, new Date().toISOString()).run();
    return json({ ok: true, id });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
    const id = new URL(request.url).searchParams.get('id');
    await env.DB.prepare('UPDATE pinned_announcements SET active = 0 WHERE id = ?').bind(id).run();
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
