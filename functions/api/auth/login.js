import { json, corsHeaders, verifyPassword, hashPassword, isValidEmail, isOwnerOrCoOwner, generateSessionToken } from '../_helpers.js';

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
      // stuffing attempt — record it to the security log so the owner can see
      // and ban the source. Best-effort, in the background, never blocks.
      try {
        const cf = request.cf || {};
        const bfWork = (async () => {
          await env.DB.prepare(
            `CREATE TABLE IF NOT EXISTS attack_logs (
               id TEXT PRIMARY KEY, ip TEXT, country TEXT, city TEXT, region TEXT,
               asn TEXT, method TEXT, path TEXT, attack_type TEXT, user_agent TEXT,
               referer TEXT, status INTEGER, created_at TEXT
             )`
          ).run().catch(() => {});
          await env.DB.prepare(
            `INSERT INTO attack_logs
               (id, ip, country, city, region, asn, method, path, attack_type, user_agent, referer, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'POST', '/api/auth/login', 'Brute-force login', ?, '', 429, datetime('now'))`
          ).bind(
            crypto.randomUUID(), ip,
            (request.headers.get('CF-IPCountry') || cf.country || '').slice(0, 8),
            (cf.city || '').slice(0, 80), (cf.region || '').slice(0, 80),
            (cf.asOrganization || (cf.asn ? ('AS' + cf.asn) : '')).slice(0, 120),
            (request.headers.get('User-Agent') || '').slice(0, 400)
          ).run().catch(() => {});
        })();
        if (context.waitUntil) context.waitUntil(bfWork);
      } catch (e) { /* never break login over a log write */ }
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

    // The requirement is only meaningful if it's actually enforced here: the
    // password being right doesn't prove the address belongs to them. Checked
    // at login rather than baked into the account, so turning the setting on
    // applies to everyone from that moment, and turning it off lets them in
    // again — accounts made while it was off are already marked verified.
    const verifySetting = await env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = 'require_email_verify'"
    ).first().catch(() => null);
    if (verifySetting && verifySetting.value === 'true' && !user.email_verified) {
      return json({
        ok: false,
        error: 'Please confirm your email address first — check your inbox for the link we sent.',
        needs_verification: true,
        email: user.email,
      }, 403);
    }

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
    return new Response(JSON.stringify({ ok: true, user: safeUser }), { status: 200, headers: { 'Content-Type': 'application/json', ...headers } });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
          }
