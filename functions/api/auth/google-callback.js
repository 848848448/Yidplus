import { createGoogleChallenge, challengeCookie } from './_google-challenge.js';
// GET /api/auth/google-callback?code=...&state=...
// Exchanges the Google auth code for tokens, creates/logs in the user, sets session cookie.
import { validateState, stateCookie } from './_oauth-state.js';
import { json, generateSessionToken, notifyAdmin, isOwnerEmail, GOOGLE_OAUTH_SENTINEL } from '../_helpers.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const origin = url.origin;

  const code = url.searchParams.get('code');
  const stateRaw = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  // Reject unsolicited or mismatched callbacks before any token exchange or DB work.
  const checkedState = validateState(request, stateRaw, origin);
  const redirect = (path) => new Response(null, { status: 302, headers: {
    Location: new URL(path, origin).toString(), 'Set-Cookie': stateCookie('', 0), 'Cache-Control': 'no-store'
  } });
  if (!checkedState) return redirect('/index.html?error=google_invalid_state');
  if (error) return redirect('/index.html?error=google_cancelled');
  if (!code) return redirect('/index.html?error=google_no_code');
  const returnTo = checkedState.returnTo;

  try {
    const redirectUri = `${origin}/api/auth/google-callback`;

    // ── Exchange code for tokens ──
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.id_token) {
      return redirect('/index.html?error=google_token_failed');
    }

    // ── Decode the ID token (JWT) to get user info ──
    // (Google's id_token is already signature-verified by Google during exchange over HTTPS;
    //  we trust it since we got it directly from token endpoint with our client_secret.)
    const payloadB64 = tokenData.id_token.split('.')[1];
    const payloadJson = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
    const profile = JSON.parse(payloadJson);

    if (profile.aud !== env.GOOGLE_CLIENT_ID || !['accounts.google.com', 'https://accounts.google.com'].includes(profile.iss) || !Number.isFinite(profile.exp) || profile.exp * 1000 <= Date.now() || !profile.sub) return redirect('/index.html?error=google_invalid_token');

    const email = (profile.email || '').toLowerCase().trim();
    const emailVerified = profile.email_verified;
    const googlePhoto = profile.picture;
    const googleName = profile.name || (email ? email.split('@')[0] : 'user');

    if (!email || emailVerified !== true) {
      return redirect('/index.html?error=google_email_unverified');
    }

    // ── Check Maintenance Mode ──
    const maintRow = await env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = 'maintenance_mode'"
    ).first().catch(() => null);
    if (maintRow && maintRow.value === 'true') {
      if (!isOwnerEmail(email, env.OWNER_EMAIL)) {
        return redirect('/?error=maintenance');
      }
    }

    // ── Check device bans (same as regular login) ──
    const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
    const emailIsOwner = isOwnerEmail(email, env.OWNER_EMAIL);

    if (!emailIsOwner && ip && ip !== '0.0.0.0') {
      const ipBan = await env.DB.prepare(`SELECT id FROM device_bans WHERE ip = ? LIMIT 1`).bind(ip).first().catch(() => null);
      if (ipBan) return redirect('/index.html?error=banned');
    }

    // ── Sign-in lockdown (same rule as email login/register) ──
    // When enabled, Google sign-in is blocked too — except the owner and any
    // allow-listed email. Otherwise Google would be a back door around the lock.
    const lockRow = await env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = 'signin_locked'"
    ).first().catch(() => null);
    if (lockRow && lockRow.value === 'true' && !emailIsOwner) {
      const allowed = await env.DB.prepare(
        'SELECT email FROM access_allowlist WHERE email = ?'
      ).bind(email).first().catch(() => null);
      if (!allowed) {
        return redirect('/?error=signin_disabled');
      }
    }

    // ── Find existing user by email ──
    let user = await env.DB.prepare(
      'SELECT id, email, nickname, role, verified, blocked, photo_url FROM users WHERE email = ?'
    ).bind(email).first();

    if (user && user.blocked) {
      return redirect('/index.html?error=suspended');
    }

    if (!user) {
      // ── Create new account automatically ──
      // Generate a unique nickname from the Google name
      let baseNick = googleName.replace(/[^a-zA-Z0-9_\u0590-\u05FF]/g, '').slice(0, 16) || 'user';
      let nickname = baseNick;
      let suffix = 0;
      while (true) {
        const exists = await env.DB.prepare('SELECT 1 FROM users WHERE nickname = ?').bind(nickname).first();
        if (!exists) break;
        suffix++;
        nickname = baseNick.slice(0, 14) + suffix;
      }

      const userId = crypto.randomUUID();
      const now = new Date().toISOString();

      await env.DB.prepare(
        `INSERT INTO users (id, email, nickname, password_hash, role, verified, blocked,
          photo_url, email_verified, created_at)
         VALUES (?, ?, ?, ?, 'member', 0, 0, ?, 1, ?)`
      ).bind(userId, email, nickname, GOOGLE_OAUTH_SENTINEL, googlePhoto || null, now).run();

      user = { id: userId, email, nickname, role: 'member', verified: 0, blocked: 0, photo_url: googlePhoto };

      // New Google sign-up → tell the owner's admin bot.
      const _esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      context.waitUntil(notifyAdmin(env, '🆕 <b>New sign-up</b> (Google)\n👤 ' + _esc(nickname) + '\n📧 ' + _esc(email), 'signup'));
    } else if (googlePhoto && !user.photo_url) {
      // Backfill photo if missing
      await env.DB.prepare('UPDATE users SET photo_url = ? WHERE id = ?').bind(googlePhoto, user.id).run().catch(() => {});
    }

    // Local authenticator protection applies to Google sign-in as well.
    const security = await env.DB.prepare('SELECT totp_secret, totp_enabled FROM users WHERE id = ?').bind(user.id).first();
    if (!security || (security.totp_enabled && !security.totp_secret)) return redirect('/index.html?error=google_failed');
    if (security.totp_enabled) {
      const token = await createGoogleChallenge(env, user.id, ip, returnTo);
      const headers = new Headers({ Location: new URL('/api/auth/google-2fa', origin).toString(), 'Cache-Control': 'no-store' });
      headers.append('Set-Cookie', challengeCookie(token));
      headers.append('Set-Cookie', stateCookie('', 0));
      return new Response(null, { status: 302, headers });
    }

    // ── Create session ──
    const sessionId = generateSessionToken();

    await env.DB.prepare(
      'INSERT INTO sessions (id, user_id, created_at) VALUES (?, ?, ?)'
    ).bind(sessionId, user.id, new Date().toISOString()).run();

    // Log login
    await env.DB.prepare(
      `INSERT INTO login_logs (id, user_id, ip, fingerprint, action, created_at) VALUES (?, ?, ?, ?, 'google_login', ?)`
    ).bind(crypto.randomUUID(), user.id, ip, null, new Date().toISOString()).run().catch(() => {});

    const cookie = `yp_session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30*24*60*60}`;

    const successUrl = new URL(`${origin}${returnTo}`);
    successUrl.searchParams.set('welcome', '1');

    const headers = new Headers({ Location: successUrl.toString(), 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', cookie);
    headers.append('Set-Cookie', stateCookie('', 0));
    return new Response(null, { status: 302, headers });
  } catch (err) {
    return redirect('/index.html?error=google_failed');
  }
}
