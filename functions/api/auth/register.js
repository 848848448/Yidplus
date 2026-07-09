import { json, corsHeaders, hashPassword, isValidEmail, generateSessionToken, checkRateLimit } from '../_helpers.js';
import { sendVerificationEmail } from './send-verification.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    // Cap automated mass-signups: at most 5 new accounts per IP per hour.
    const allowed = await checkRateLimit(env, request, 'register', 5, 60);
    if (!allowed) return json({ ok: false, error: 'Too many sign-up attempts. Please try again later.' }, 429);

    const body = await request.json();
    const email       = (body.email || '').toLowerCase().trim();
    const nickname    = (body.nickname || '').trim();
    const password    = (body.password || '').trim();
    const phone       = (body.phone || '').trim();
    const fingerprint = (body.fingerprint || '').trim();

    if (!email || !nickname || !password) return json({ ok: false, error: 'email, nickname and password are required' }, 400);

    // ── Check Maintenance Mode ──
    const maintRow = await env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = 'maintenance_mode'"
    ).first().catch(() => null);
    if (maintRow && maintRow.value === 'true') {
      const OWNER_EMAILS = ['avrumy5872877@gmail.com', 'jmittelman2@gmail.com'];
      if (!OWNER_EMAILS.includes(email)) {
        return json({ ok: false, error: 'Site is under maintenance. Registration is temporarily disabled.' }, 503);
      }
    }

    // ── Sign-in lockdown ──
    // New sign-ups are blocked while sign-in is locked, UNLESS the owner has
    // pre-authorized this exact email (allowlist). That lets the owner invite one
    // specific person in without opening registration to the public.
    const _lockRow = await env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = 'signin_locked'"
    ).first().catch(() => null);
    if (_lockRow && _lockRow.value === 'true') {
      const OWNER_EMAILS = ['avrumy5872877@gmail.com', 'jmittelman2@gmail.com'];
      const preAllowed = await env.DB.prepare(
        'SELECT email FROM access_allowlist WHERE email = ?'
      ).bind(email).first().catch(() => null);
      if (!OWNER_EMAILS.includes(email) && !preAllowed) {
        return json({ ok: false, error: 'Sign-up is currently disabled.' }, 403);
      }
    }


    // ── Validate email format
    if (!isValidEmail(email)) {
      return json({ ok: false, error: 'Invalid email address' }, 400);
    }
    // ── Validate nickname
    if (nickname.length < 3)  return json({ ok: false, error: 'Nickname must be at least 3 characters' }, 400);
    if (nickname.length > 20) return json({ ok: false, error: 'Nickname must be 20 characters or less' }, 400);
    if (!/^[a-zA-Z0-9_\u0590-\u05FF]+$/.test(nickname)) {
      return json({ ok: false, error: 'Nickname can only contain letters, numbers and underscores' }, 400);
    }
    // ── Validate password strength
    if (password.length < 6) return json({ ok: false, error: 'Password must be at least 6 characters' }, 400);
    if (password.length > 128) return json({ ok: false, error: 'Password too long' }, 400);

    const isOwnerEmail = email === env.OWNER_EMAIL || email === 'jmittelman2@gmail.com';

    // ── IP + fingerprint ban check (non-owners only) ──
    const ip = request.headers.get('CF-Connecting-IP') ||
               request.headers.get('X-Forwarded-For') ||
               '0.0.0.0';

    if (!isOwnerEmail) {
      if (ip && ip !== '0.0.0.0') {
        const ipBan = await env.DB.prepare(
          `SELECT id FROM device_bans WHERE ip = ? LIMIT 1`
        ).bind(ip).first().catch(() => null);
        if (ipBan) return json({ ok: false, error: 'Registration not allowed from this device.' }, 403);

        // Rate limit: max 3 registrations per IP per hour
        const recentRegs = await env.DB.prepare(
          `SELECT COUNT(*) as cnt FROM users WHERE created_at > datetime('now', '-1 hour')`
        ).first().catch(() => ({ cnt: 0 }));
        // Also check login_logs for registration attempts from this IP
        const ipRegs = await env.DB.prepare(
          `SELECT COUNT(*) as cnt FROM login_logs WHERE ip = ? AND action = 'register' AND created_at > datetime('now', '-1 hour')`
        ).bind(ip).first().catch(() => ({ cnt: 0 }));
        if ((ipRegs?.cnt || 0) >= 3) {
          return json({ ok: false, error: 'Too many accounts created from this device. Try again later.' }, 429);
        }
      }
      if (fingerprint) {
        const fpBan = await env.DB.prepare(
          `SELECT id FROM device_bans WHERE fingerprint = ? LIMIT 1`
        ).bind(fingerprint).first().catch(() => null);
        if (fpBan) return json({ ok: false, error: 'Registration not allowed from this device.' }, 403);
      }

      // Maintenance check
      const maint = await env.DB.prepare(
        `SELECT value FROM app_settings WHERE key = 'maintenance_mode'`
      ).first().catch(() => null);
      if (maint && maint.value === 'true') {
        return json({ ok: false, error: 'Registration is temporarily closed. Try again soon.' }, 503);
      }

      // Registration open check
      const regSetting = await env.DB.prepare(
        `SELECT value FROM app_settings WHERE key = 'registration_open'`
      ).first().catch(() => null);
      const regOpen = !regSetting || regSetting.value !== 'false';
      if (!regOpen) {
        return json({ ok: false, error: 'Registration is currently closed. Contact the admin to request access.' }, 403);
      }
    }

    const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (exists) return json({ ok: false, error: 'Email already registered' }, 409);

    const nickExists = await env.DB.prepare('SELECT id FROM users WHERE nickname = ?').bind(nickname).first();
    if (nickExists) return json({ ok: false, error: 'Nickname already taken' }, 409);

    const hash = await hashPassword(password);

    const userId = crypto.randomUUID();
    const now = new Date().toISOString();
    const role = isOwnerEmail ? 'admin_super' : 'member';

    await env.DB.prepare(
      'INSERT INTO users (id, email, nickname, phone, password_hash, role, verified, blocked, online, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?)'
    ).bind(userId, email, nickname, phone || null, hash, role, now).run();

    // Auto-create channel
    await env.DB.prepare(
      'INSERT INTO channels (id, owner_id, nickname, followers, following, total_views, verified, bio, created_at) VALUES (?, ?, ?, 0, 0, 0, 0, NULL, ?)'
    ).bind(crypto.randomUUID(), userId, nickname, now).run();

    const sessionId = generateSessionToken();
    await env.DB.prepare('INSERT INTO sessions (id, user_id, created_at) VALUES (?, ?, ?)').bind(sessionId, userId, now).run();
    await env.DB.prepare('UPDATE users SET online = 1 WHERE id = ?').bind(userId).run();

    // Log registration
    await env.DB.prepare(
      `INSERT INTO login_logs (id, user_id, ip, fingerprint, action, created_at) VALUES (?, ?, ?, ?, 'register', ?)`
    ).bind(crypto.randomUUID(), userId, ip, fingerprint || null, now).run().catch(() => {});

    // ── Send verification email if admin has enabled this requirement ──
    const verifySetting = await env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = 'require_email_verify'"
    ).first().catch(() => null);
    const requireVerify = verifySetting && verifySetting.value === 'true';

    if (requireVerify) {
      const origin = new URL(request.url).origin;
      await sendVerificationEmail(env, userId, email, origin).catch(() => {});
    } else {
      await env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(userId).run().catch(() => {});
    }

    const headers = { ...corsHeaders, 'Set-Cookie': `yp_session=${sessionId}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=2592000` };
    return new Response(JSON.stringify({ ok: true, user: { id: userId, email, nickname, role, verified: 0 }, email_verify_required: requireVerify }), { status: 201, headers: { 'Content-Type': 'application/json', ...headers } });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
          }
