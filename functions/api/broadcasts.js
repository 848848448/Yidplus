// functions/api/broadcasts.js
// GET  /api/broadcasts?limit=10  -> list recent broadcasts
// POST /api/broadcasts           -> create a broadcast (super admin / owner only)
// Body: { text, sender_email }

import { json, corsHeaders, requireUser, isSuperOrOwner } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const url = new URL(request.url);
    const limit = Math.min(50, parseInt(url.searchParams.get('limit') || '10', 10));

    const { results } = await env.DB.prepare(
      `SELECT id, text, sender_email, created_at FROM broadcasts
       ORDER BY created_at DESC LIMIT ?`
    ).bind(limit).all();

    return json({ ok: true, broadcasts: results });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isSuperOrOwner(user, env.OWNER_EMAIL)) {
      return json({ ok: false, error: 'Only super admins can broadcast' }, 403);
    }

    const body = await request.json();
    const text = (body.text || '').trim();
    if (!text) return json({ ok: false, error: 'text is required' }, 400);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO broadcasts (id, text, sender_email, created_at) VALUES (?, ?, ?, ?)`
    ).bind(id, text, body.sender_email || user.email, now).run();

    return json({ ok: true, broadcast: { id, text, sender_email: user.email, created_at: now } }, 201);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
