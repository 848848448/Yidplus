// functions/api/feedback.js
// GET    /api/feedback        -> list feedback (admin only)
// POST   /api/feedback        -> { type, text, device } submit feedback (any signed-in user)
// PUT    /api/feedback        -> { id, resolved } mark resolved (admin only)
// DELETE /api/feedback?id=xxx -> delete (admin only)

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
      `SELECT id, user_id, nickname, type, text, device, resolved, created_at
       FROM feedback ORDER BY created_at DESC LIMIT 100`
    ).all();

    return json({ ok: true, feedback: results });
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
    const type = body.type === 'bug' ? 'bug' : 'suggest';
    const text = (body.text || '').trim();
    if (!text) return json({ ok: false, error: 'text is required' }, 400);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO feedback (id, user_id, nickname, type, text, device, resolved, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
    ).bind(id, user.id, user.nickname, type, text, body.device || '', now).run();

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

    await env.DB.prepare(`UPDATE feedback SET resolved = ? WHERE id = ?`)
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
    if (!isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return json({ ok: false, error: 'id is required' }, 400);

    await env.DB.prepare(`DELETE FROM feedback WHERE id = ?`).bind(id).run();
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
  }
