// functions/api/admin/maintenance.js
// GET  /api/admin/maintenance -> { maintenance_mode: bool, message: string }
// POST /api/admin/maintenance -> { enabled: bool, message?: string }

import { json, corsHeaders, requireUser, isSuperOrOwner } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { env } = context;
  try {
    const row = await env.DB.prepare(
      `SELECT value FROM app_settings WHERE key = 'maintenance_mode'`
    ).first().catch(() => null);
    const msgRow = await env.DB.prepare(
      `SELECT value FROM app_settings WHERE key = 'maintenance_message'`
    ).first().catch(() => null);
    return json({
      ok: true,
      maintenance_mode: row && row.value === 'true',
      message: msgRow ? msgRow.value : 'We\'ll be back shortly. 🛠️'
    });
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
    const enabled = !!body.enabled;
    const message = body.message || 'We\'ll be back shortly. 🛠️';

    await env.DB.prepare(
      `INSERT INTO app_settings (key, value) VALUES ('maintenance_mode', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    ).bind(enabled ? 'true' : 'false').run();
    await env.DB.prepare(
      `INSERT INTO app_settings (key, value) VALUES ('maintenance_message', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    ).bind(message).run();

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
      }
