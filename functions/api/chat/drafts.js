import { json, corsHeaders, requireUser } from '../_helpers.js';
export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const roomId = new URL(request.url).searchParams.get('room_id');
    const row = await env.DB.prepare('SELECT text FROM message_drafts WHERE user_id=? AND room_id=?').bind(user.id, roomId).first();
    return json({ ok: true, text: row ? row.text : '' });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const { room_id, text } = await request.json();
    if (!text || !text.trim()) {
      await env.DB.prepare('DELETE FROM message_drafts WHERE user_id=? AND room_id=?').bind(user.id, room_id).run();
    } else {
      await env.DB.prepare('INSERT OR REPLACE INTO message_drafts (user_id, room_id, text, updated_at) VALUES (?,?,?,?)').bind(user.id, room_id, text, new Date().toISOString()).run();
    }
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
                            }
