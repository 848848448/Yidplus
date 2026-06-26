// Chat Folders CRUD
import { json, corsHeaders, requireUser } from '../_helpers.js';
export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const { results } = await env.DB.prepare(
      'SELECT * FROM chat_folders WHERE user_id = ? ORDER BY sort_order ASC'
    ).bind(user.id).all();
    return json({ ok: true, folders: results });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const body = await request.json();
    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO chat_folders (id, user_id, name, icon, filter, room_ids, sort_order, created_at) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(id, user.id, body.name || 'Folder', body.icon || '📁', body.filter || 'custom', JSON.stringify(body.room_ids || []), body.sort_order || 0, new Date().toISOString()).run();
    return json({ ok: true, id });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
export async function onRequestPut(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const body = await request.json();
    if (body.room_ids !== undefined) {
      await env.DB.prepare('UPDATE chat_folders SET room_ids=?, name=?, icon=? WHERE id=? AND user_id=?')
        .bind(JSON.stringify(body.room_ids), body.name, body.icon, body.id, user.id).run();
    } else if (body.sort_orders) {
      for (const [fid, ord] of Object.entries(body.sort_orders)) {
        await env.DB.prepare('UPDATE chat_folders SET sort_order=? WHERE id=? AND user_id=?').bind(ord, fid, user.id).run();
      }
    }
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const id = new URL(request.url).searchParams.get('id');
    await env.DB.prepare('DELETE FROM chat_folders WHERE id=? AND user_id=?').bind(id, user.id).run();
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
           }
