// Two-factor authentication management.
//   GET  /api/2fa                     -> { enabled }
//   POST /api/2fa {action:'setup'}    -> { secret, otpauth } (not enabled yet)
//   POST /api/2fa {action:'enable', secret, code} -> verify code, turn 2FA on
//   POST /api/2fa {action:'disable', code}        -> verify code, turn 2FA off
import { json, corsHeaders, requireUser } from './_helpers.js';
import { verifyTotp, generateTotpSecret, otpauthUrl } from './_totp.js';

async function ensureCols(env) {
  await env.DB.prepare("ALTER TABLE users ADD COLUMN totp_secret TEXT").run().catch(() => {});
  await env.DB.prepare("ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0").run().catch(() => {});
}

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    await ensureCols(env);
    const row = await env.DB.prepare('SELECT totp_enabled FROM users WHERE id = ?').bind(user.id).first().catch(() => null);
    return json({ ok: true, enabled: !!(row && row.totp_enabled) });
  } catch (e) { return json({ ok: true, enabled: false }); }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    await ensureCols(env);
    const body = await request.json().catch(() => ({}));
    const action = body.action;

    if (action === 'setup') {
      const secret = generateTotpSecret();
      // Stash the pending secret but don't enable until a code is confirmed.
      await env.DB.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').bind(secret, user.id).run();
      return json({ ok: true, secret, otpauth: otpauthUrl(secret, user.email || user.nickname || 'account', 'YID PLUS') });
    }

    if (action === 'enable') {
      const secret = body.secret;
      const code = body.code;
      if (!secret || !code) return json({ ok: false, error: 'Secret and code required' }, 400);
      if (!(await verifyTotp(secret, code))) return json({ ok: false, error: 'That code is not correct. Try again.' }, 400);
      await env.DB.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 1 WHERE id = ?').bind(secret, user.id).run();
      return json({ ok: true, enabled: true });
    }

    if (action === 'disable') {
      const row = await env.DB.prepare('SELECT totp_secret, totp_enabled FROM users WHERE id = ?').bind(user.id).first();
      if (row && row.totp_enabled) {
        if (!body.code || !(await verifyTotp(row.totp_secret, body.code))) {
          return json({ ok: false, error: 'Enter a valid code to turn off 2FA.' }, 400);
        }
      }
      await env.DB.prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?').bind(user.id).run();
      return json({ ok: true, enabled: false });
    }

    return json({ ok: false, error: 'Unknown action' }, 400);
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}
