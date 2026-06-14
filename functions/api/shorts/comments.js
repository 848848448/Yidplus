// functions/api/shorts/comments.js
// GET  /api/shorts/comments?short_id=xxx -> list comments
// POST /api/shorts/comments              -> { short_id, text } add comment

import { json, corsHeaders, requireUser } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const url = new URL(request.url);
    const shortId = url.searchParams.get('short_id');
    if (!shortId) return json({ ok: false, error: 'short_id is required' }, 400);

    const { results } = await env.DB.prepare(
      `SELECT id, user_id, nickname, text, created_at FROM short_comments
       WHERE short_id = ? ORDER BY created_at ASC LIMIT 200`
    ).bind(shortId).all();

    return json({ ok: true, comments: results });
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
    const shortId = body.short_id;
    const text = (body.text || '').trim();
    if (!shortId || !text) return json({ ok: false, error: 'short_id and text are required' }, 400);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO short_comments (id, short_id, user_id, nickname, text, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, shortId, user.id, user.nickname, text, now).run();

    return json({ ok: true, comment: { id, user_id: user.id, nickname: user.nickname, text, created_at: now } }, 201);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
      }
