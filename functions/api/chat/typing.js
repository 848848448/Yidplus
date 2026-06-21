// functions/api/chat/typing.js
// POST /api/chat/typing  -> { room_id } mark self as typing (TTL ~5s, refresh on each keystroke)
// GET  /api/chat/typing?room_id=xxx -> list users currently typing in this room (excludes self, excludes stale)

import { json, corsHeaders, requireUser } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const body = await request.json();
    if (!body.room_id) return json({ ok: false, error: 'room_id is required' }, 400);

    // Super Admin invisibility: spectating an admin should never broadcast a typing
    // signal in a room they haven't joined.
    const membership = await env.DB.prepare(
      `SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?`
    ).bind(body.room_id, user.id).first();
    if (!membership) return json({ ok: true, invisible: true });

    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO typing_status (room_id, user_id, user_nick, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(room_id, user_id) DO UPDATE SET updated_at = excluded.updated_at, user_nick = excluded.user_nick`
    ).bind(body.room_id, user.id, user.nickname || '', now).run();

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env).catch(() => null);
    const url = new URL(request.url);
    const roomId = url.searchParams.get('room_id');
    if (!roomId) return json({ ok: false, error: 'room_id is required' }, 400);

    // Typing entries older than 5 seconds are considered stale (user stopped typing
    // without an explicit "stopped" signal, e.g. closed the app).
    const cutoff = new Date(Date.now() - 5000).toISOString();

    await env.DB.prepare(`DELETE FROM typing_status WHERE room_id = ? AND updated_at < ?`)
      .bind(roomId, cutoff).run();

    const { results } = await env.DB.prepare(
      `SELECT user_id, user_nick FROM typing_status WHERE room_id = ? AND updated_at >= ?`
    ).bind(roomId, cutoff).all();

    const others = user ? results.filter(r => r.user_id !== user.id) : results;

    return json({ ok: true, typing: others });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
      }
