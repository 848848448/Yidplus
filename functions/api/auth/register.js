import { json, corsHeaders } from '../_helpers.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const email    = (body.email || '').toLowerCase().trim();
    const nickname = (body.nickname || '').trim();
    const password = (body.password || '').trim();
    const phone    = (body.phone || '').trim();

    if (!email || !nickname || !password) return json({ ok: false, error: 'email, nickname and password are required' }, 400);
    if (nickname.length < 3)  return json({ ok: false, error: 'Nickname must be at least 3 characters' }, 400);
    if (nickname.length > 20) return json({ ok: false, error: 'Nickname must be 20 characters or less' }, 400);
    if (!/^[a-zA-Z0-9_\u0590-\u05FF]+$/.test(nickname)) {
      return json({ ok: false, error: 'Nickname can only contain letters, numbers and underscores (no spaces or symbols)' }, 400);
    }
    if (password.length < 6) return json({ ok: false, error: 'Password must be at least 6 characters' }, 400);

    // Check if registration is open (owner can always register)
    const isOwnerEmail = email === env.OWNER_EMAIL;
    if (!isOwnerEmail) {
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

    const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
    const hash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');

    const userId = crypto.randomUUID();
    const now = new Date().toISOString();

    const isOwner = email === env.OWNER_EMAIL;
    const role = isOwner ? 'admin_super' : 'member';

    await env.DB.prepare(
      'INSERT INTO users (id, email, nickname, phone, password_hash, role, verified, blocked, online, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?)'
    ).bind(userId, email, nickname, phone || null, hash, role, now).run();

    // Auto-create channel for every new user
    await env.DB.prepare(
      'INSERT INTO channels (id, owner_id, nickname, followers, following, total_views, verified, bio, created_at) VALUES (?, ?, ?, 0, 0, 0, 0, NULL, ?)'
    ).bind(crypto.randomUUID(), userId, nickname, now).run();

    const sessionId = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO sessions (id, user_id, created_at) VALUES (?, ?, ?)').bind(sessionId, userId, now).run();
    await env.DB.prepare('UPDATE users SET online = 1 WHERE id = ?').bind(userId).run();

    const headers = { ...corsHeaders, 'Set-Cookie': `yp_session=${sessionId}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000` };
    return new Response(JSON.stringify({ ok: true, user: { id: userId, email, nickname, role, verified: 0 } }), { status: 201, headers: { 'Content-Type': 'application/json', ...headers } });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
      }
