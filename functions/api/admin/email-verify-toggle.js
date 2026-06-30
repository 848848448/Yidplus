// GET  /api/admin/email-verify-toggle  -> { enabled: bool } (public)
// POST /api/admin/email-verify-toggle  -> toggle (owner/co-owner only)

import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestGet(context) {
  const { env } = context;
  try {
    const row = await env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = 'require_email_verify'"
    ).first().catch(() => null);
    // Default: OFF unless explicitly turned on
    return json({ ok: true, enabled: row ? row.value === 'true' : false });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) {
      return json({ ok: false, error: 'Only the owner can change this setting' }, 403);
    }

    const { enabled } = await request.json();
    await env.DB.prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES ('require_email_verify', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')"
    ).bind(enabled ? 'true' : 'false').run();

    return json({ ok: true, enabled: !!enabled });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
