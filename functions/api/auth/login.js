import { json, corsHeaders, verifyPassword, hashPassword, isValidEmail, isOwnerOrCoOwner } from '../_helpers.js';

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
    // ── Brute-force protection ──
    // Count failed attempts from this IP in last 15 minutes
    const failKey = 'login_fail_' + ip.replace(/[^0-9a-f:.]/gi, '');
    const recentFails = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM login_logs
       WHERE ip = ? AND action = 'fail' AND created_at > datetime('now', '-15 minutes')`
    ).bind(ip).first().catch(() => ({ cnt: 0 }));

    if (!isOwnerEmail && (recentFails?.cnt || 0) >= 10) {
      return json({ ok: false, error: 'Too many failed attempts. Please wait 15 minutes.' }, 429);
    }

    const user = await env.DB.prepare(
      'SELECT id, email, nickname, role, verified, blocked, password_hash FROM users WHERE email = ?'
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

    const sessionId = crypto.randomUUID();
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
