// functions/api/auth/verify-password.js
// POST { password } -> { ok, valid, no_password }
// Confirms the signed-in user's password before a sensitive action (sign out,
// delete account). OAuth-only accounts have no password → no_password:true so
// the client can fall back to a plain confirmation.

import { json, corsHeaders, requireUser, verifyPassword } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
      .bind(user.id).first();
    if (!row || !row.password_hash) {
      return json({ ok: true, no_password: true, valid: true });
    }

    let body = {};
    try { body = await request.json(); } catch (e) {}
    const password = (body && body.password) || '';
    if (!password) return json({ ok: true, valid: false });

    const valid = await verifyPassword(password, row.password_hash);
    return json({ ok: true, valid: !!valid });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
