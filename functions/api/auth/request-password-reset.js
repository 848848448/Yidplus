// functions/api/auth/request-password-reset.js
// POST /api/auth/request-password-reset  { email }
//   Creates a one-time reset token and emails a reset link. Always returns
//   ok:true regardless of whether the email exists, so nobody can use this
//   to discover which addresses are registered (enumeration).

import { json, corsHeaders } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json().catch(() => ({}));
    const email = (body.email || '').toLowerCase().trim();
    if (!email) return json({ ok: false, error: 'email required' }, 400);

    const user = await env.DB.prepare('SELECT id, email FROM users WHERE email = ?').bind(email).first();

    // Always behave the same whether or not the account exists.
    if (!user) return json({ ok: true });

    if (!env.RESEND_API_KEY) {
      console.warn('[password-reset] RESEND_API_KEY not configured — cannot send email');
      return json({ ok: true });
    }

    // Make sure the storage table exists (id, user_id, email, token, expires_at, used).
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS password_resets (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, email TEXT NOT NULL,
        token TEXT NOT NULL, expires_at TEXT NOT NULL, used INTEGER DEFAULT 0, created_at TEXT
      )`
    ).run().catch(() => {});

    // Invalidate any earlier unused tokens for this user so only the newest works.
    await env.DB.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0')
      .bind(user.id).run().catch(() => {});

    const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString(); // 1 hour

    await env.DB.prepare(
      'INSERT INTO password_resets (id, user_id, email, token, expires_at, used, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
    ).bind(crypto.randomUUID(), user.id, email, token, expiresAt, now.toISOString()).run();

    const origin = new URL(request.url).origin;
    const resetUrl = `${origin}/reset-password?token=${token}`;
    const fromAddr = env.RESEND_FROM_EMAIL || 'YID PLUS <onboarding@resend.dev>';

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddr,
        to: [email],
        subject: 'Reset your YID PLUS password',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
            <h2 style="color:#1F6F5C">Reset your password</h2>
            <p>We got a request to reset the password on your YID PLUS account. Tap the button below to choose a new one.</p>
            <a href="${resetUrl}" style="display:inline-block;background:#1F6F5C;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0">
              Set a New Password
            </a>
            <p style="color:#888;font-size:13px">This link expires in 1 hour and can be used once. If you didn't ask to reset your password, you can safely ignore this email — your password won't change.</p>
          </div>
        `,
      }),
    }).catch(err => ({ ok: false, _networkError: err.message }));

    if (!resp.ok) {
      let detail = resp._networkError || '';
      if (!detail) { try { detail = JSON.stringify(await resp.json()); } catch (e) { detail = 'HTTP ' + resp.status; } }
      console.error('[password-reset] send failed:', detail);
      await env.DB.prepare(
        `INSERT INTO audit_logs (id, actor_id, actor_nick, actor_role, action, target_type, target_id, details, created_at)
         VALUES (?, 'system', 'System', 'system', 'email_send_failed', 'user', ?, ?, ?)`
      ).bind(crypto.randomUUID(), user.id, `Password-reset email to ${email} failed: ${detail}`, new Date().toISOString()).run().catch(() => {});
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
