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

    // Grandfather everyone who already has an account. email_verified only
    // started being set when that column was added, so older accounts are NULL
    // — and login refuses those while this is on, with no way for them to fix
    // it: the verification mail only goes out at registration, which they're
    // long past. Switching this on would have locked out the existing
    // community. The point is to stop NEW fake addresses, so it applies from
    // here forward; people already using the site have proven themselves by
    // using it.
    let grandfathered = 0;
    if (enabled) {
      const res = await env.DB.prepare(
        'UPDATE users SET email_verified = 1 WHERE email_verified IS NULL OR email_verified = 0'
      ).run().catch(() => null);
      grandfathered = (res && res.meta && res.meta.changes) || 0;
    }

    await env.DB.prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES ('require_email_verify', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')"
    ).bind(enabled ? 'true' : 'false').run();

    return json({ ok: true, enabled: !!enabled, grandfathered });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
