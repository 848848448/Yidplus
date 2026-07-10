// functions/api/broadcasts.js
// GET  /api/broadcasts?limit=10  -> list recent broadcasts
// POST /api/broadcasts           -> create a broadcast (super admin / owner only)
// Body: { text, sender_email }

import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from './_helpers.js';
import { activateDueScheduledBroadcasts, ensureScheduledTable } from './_scheduled.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    await activateDueScheduledBroadcasts(env);
    const url = new URL(request.url);
    const limit = Math.min(50, parseInt(url.searchParams.get('limit') || '10', 10));

    const { results } = await env.DB.prepare(
      `SELECT id, text, sender_email, created_at FROM broadcasts
       ORDER BY created_at DESC LIMIT ?`
    ).bind(limit).all();

    // Owners also get the list of upcoming scheduled broadcasts
    let scheduled = [];
    const user = await requireUser(request, env).catch(() => null);
    if (user && isOwnerOrCoOwner(user, env.OWNER_EMAIL)) {
      await ensureScheduledTable(env);
      const s = await env.DB.prepare(
        'SELECT id, text, push, scheduled_for FROM scheduled_broadcasts WHERE sent = 0 ORDER BY scheduled_for ASC'
      ).all().catch(() => ({ results: [] }));
      scheduled = s.results || [];
    }

    return json({ ok: true, broadcasts: results, scheduled });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) {
      return json({ ok: false, error: 'Only super admins can broadcast' }, 403);
    }

    const body = await request.json();
    const text = (body.text || '').trim();
    if (!text) return json({ ok: false, error: 'text is required' }, 400);

    const now = new Date();

    // ── Scheduled for later? Store it; a lazy activator publishes it when due ──
    if (body.scheduled_for) {
      const when = new Date(body.scheduled_for);
      if (isNaN(when.getTime())) return json({ ok: false, error: 'Invalid schedule time' }, 400);
      if (when.getTime() > now.getTime() + 60000) {
        await ensureScheduledTable(env);
        const sid = crypto.randomUUID();
        await env.DB.prepare(
          'INSERT INTO scheduled_broadcasts (id, text, push, scheduled_for, sender_email, created_at, sent) VALUES (?, ?, ?, ?, ?, ?, 0)'
        ).bind(sid, text, body.push ? 1 : 0, when.toISOString(), body.sender_email || user.email, now.toISOString()).run();
        return json({ ok: true, scheduled: true, scheduled_for: when.toISOString() }, 201);
      }
    }

    const id = crypto.randomUUID();
    const nowIso = now.toISOString();

    await env.DB.prepare(
      `INSERT INTO broadcasts (id, text, sender_email, created_at) VALUES (?, ?, ?, ?)`
    ).bind(id, text, body.sender_email || user.email, nowIso).run();

    return json({ ok: true, broadcast: { id, text, sender_email: user.email, created_at: nowIso } }, 201);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Owner only' }, 403);
    const url = new URL(request.url);
    const sid = url.searchParams.get('scheduled_id');
    if (!sid) return json({ ok: false, error: 'scheduled_id required' }, 400);
    await env.DB.prepare('DELETE FROM scheduled_broadcasts WHERE id = ? AND sent = 0').bind(sid).run().catch(() => {});
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
