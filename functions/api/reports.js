// functions/api/reports.js
// GET  /api/reports                -> list reports (admin only)
// POST /api/reports                -> { reported_id, reported_nick, room_id, message_id, reason, details }
// PUT  /api/reports                -> { id, resolved } mark resolved (admin only)

import { json, corsHeaders, requireUser, isAdminRole } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const { results } = await env.DB.prepare(
      `SELECT id, reporter_id, reported_id, reported_nick, room_id, message_id, reason, details, resolved, created_at
       FROM reports ORDER BY created_at DESC LIMIT 100`
    ).all();

    return json({ ok: true, reports: results });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const body = await request.json();
    const reportedId = body.reported_id;
    const reason = (body.reason || '').trim();
    if (!reportedId || !reason) return json({ ok: false, error: 'reported_id and reason are required' }, 400);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO reports (id, reporter_id, reported_id, reported_nick, room_id, message_id, reason, details, resolved, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).bind(id, user.id, reportedId, body.reported_nick || '', body.room_id || null, body.message_id || null, reason, body.details || '', now).run();

    return json({ ok: true }, 201);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const body = await request.json();
    if (!body.id) return json({ ok: false, error: 'id is required' }, 400);

    await env.DB.prepare(`UPDATE reports SET resolved = ? WHERE id = ?`)
      .bind(body.resolved ? 1 : 0, body.id).run();

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return json({ ok: false, error: 'id required' }, 400);
    await env.DB.prepare('DELETE FROM reports WHERE id = ?').bind(id).run();
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
           }
