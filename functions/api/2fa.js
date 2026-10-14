// Two-factor authentication management.
//   GET  /api/2fa                     -> { enabled }
//   POST /api/2fa {action:'setup'}    -> { secret, otpauth } (not enabled yet)
//   POST /api/2fa {action:'enable', secret, code} -> verify code, turn 2FA on
//   POST /api/2fa {action:'disable', code}        -> verify code, turn 2FA off
import { json, corsHeaders, requireUser } from './_helpers.js';
import { verifyTotp, generateTotpSecret, otpauthUrl } from './_totp.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const row = await env.DB.prepare('SELECT totp_enabled FROM users WHERE id = ?').bind(user.id).first();
    if (!row) return json({ ok: false, error: 'Security settings unavailable' }, 503);
    return json({ ok: true, enabled: !!row.totp_enabled });
  } catch (e) { return json({ ok: false, error: 'Security settings unavailable' }, 503); }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const body = await request.json().catch(() => ({}));
    const action = body.action;

    const current = await env.DB.prepare('SELECT totp_secret, totp_enabled FROM users WHERE id = ?').bind(user.id).first();
    if (!current) return json({ ok: false, error: 'Security settings unavailable' }, 503);
    const recent = await env.DB.prepare("SELECT COUNT(*) as cnt FROM login_logs WHERE user_id = ? AND action = '2fa_fail' AND julianday(created_at) > julianday('now', '-15 minutes')").bind(user.id).first();
    if ((recent && recent.cnt || 0) >= 10) return json({ ok: false, error: 'Too many attempts. Wait 15 minutes.' }, 429);
    const failed = async () => { await env.DB.prepare("INSERT INTO login_logs (id, user_id, ip, fingerprint, action, created_at) VALUES (?, ?, ?, NULL, '2fa_fail', ?)").bind(crypto.randomUUID(), user.id, request.headers.get('CF-Connecting-IP') || '0.0.0.0', new Date().toISOString()).run(); };

    if (action === 'setup') {
      if (current.totp_enabled) return json({ ok: false, error: 'Two-factor authentication is already on. Turn it off with a current code before setting it up again.' }, 409);
      const secret = generateTotpSecret();
      // Stash the pending secret but don't enable until a code is confirmed.
      const saved = await env.DB.prepare('UPDATE users SET totp_secret = ? WHERE id = ? AND COALESCE(totp_enabled, 0) = 0').bind(secret, user.id).run();
      if (saved.meta?.changes === 0) return json({ ok: false, error: 'Security settings changed. Refresh and try again.' }, 409);
      return json({ ok: true, secret, otpauth: otpauthUrl(secret, user.email || user.nickname || 'account', 'YID PLUS') });
    }

    if (action === 'enable') {
      if (current.totp_enabled) return json({ ok: false, error: 'Two-factor authentication is already on.' }, 409);
      const secret = current.totp_secret;
      if (body.secret !== secret) return json({ ok: false, error: 'Setup expired. Begin setup again.' }, 400);
      const code = body.code;
      if (!secret || !code) return json({ ok: false, error: 'Secret and code required' }, 400);
      if (!(await verifyTotp(secret, code))) { await failed(); return json({ ok: false, error: 'That code is not correct. Try again.' }, 400); }
      const saved = await env.DB.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ? AND totp_secret = ? AND COALESCE(totp_enabled, 0) = 0').bind(user.id, secret).run();
      if (saved.meta?.changes === 0) return json({ ok: false, error: 'Setup changed. Begin setup again.' }, 409);
      return json({ ok: true, enabled: true });
    }

    if (action === 'disable') {
      const row = current;
      if (row && row.totp_enabled) {
        if (!body.code || !(await verifyTotp(row.totp_secret, body.code))) {
          await failed();
          return json({ ok: false, error: 'Enter a valid code to turn off 2FA.' }, 400);
        }
      }
      const saved = await env.DB.prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ? AND totp_secret IS ? AND COALESCE(totp_enabled, 0) = ?').bind(user.id, row.totp_secret, row.totp_enabled ? 1 : 0).run();
      if (saved.meta?.changes === 0) return json({ ok: false, error: 'Security settings changed. Refresh and try again.' }, 409);
      return json({ ok: true, enabled: false });
    }

    return json({ ok: false, error: 'Unknown action' }, 400);
  } catch (e) { return json({ ok: false, error: 'Security settings unavailable. Try again shortly.' }, 503); }
}
