// functions/api/admin/room-control.js
// Owner-only group/channel control.
//   GET                             -> { ok, disabled:[room_id,...] }
//   POST   { room_id, action }      -> 'hide' | 'unhide'  (reversible)
//   DELETE ?room_id=                -> permanently delete the room + its content

import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

async function ensureTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS disabled_rooms (room_id TEXT PRIMARY KEY, disabled_at TEXT)`
  ).run().catch(() => {});
}

async function gate(request, env) {
  const user = await requireUser(request, env);
  if (!user) return { err: json({ ok: false, error: 'Not signed in' }, 401) };
  if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return { err: json({ ok: false, error: 'Owner only' }, 403) };
  return { user };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const g = await gate(request, env); if (g.err) return g.err;
    await ensureTable(env);
    const { results } = await env.DB.prepare('SELECT room_id FROM disabled_rooms').all().catch(() => ({ results: [] }));
    return json({ ok: true, disabled: results.map(r => r.room_id) });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const g = await gate(request, env); if (g.err) return g.err;
    await ensureTable(env);
    const body = await request.json();
    if (!body.room_id) return json({ ok: false, error: 'room_id required' }, 400);

    if (body.action === 'hide') {
      await env.DB.prepare(
        'INSERT OR IGNORE INTO disabled_rooms (room_id, disabled_at) VALUES (?, ?)'
      ).bind(body.room_id, new Date().toISOString()).run();
      return json({ ok: true, hidden: true });
    }
    if (body.action === 'unhide') {
      await env.DB.prepare('DELETE FROM disabled_rooms WHERE room_id = ?').bind(body.room_id).run();
      return json({ ok: true, hidden: false });
    }
    return json({ ok: false, error: 'action must be hide|unhide' }, 400);
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const g = await gate(request, env); if (g.err) return g.err;
    await ensureTable(env);
    const url = new URL(request.url);
    const roomId = url.searchParams.get('room_id');
    if (!roomId) return json({ ok: false, error: 'room_id required' }, 400);

    // Permanently remove the room and everything attached to it.
    await env.DB.prepare('DELETE FROM messages WHERE room_id = ?').bind(roomId).run().catch(() => {});
    await env.DB.prepare('DELETE FROM room_members WHERE room_id = ?').bind(roomId).run().catch(() => {});
    await env.DB.prepare('DELETE FROM reactions WHERE room_id = ?').bind(roomId).run().catch(() => {});
    await env.DB.prepare('DELETE FROM disabled_rooms WHERE room_id = ?').bind(roomId).run().catch(() => {});
    await env.DB.prepare('DELETE FROM rooms WHERE id = ?').bind(roomId).run();

    return json({ ok: true, deleted: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
