import { generateSessionToken } from '../_helpers.js';
import { verifyTotp } from '../_totp.js';
import { challengeCookie, challengeToken } from './_google-challenge.js';

function page(error = '', status = 200) {
  const messages = { expired: 'This sign-in expired. Start Google sign-in again.', invalid: 'That code is not correct. Try again.', unavailable: 'Security check is temporarily unavailable. Try again shortly.', limited: 'Too many attempts. Wait 15 minutes and start sign-in again.' };
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verify sign-in | YID PLUS</title><style>*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f2f5f9;color:#172337;font:16px system-ui;padding:24px}.card{width:min(100%,420px);background:#fff;padding:32px;border:1px solid #dce3ed;border-radius:24px;box-shadow:0 16px 50px #18274410}small{font-weight:800;letter-spacing:.12em;color:#087c91}h1{font-size:26px;margin:20px 0 12px}p{line-height:1.55;color:#526277}label{display:block;font-weight:650;margin:24px 0 8px}input{width:100%;font:24px system-ui;letter-spacing:.25em;padding:14px;border:1px solid #a9b7c8;border-radius:12px}button{width:100%;margin:16px 0 24px;padding:15px;background:#087c91;color:white;border:0;border-radius:12px;font:650 16px system-ui;cursor:pointer}a{color:#087c91}input:focus,button:focus-visible,a:focus-visible{outline:3px solid #72cddb;outline-offset:3px}.error{color:#a52c35}@media(prefers-color-scheme:dark){body{background:#101823;color:#edf3fa}.card{background:#192432;border-color:#334253}p{color:#bdc9d7}input{background:#101823;color:#fff}small,a{color:#78d5e3}.error{color:#ffb0b6}}</style></head><body><main class="card"><small>YID PLUS</small><h1>Verify your sign-in</h1><p>Enter the 6-digit code from your authenticator app to finish signing in with Google.</p>${error ? `<p class="error" role="alert">${messages[error] || messages.unavailable}</p>` : ''}<form method="post" action="/api/auth/google-2fa"><label for="code">Authentication code</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus><button type="submit">Verify and sign in</button></form><a href="/">Back to sign-in</a></main></body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' } });
}
async function pending(request, env) {
  const token = challengeToken(request);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return env.DB.prepare("SELECT id, user_id, ip, fingerprint FROM login_logs WHERE id = ? AND action = 'google_2fa_pending' AND julianday(created_at) > julianday('now', '-5 minutes')").bind(token).first();
}
export async function onRequestGet({ request, env }) {
  try { return await pending(request, env) ? page() : page('expired', 401); }
  catch { return page('unavailable', 503); }
}
export async function onRequestPost({ request, env }) {
  const origin = new URL(request.url).origin;
  if (request.headers.get('Origin') !== origin) return page('expired', 403);
  try {
    const challenge = await pending(request, env);
    if (!challenge) return page('expired', 401);
    const failures = await env.DB.prepare("SELECT COUNT(*) AS cnt FROM login_logs WHERE user_id = ? AND action = 'google_2fa_fail' AND julianday(created_at) > julianday('now', '-15 minutes')").bind(challenge.user_id).first();
    if ((failures?.cnt || 0) >= 10) return page('limited', 429);
    const user = await env.DB.prepare('SELECT totp_secret, totp_enabled, blocked FROM users WHERE id = ?').bind(challenge.user_id).first();
    if (!user || user.blocked || !user.totp_enabled || !user.totp_secret) return page('expired', 401);
    const form = await request.formData();
    const code = String(form.get('code') || '').trim();
    if (!/^\d{6}$/.test(code) || !await verifyTotp(user.totp_secret, code)) {
      await env.DB.prepare("INSERT INTO login_logs (id, user_id, ip, fingerprint, action, created_at) VALUES (?, ?, ?, NULL, 'google_2fa_fail', ?)").bind(crypto.randomUUID(), challenge.user_id, request.headers.get('CF-Connecting-IP') || '0.0.0.0', new Date().toISOString()).run();
      return page('invalid', 401);
    }
    // Atomic consumption prevents two successful requests using one challenge.
    const claimed = await env.DB.prepare("DELETE FROM login_logs WHERE id = ? AND action = 'google_2fa_pending' AND julianday(created_at) > julianday('now', '-5 minutes') RETURNING id").bind(challenge.id).first();
    if (!claimed) return page('expired', 401);
    const session = generateSessionToken();
    await env.DB.prepare('INSERT INTO sessions (id, user_id, created_at) VALUES (?, ?, ?)').bind(session, challenge.user_id, new Date().toISOString()).run();
    let target = new URL(challenge.fingerprint || '/', origin);
    if (target.origin !== origin) target = new URL('/', origin);
    target.searchParams.set('welcome', '1');
    const headers = new Headers({ Location: target.toString(), 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', `yp_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
    headers.append('Set-Cookie', challengeCookie('', 0));
    return new Response(null, { status: 302, headers });
  } catch { return page('unavailable', 503); }
}
