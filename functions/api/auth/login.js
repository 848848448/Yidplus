import { json, corsHeaders, verifyPassword, hashPassword, isValidEmail, isOwnerOrCoOwner, generateSessionToken, logAttack } from '../_helpers.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const email       = (body.email || '').toLowerCase().trim();
    const password    = (body.password || '').trim();
    const fingerprint = (body.fingerprint || '').trim();

    if (!email || !password) return json({ ok: false, error: 'email and password are required' }, 400);
    if (!isValidEmail(email)) return json({ ok: false, error: 'Invalid email or password' }, 401);

    // ── IP + fingerprint ban check ──
    const ip = request.headers.get('CF-Connecting-IP') ||
               request.headers.get('X-Forwarded-For') ||
               '0.0.0.0';
    const CO_OWNER = 'jmittelman2@gmail.com';
    const isOwnerEmail = email === (env.OWNER_EMAIL || '') || email === CO_OWNER;

    if (!isOwnerEmail) {
      // Check IP ban
      if (ip && ip !== '0.0.0.0') {
        const ipBan = await env.DB.prepare(
          `SELECT id FROM device_bans WHERE ip = ? LIMIT 1`
        ).bind(ip).first().catch(() => null);
        if (ipBan) return json({ ok: false, error: 'Access denied from this device.' }, 403);
      }
      // Check fingerprint ban
      if (fingerprint) {
        const fpBan = await env.DB.prepare(
          `SELECT id FROM device_bans WHERE fingerprint = ? LIMIT 1`
        ).bind(fingerprint).first().catch(() => null);
        if (fpBan) return json({ ok: false, error: 'Access denied from this device.' }, 403);
      }

      // Check maintenance mode
      const maint = await env.DB.prepare(
        `SELECT value FROM app_settings WHERE key = 'maintenance_mode'`
      ).first().catch(() => null);
      if (maint && maint.value === 'true') {
        const msgRow = await env.DB.prepare(
          `SELECT value FROM app_settings WHERE key = 'maintenance_message'`
        ).first().catch(() => null);
        return json({ ok: false, error: (msgRow && msgRow.value) || 'Maintenance in progress. Try again soon.' }, 503);
      }
    }


    // ── Check Maintenance Mode ──
    const maintRow = await env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = 'maintenance_mode'"
    ).first().catch(() => null);
    if (maintRow && maintRow.value === 'true') {
      const OWNER_EMAILS = ['avrumy5872877@gmail.com', 'jmittelman2@gmail.com'];
      if (!OWNER_EMAILS.includes(email)) {
        return json({ ok: false, error: 'Site is under maintenance. Please try again later.' }, 503);
      }
    }

    // ── Sign-in lockdown ──
    // When enabled, NOBODY can sign in — not even existing accounts — except the
    // owner/co-owner and any email the owner has explicitly allow-listed.
    const lockRow = await env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = 'signin_locked'"
    ).first().catch(() => null);
    if (lockRow && lockRow.value === 'true' && !isOwnerEmail) {
      const allowed = await env.DB.prepare(
        'SELECT email FROM access_allowlist WHERE email = ?'
      ).bind(email).first().catch(() => null);
      if (!allowed) {
        return json({ ok: false, error: 'Sign-in is currently disabled.' }, 403);
      }
    }
    // ── Brute-force protection ──
    // Count failed attempts from this IP in last 15 minutes
    const failKey = 'login_fail_' + ip.replace(/[^0-9a-f:.]/gi, '');
    const recentFails = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM login_logs
       WHERE ip = ? AND action = 'fail' AND created_at > datetime('now', '-15 minutes')`
    ).bind(ip).first().catch(() => ({ cnt: 0 }));

    if (!isOwnerEmail && (recentFails?.cnt || 0) >= 10) {
      // A wall of failed sign-ins from one IP is a brute-force / credential-
      // stuffing attempt — record it to the security log (with full geo /
      // device intel) so the owner can see and ban the source. The shared
      // helper also auto-bans this IP once it crosses the attack threshold.
      logAttack(context, 'Brute-force login', 429, { path: '/api/auth/login', method: 'POST' });
      return json({ ok: false, error: 'Too many failed attempts. Please wait 15 minutes.' }, 429);
    }

    const user = await env.DB.prepare(
      'SELECT id, email, nickname, role, verified, email_verified, blocked, password_hash FROM users WHERE email = ?'
    ).bind(email).first();

    let loginOk = false;
    if (user) {
      const check = await verifyPassword(password, user.password_hash);
      loginOk = check.valid;
      if (check.valid && check.needsUpgrade) {
        // Legacy unsalted-SHA256 hash matched — quietly upgrade to salted PBKDF2.
        const upgraded = await hashPassword(password);
        await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
          .bind(upgraded, user.id).run().catch(() => {});
      }
    }

    if (!loginOk) {
      // Log failed attempt for brute-force tracking
      await env.DB.prepare(
        `INSERT INTO login_logs (id, user_id, ip, fingerprint, action, created_at) VALUES (?, NULL, ?, ?, 'fail', ?)`
      ).bind(crypto.randomUUID(), ip, fingerprint || null, new Date().toISOString()).run().catch(() => {});
      return json({ ok: false, error: 'Invalid email or password' }, 401);
    }
    if (user.blocked) return json({ ok: false, error: 'Account suspended. Contact support.' }, 403);

    // ── Two-factor authentication ──
    // If this account has 2FA on, a valid TOTP code is required before we issue
    // a session. Missing code → tell the client to prompt for one.
    try {
      const tf = await env.DB.prepare('SELECT totp_secret, totp_enabled FROM users WHERE id = ?').bind(user.id).first().catch(() => null);
      if (tf && tf.totp_enabled && tf.totp_secret) {
        const { verifyTotp } = await import('../_totp.js');
        const code = (body.totp_code || '').toString().trim();
        if (!code) return json({ ok: false, need_2fa: true, error: 'Enter your 6-digit authentication code.' }, 401);
        if (!(await verifyTotp(tf.totp_secret, code))) {
          return json({ ok: false, need_2fa: true, error: 'That code is not correct.' }, 401);
        }
      }
    } catch (e) { /* if the 2FA check errors, don't lock the user out */ }


    // Email verification is a soft reminder now, not a hard gate — signing in
    // never locks someone out of their own account. If the setting is on and
    // this account hasn't confirmed yet, we let them in but flag it so the app
    // can gently nudge them to verify.
    const verifySetting = await env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = 'require_email_verify'"
    ).first().catch(() => null);
    const unverified = !!(verifySetting && verifySetting.value === 'true' && !user.email_verified);

    const sessionId = generateSessionToken();
    const now = new Date().toISOString();
    await env.DB.prepare('INSERT INTO sessions (id, user_id, created_at) VALUES (?, ?, ?)').bind(sessionId, user.id, now).run();
    await env.DB.prepare('UPDATE users SET online = 1, last_ping = ? WHERE id = ?').bind(now, user.id).run()
      .catch(() => env.DB.prepare('UPDATE users SET online = 1 WHERE id = ?').bind(user.id).run());

    // Log login
    await env.DB.prepare(
      `INSERT INTO login_logs (id, user_id, ip, fingerprint, action, created_at) VALUES (?, ?, ?, ?, 'login', ?)`
    ).bind(crypto.randomUUID(), user.id, ip, fingerprint || null, now).run().catch(() => {});

    const headers = { ...corsHeaders, 'Set-Cookie': `yp_session=${sessionId}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=2592000` };
    const { password_hash, ...safeUser } = user;
    safeUser.is_owner = isOwnerOrCoOwner(user, env.OWNER_EMAIL);
    safeUser.unverified = unverified;
    return new Response(JSON.stringify({ ok: true, user: safeUser }), { status: 200, headers: { 'Content-Type': 'application/json', ...headers } });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
          }
