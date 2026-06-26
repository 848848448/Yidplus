import { json, corsHeaders, requireUser } from '../_helpers.js';
export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const { results } = await env.DB.prepare(
      `SELECT b.*, m.text, m.type, m.sender_nick, m.created_at as msg_time, m.media_url
       FROM message_bookmarks b JOIN messages m ON m.id = b.message_id
       WHERE b.user_id = ? ORDER BY b.created_at DESC LIMIT 100`
    ).bind(user.id).all();
    return json({ ok: true, bookmarks: results });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const { message_id, room_id } = await request.json();
    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT OR REPLACE INTO message_bookmarks (id, user_id, message_id, room_id, created_at) VALUES (?,?,?,?,?)'
    ).bind(id, user.id, message_id, room_id, new Date().toISOString()).run();
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const msgId = new URL(request.url).searchParams.get('message_id');
    await env.DB.prepare('DELETE FROM message_bookmarks WHERE user_id=? AND message_id=?').bind(user.id, msgId).run();
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
  }
