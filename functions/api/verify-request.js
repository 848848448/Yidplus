// functions/api/verify-request.js
//   POST                       (user)  -> submit a verification request
//   GET   ?mine=1              (user)  -> my current request status
//   GET                        (admin) -> list pending requests
//   PUT   { id, action }       (admin) -> 'approve' | 'deny'

import { json, corsHeaders, requireUser, isAdminRole } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

async function ensureTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS verify_requests (
       id TEXT PRIMARY KEY,
       user_id TEXT,
       note TEXT,
       status TEXT DEFAULT 'pending',
       created_at TEXT,
       decided_at TEXT
     )`
  ).run().catch(() => {});
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    await ensureTable(env);

    if (user.verified) return json({ ok: false, error: "You're already verified ✅" }, 400);

    const pending = await env.DB.prepare(
      "SELECT id FROM verify_requests WHERE user_id = ? AND status = 'pending'"
    ).bind(user.id).first().catch(() => null);
    if (pending) return json({ ok: false, error: 'You already have a request pending review.' }, 409);

    const body = await request.json().catch(() => ({}));
    await env.DB.prepare(
      "INSERT INTO verify_requests (id, user_id, note, status, created_at) VALUES (?, ?, ?, 'pending', ?)"
    ).bind(crypto.randomUUID(), user.id, (body.note || '').trim().slice(0, 500) || null, new Date().toISOString()).run();

    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    await ensureTable(env);
    const url = new URL(request.url);

    if (url.searchParams.get('mine')) {
      const row = await env.DB.prepare(
        'SELECT status, created_at FROM verify_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
      ).bind(user.id).first().catch(() => null);
      return json({ ok: true, verified: !!user.verified, request: row || null });
    }

    if (!isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Admins only' }, 403);
    const { results } = await env.DB.prepare(
      `SELECT v.id, v.user_id, v.note, v.created_at, u.nickname, u.photo_url, u.email
       FROM verify_requests v JOIN users u ON u.id = v.user_id
       WHERE v.status = 'pending' ORDER BY v.created_at ASC`
    ).all().catch(() => ({ results: [] }));
    return json({ ok: true, requests: results });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestPut(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Admins only' }, 403);
    await ensureTable(env);

    const body = await request.json();
    if (!body.id || !['approve', 'deny'].includes(body.action)) {
      return json({ ok: false, error: 'id and action (approve|deny) required' }, 400);
    }
    const req = await env.DB.prepare('SELECT user_id FROM verify_requests WHERE id = ?').bind(body.id).first().catch(() => null);
    if (!req) return json({ ok: false, error: 'Request not found' }, 404);

    const now = new Date().toISOString();
    if (body.action === 'approve') {
      await env.DB.prepare('UPDATE users SET verified = 1 WHERE id = ?').bind(req.user_id).run();
      await env.DB.prepare('UPDATE channels SET verified = 1 WHERE owner_id = ?').bind(req.user_id).run().catch(() => {});
    }
    await env.DB.prepare(
      'UPDATE verify_requests SET status = ?, decided_at = ? WHERE id = ?'
    ).bind(body.action === 'approve' ? 'approved' : 'denied', now, body.id).run();

    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
