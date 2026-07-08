// GET /api/auth/google-callback?code=...&state=...
// Exchanges the Google auth code for tokens, creates/logs in the user, sets session cookie.
import { json, generateSessionToken } from '../_helpers.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const origin = url.origin;

  const code = url.searchParams.get('code');
  const stateRaw = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    return Response.redirect(`${origin}/index.html?error=google_${encodeURIComponent(error)}`, 302);
  }
  if (!code) {
    return Response.redirect(`${origin}/index.html?error=google_no_code`, 302);
  }

  let returnTo = '/';
  try {
    const state = JSON.parse(atob(stateRaw || ''));
    if (state && state.returnTo) returnTo = state.returnTo;
  } catch (e) {}

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
    if (!tokenData.id_token) {
      return Response.redirect(`${origin}/index.html?error=google_token_failed`, 302);
    }

    // ── Decode the ID token (JWT) to get user info ──
    // (Google's id_token is already signature-verified by Google during exchange over HTTPS;
    //  we trust it since we got it directly from token endpoint with our client_secret.)
    const payloadB64 = tokenData.id_token.split('.')[1];
    const payloadJson = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
    const profile = JSON.parse(payloadJson);

    const email = (profile.email || '').toLowerCase().trim();
    const emailVerified = profile.email_verified;
    const googlePhoto = profile.picture;
    const googleName = profile.name || (email ? email.split('@')[0] : 'user');

    if (!email || !emailVerified) {
      return Response.redirect(`${origin}/index.html?error=google_email_unverified`, 302);
    }

    // ── Check Maintenance Mode ──
    const maintRow = await env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = 'maintenance_mode'"
    ).first().catch(() => null);
    if (maintRow && maintRow.value === 'true') {
      const OWNER_EMAILS_M = ['avrumy5872877@gmail.com', 'jmittelman2@gmail.com'];
      if (!OWNER_EMAILS_M.includes(email)) {
        return Response.redirect(`${origin}/?error=maintenance`, 302);
      }
    }

    // ── Check device bans (same as regular login) ──
    const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
    const isOwnerEmail = email === env.OWNER_EMAIL || email === 'jmittelman2@gmail.com';

    if (!isOwnerEmail && ip && ip !== '0.0.0.0') {
      const ipBan = await env.DB.prepare(`SELECT id FROM device_bans WHERE ip = ? LIMIT 1`).bind(ip).first().catch(() => null);
      if (ipBan) return Response.redirect(`${origin}/index.html?error=banned`, 302);
    }

    // ── Find existing user by email ──
    let user = await env.DB.prepare(
      'SELECT id, email, nickname, role, verified, blocked, photo_url FROM users WHERE email = ?'
    ).bind(email).first();

    if (user && user.blocked) {
      return Response.redirect(`${origin}/index.html?error=suspended`, 302);
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
      ).bind(userId, email, nickname, 'GOOGLE_OAUTH_NO_PASSWORD', googlePhoto || null, now).run();

      user = { id: userId, email, nickname, role: 'member', verified: 0, blocked: 0, photo_url: googlePhoto };
    } else if (googlePhoto && !user.photo_url) {
      // Backfill photo if missing
      await env.DB.prepare('UPDATE users SET photo_url = ? WHERE id = ?').bind(googlePhoto, user.id).run().catch(() => {});
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

    return new Response(null, {
      status: 302,
      headers: {
        'Location': successUrl.toString(),
        'Set-Cookie': cookie,
      },
    });
  } catch (err) {
    return Response.redirect(`${origin}/index.html?error=google_failed&msg=${encodeURIComponent(err.message)}`, 302);
  }
                             }
