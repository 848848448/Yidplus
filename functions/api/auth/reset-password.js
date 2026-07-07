// functions/api/auth/reset-password.js
// POST /api/auth/reset-password  { token, password }
//   Validates a one-time reset token and sets a new (hashed) password.

import { json, corsHeaders, hashPassword } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json().catch(() => ({}));
    const token = (body.token || '').trim();
    const password = body.password || '';

    if (!token) return json({ ok: false, error: 'Missing reset token' }, 400);
    if (password.length < 6) return json({ ok: false, error: 'Password must be at least 6 characters' }, 400);

    const row = await env.DB.prepare(
      'SELECT id, user_id, expires_at, used FROM password_resets WHERE token = ?'
    ).bind(token).first().catch(() => null);

    if (!row) return json({ ok: false, error: 'This reset link is invalid. Please request a new one.' }, 400);
    if (row.used) return json({ ok: false, error: 'This reset link was already used. Please request a new one.' }, 400);
    if (new Date(row.expires_at) < new Date()) {
      return json({ ok: false, error: 'This reset link has expired. Please request a new one.' }, 400);
    }

    const hash = await hashPassword(password);
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash, row.user_id).run();

    // Burn this token, and any other outstanding ones for the same user.
    await env.DB.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ?').bind(row.user_id).run();

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
