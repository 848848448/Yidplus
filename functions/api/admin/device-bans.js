// functions/api/admin/device-bans.js
// GET    /api/admin/device-bans          -> list all bans
// POST   /api/admin/device-bans          -> ban { ip?, fingerprint?, reason? }
// DELETE /api/admin/device-bans?id=xxx   -> unban
// GET    /api/admin/device-bans?logs=1   -> login logs

import { json, corsHeaders, requireUser, isSuperOrOwner } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isSuperOrOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const url = new URL(request.url);
    if (url.searchParams.get('logs')) {
      const { results } = await env.DB.prepare(
        `SELECT l.*, u.nickname FROM login_logs l
         LEFT JOIN users u ON u.id = l.user_id
         ORDER BY l.created_at DESC LIMIT 200`
      ).all();
      return json({ ok: true, logs: results });
    }

    const { results } = await env.DB.prepare(
      `SELECT * FROM device_bans ORDER BY created_at DESC`
    ).all();
    return json({ ok: true, bans: results });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isSuperOrOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const body = await request.json();
    const { ip, fingerprint, reason } = body;
    if (!ip && !fingerprint) return json({ ok: false, error: 'ip or fingerprint required' }, 400);

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO device_bans (id, ip, fingerprint, reason, banned_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, ip || null, fingerprint || null, reason || null, user.nickname, new Date().toISOString()).run();

    return json({ ok: true, id });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isSuperOrOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return json({ ok: false, error: 'id required' }, 400);

    await env.DB.prepare(`DELETE FROM device_bans WHERE id = ?`).bind(id).run();
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
        }
