// functions/api/admin/verify-pin.js
// POST /api/admin/verify-pin { pin }
//
// Server-side verification for the admin panel's second-factor PIN.
// Previously this was checked entirely in the browser against a PIN
// hardcoded in client JS ('1234' by default) — trivially readable in page
// source and bypassable by anyone. This endpoint requires the caller to
// already have a real, valid session (requireUser) AND an admin role
// before the PIN is even considered, and rate-limits guesses since a
// 4-digit PIN only has 10,000 possibilities.

import { json, corsHeaders, requireUser, isAdminRole, logAttack, clientIp } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    // Rate limit: max 8 failed PIN attempts per user per 15 minutes.
    const recentFails = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM login_logs
       WHERE user_id = ? AND action = 'admin_pin_fail' AND created_at > datetime('now', '-15 minutes')`
    ).bind(user.id).first().catch(() => ({ cnt: 0 }));

    if ((recentFails?.cnt || 0) >= 8) {
      return json({ ok: false, error: 'Too many attempts. Please wait 15 minutes.' }, 429);
    }

    const body = await request.json();
    const pin = (body.pin || '').toString();

    const expected = env.ADMIN_PIN;
    if (!expected) {
      // No PIN configured on the server — fail closed rather than silently
      // accept anything.
      return json({ ok: false, error: 'Admin PIN is not configured on the server.' }, 500);
    }

    if (pin !== expected) {
      const ip = clientIp(request);

      await env.DB.prepare(
        `INSERT INTO login_logs (id, user_id, ip, fingerprint, action, created_at) VALUES (?, ?, ?, ?, 'admin_pin_fail', ?)`
      ).bind(crypto.randomUUID(), user.id, ip, null, new Date().toISOString()).run().catch(() => {});

      // Also surface it in the Attacks panel with full geo/device intel. A wall
      // of wrong-PIN guesses means someone already got past the email gate and
      // is now attacking the second factor — exactly what the owner wants to
      // watch. The account used to guess is folded into the displayed path.
      logAttack(context, 'Admin PIN guess', 401, {
        method: 'POST',
        path: '/api/admin/verify-pin  (acct: ' + (user.email || user.id || '?') + ')',
      });

      return json({ ok: false, error: 'Incorrect PIN.' }, 401);
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
