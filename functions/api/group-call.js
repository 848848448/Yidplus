// Group call signaling (mesh) for small groups. Everyone in the call connects
// to everyone else. To avoid offer glare, the peer with the smaller user id
// creates the offer for each pair (the client enforces this).
//   POST /api/group-call {action:'join',   room_id, kind}
//   POST /api/group-call {action:'leave',  room_id}
//   POST /api/group-call {action:'signal', room_id, to_id, type, data}
//   GET  /api/group-call?room_id=X&since=N  -> { participants:[...], signals:[...] }
import { json, corsHeaders, requireUser } from './_helpers.js';

async function ensure(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS group_call_participants (
       room_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT,
       joined_at TEXT, seen_at TEXT, PRIMARY KEY (room_id, user_id) )`
  ).run().catch(() => {});
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS group_call_signals (
       id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT, from_id TEXT,
       to_id TEXT, type TEXT, data TEXT, created_at TEXT )`
  ).run().catch(() => {});
}

// Anyone not seen in the last 20s is considered gone (closed tab, lost network).
const STALE_MS = 20000;

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    await ensure(env);
    const url = new URL(request.url);
    const roomId = url.searchParams.get('room_id');
    const since = parseInt(url.searchParams.get('since') || '0', 10);
    if (!roomId) return json({ ok: false, error: 'room_id required' }, 400);

    const now = Date.now();
    // Keep my presence fresh.
    await env.DB.prepare('UPDATE group_call_participants SET seen_at = ? WHERE room_id = ? AND user_id = ?')
      .bind(new Date(now).toISOString(), roomId, user.id).run().catch(() => {});

    const cutoff = new Date(now - STALE_MS).toISOString();
    const parts = await env.DB.prepare(
      `SELECT p.user_id, p.kind, u.nickname, u.photo_url
         FROM group_call_participants p LEFT JOIN users u ON u.id = p.user_id
        WHERE p.room_id = ? AND p.seen_at > ? AND p.user_id != ?`
    ).bind(roomId, cutoff, user.id).all().catch(() => ({ results: [] }));

    const sigs = await env.DB.prepare(
      `SELECT id, from_id, type, data FROM group_call_signals
        WHERE room_id = ? AND to_id = ? AND id > ? ORDER BY id ASC`
    ).bind(roomId, user.id, since).all().catch(() => ({ results: [] }));

    return json({ ok: true, participants: parts.results || [], signals: sigs.results || [] });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    await ensure(env);
    const body = await request.json().catch(() => ({}));
    const now = new Date().toISOString();
    const roomId = body.room_id;
    if (!roomId) return json({ ok: false, error: 'room_id required' }, 400);

    if (body.action === 'join') {
      await env.DB.prepare(
        'INSERT OR REPLACE INTO group_call_participants (room_id, user_id, kind, joined_at, seen_at) VALUES (?,?,?,?,?)'
      ).bind(roomId, user.id, body.kind === 'audio' ? 'audio' : 'video', now, now).run();
      const cutoff = new Date(Date.now() - STALE_MS).toISOString();
      const parts = await env.DB.prepare(
        `SELECT p.user_id, u.nickname, u.photo_url FROM group_call_participants p
           LEFT JOIN users u ON u.id = p.user_id
          WHERE p.room_id = ? AND p.seen_at > ? AND p.user_id != ?`
      ).bind(roomId, cutoff, user.id).all().catch(() => ({ results: [] }));
      return json({ ok: true, participants: parts.results || [], me: user.id });
    }

    if (body.action === 'leave') {
      await env.DB.prepare('DELETE FROM group_call_participants WHERE room_id = ? AND user_id = ?').bind(roomId, user.id).run();
      // Best-effort cleanup of my signals.
      await env.DB.prepare('DELETE FROM group_call_signals WHERE room_id = ? AND (from_id = ? OR to_id = ?)').bind(roomId, user.id, user.id).run().catch(() => {});
      return json({ ok: true });
    }

    if (body.action === 'signal') {
      if (!body.to_id) return json({ ok: false, error: 'to_id required' }, 400);
      await env.DB.prepare(
        'INSERT INTO group_call_signals (room_id, from_id, to_id, type, data, created_at) VALUES (?,?,?,?,?,?)'
      ).bind(roomId, user.id, body.to_id, body.type, JSON.stringify(body.data), now).run();
      return json({ ok: true });
    }

    return json({ ok: false, error: 'Unknown action' }, 400);
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}
