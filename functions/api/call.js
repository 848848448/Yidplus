// WebRTC signaling for 1-on-1 voice/video calls.
//   POST /api/call {action:'start',  callee_id, kind, offer}  -> { call_id }
//   POST /api/call {action:'answer', call_id, answer}
//   POST /api/call {action:'ice',    call_id, candidate}
//   POST /api/call {action:'decline'|'end'|'cancel', call_id}
//   GET  /api/call?incoming=1                 -> a ringing call for me, if any
//   GET  /api/call?call_id=X&since=N          -> { status, signals:[...] }
import { json, corsHeaders, requireUser } from './_helpers.js';

async function ensure(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS calls (
       id TEXT PRIMARY KEY, caller_id TEXT, callee_id TEXT, kind TEXT,
       status TEXT, created_at TEXT, updated_at TEXT )`
  ).run().catch(() => {});
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS call_signals (
       id INTEGER PRIMARY KEY AUTOINCREMENT, call_id TEXT, from_id TEXT,
       type TEXT, data TEXT, created_at TEXT )`
  ).run().catch(() => {});
}

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    await ensure(env);
    const url = new URL(request.url);

    if (url.searchParams.get('incoming')) {
      // A call ringing for me in the last 45s (older = stale/missed).
      const cutoff = new Date(Date.now() - 45000).toISOString();
      const c = await env.DB.prepare(
        `SELECT c.*, u.nickname AS caller_nick, u.photo_url AS caller_photo
           FROM calls c LEFT JOIN users u ON u.id = c.caller_id
          WHERE c.callee_id = ? AND c.status = 'ringing' AND c.created_at > ?
          ORDER BY c.created_at DESC LIMIT 1`
      ).bind(user.id, cutoff).first().catch(() => null);
      if (!c) return json({ ok: true, call: null });
      // The offer is the first signal from the caller.
      const off = await env.DB.prepare(
        `SELECT data FROM call_signals WHERE call_id = ? AND type = 'offer' ORDER BY id ASC LIMIT 1`
      ).bind(c.id).first().catch(() => null);
      return json({ ok: true, call: { id: c.id, kind: c.kind, caller_id: c.caller_id, caller_nick: c.caller_nick, caller_photo: c.caller_photo, offer: off ? off.data : null } });
    }

    const callId = url.searchParams.get('call_id');
    const since = parseInt(url.searchParams.get('since') || '0', 10);
    if (!callId) return json({ ok: false, error: 'call_id required' }, 400);
    const call = await env.DB.prepare('SELECT status, caller_id, callee_id FROM calls WHERE id = ?').bind(callId).first();
    if (!call || (call.caller_id !== user.id && call.callee_id !== user.id)) return json({ ok: false, error: 'Not your call' }, 403);
    const sigs = await env.DB.prepare(
      `SELECT id, from_id, type, data FROM call_signals WHERE call_id = ? AND id > ? AND from_id != ? ORDER BY id ASC`
    ).bind(callId, since, user.id).all().catch(() => ({ results: [] }));
    return json({ ok: true, status: call.status, signals: sigs.results || [] });
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
    const action = body.action;

    if (action === 'start') {
      if (!body.callee_id || !body.offer) return json({ ok: false, error: 'callee_id and offer required' }, 400);
      // Block check — can't call someone who blocked you or whom you blocked.
      const blk = await env.DB.prepare(
        'SELECT 1 FROM user_blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?) LIMIT 1'
      ).bind(user.id, body.callee_id, body.callee_id, user.id).first().catch(() => null);
      if (blk) return json({ ok: false, error: 'You cannot call this person.' }, 403);
      const id = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO calls (id, caller_id, callee_id, kind, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
        .bind(id, user.id, body.callee_id, body.kind === 'audio' ? 'audio' : 'video', 'ringing', now, now).run();
      await env.DB.prepare('INSERT INTO call_signals (call_id, from_id, type, data, created_at) VALUES (?,?,?,?,?)')
        .bind(id, user.id, 'offer', JSON.stringify(body.offer), now).run();
      return json({ ok: true, call_id: id });
    }

    const callId = body.call_id;
    if (!callId) return json({ ok: false, error: 'call_id required' }, 400);
    const call = await env.DB.prepare('SELECT * FROM calls WHERE id = ?').bind(callId).first();
    if (!call || (call.caller_id !== user.id && call.callee_id !== user.id)) return json({ ok: false, error: 'Not your call' }, 403);

    if (action === 'answer') {
      await env.DB.prepare("UPDATE calls SET status='active', updated_at=? WHERE id=?").bind(now, callId).run();
      await env.DB.prepare('INSERT INTO call_signals (call_id, from_id, type, data, created_at) VALUES (?,?,?,?,?)')
        .bind(callId, user.id, 'answer', JSON.stringify(body.answer), now).run();
      return json({ ok: true });
    }
    if (action === 'ice') {
      await env.DB.prepare('INSERT INTO call_signals (call_id, from_id, type, data, created_at) VALUES (?,?,?,?,?)')
        .bind(callId, user.id, 'ice', JSON.stringify(body.candidate), now).run();
      return json({ ok: true });
    }
    if (action === 'decline' || action === 'end' || action === 'cancel') {
      const st = action === 'decline' ? 'declined' : 'ended';
      await env.DB.prepare('UPDATE calls SET status=?, updated_at=? WHERE id=?').bind(st, now, callId).run();
      return json({ ok: true });
    }
    return json({ ok: false, error: 'Unknown action' }, 400);
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}
