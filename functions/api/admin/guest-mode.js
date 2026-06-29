// GET  /api/admin/guest-mode         -> { enabled: bool } (public — no auth needed)
// POST /api/admin/guest-mode         -> toggle (owner only)

import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestGet(context) {
  const { env } = context;
  try {
    const row = await env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = 'guest_mode'"
    ).first().catch(() => null);
    return json({ ok: true, enabled: row && row.value === 'true' });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    // ONLY owner + co-owner can toggle guest mode
    if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) {
      return json({ ok: false, error: 'Only the owner can change this setting' }, 403);
    }

    const { enabled } = await request.json();
    await env.DB.prepare(
      "INSERT INTO app_settings (key, value) VALUES ('guest_mode', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
    ).bind(enabled ? 'true' : 'false').run();

    return json({ ok: true, enabled: !!enabled });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
                 }
