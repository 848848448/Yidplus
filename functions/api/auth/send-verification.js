// Internal helper, called by register.js — sends a verification email via Resend.
// Also exposed as POST /api/auth/send-verification { email } for "resend" button.
import { json, corsHeaders, requireUser } from '../_helpers.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function sendVerificationEmail(env, userId, email, origin) {
  if (!env.RESEND_API_KEY) {
    console.warn('[email-verify] RESEND_API_KEY not configured — skipping email');
    return;
  }

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h

  await env.DB.prepare(
    'INSERT INTO email_verifications (id, user_id, email, token, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), userId, email, token, expiresAt).run();

  const verifyUrl = `${origin}/api/auth/verify-email?token=${token}`;

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
      subject: 'Confirm your YID PLUS account',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#1F6F5C">Welcome to YID PLUS! 🎉</h2>
          <p>Please confirm your email address to activate your account.</p>
          <a href="${verifyUrl}" style="display:inline-block;background:#1F6F5C;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0">
            Confirm My Email
          </a>
          <p style="color:#888;font-size:13px">This link expires in 24 hours. If you didn't sign up for YID PLUS, you can ignore this email.</p>
        </div>
      `,
    }),
  }).catch(err => ({ ok: false, _networkError: err.message }));

  // fetch() only rejects on a network failure — a rejected send (bad
  // domain, invalid key, unverified sender) comes back as a normal
  // response with resp.ok === false, which the old code never checked at
  // all, so a failed send was silently treated as a success. Now we
  // actually check it, and log failures somewhere the owner can see them
  // (the Audit Log panel), since Worker console.error isn't visible
  // without the Cloudflare dashboard/wrangler tail.
  if (!resp.ok) {
    let detail = resp._networkError || '';
    if (!detail) { try { detail = JSON.stringify(await resp.json()); } catch (e) { detail = 'HTTP ' + resp.status; } }
    console.error('[email-verify] send failed:', detail);
    await env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_id, actor_nick, actor_role, action, target_type, target_id, details, created_at)
       VALUES (?, 'system', 'System', 'system', 'email_send_failed', 'user', ?, ?, ?)`
    ).bind(crypto.randomUUID(), userId, `Verification email to ${email} failed: ${detail}`, new Date().toISOString()).run().catch(() => {});
  }
}

// Allow resending
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json().catch(() => ({}));
    let email = (body.email || '').toLowerCase().trim();

    if (!email) {
      // No email in the body — fall back to the signed-in session, if any.
      const sessionUser = await requireUser(request, env).catch(() => null);
      if (!sessionUser) return json({ ok: false, error: 'email required' }, 400);
      email = sessionUser.email;
    }

    const user = await env.DB.prepare('SELECT id, email_verified FROM users WHERE email = ?').bind(email).first();
    if (!user) return json({ ok: true }); // don't leak whether email exists
    if (user.email_verified) return json({ ok: true, already_verified: true });

    const origin = new URL(request.url).origin;
    await sendVerificationEmail(env, user.id, email, origin);

    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
