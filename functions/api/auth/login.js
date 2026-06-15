// functions/api/auth/login.js
// POST /api/auth/login
// Body: { email, password }
// Verifies credentials, sets session cookie, returns user object.

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const email    = (body.email || '').trim().toLowerCase();
    const password = body.password || '';

    if (!email || !password) {
      return json({ ok: false, error: 'email and password are required' }, 400);
    }

    const user = await env.DB.prepare(
      `SELECT id, email, password_hash, nickname, phone, role, verified, blocked, online
       FROM users WHERE email = ?`
    ).bind(email).first();

    if (!user) {
      return json({ ok: false, error: 'Invalid email or password.' }, 401);
    }

    const passwordHash = await hashPassword(password);
    if (passwordHash !== user.password_hash) {
      return json({ ok: false, error: 'Invalid email or password.' }, 401);
    }

    if (user.blocked) {
      return json({ ok: false, error: 'This account has been blocked.' }, 403);
    }

    // Mark online
    await env.DB.prepare('UPDATE users SET online = 1 WHERE id = ?').bind(user.id).run();

    const sessionToken = await createSession(env, user.id);

    const outUser = {
      id: user.id, email: user.email, nickname: user.nickname, phone: user.phone,
      role: user.role, verified: !!user.verified, blocked: !!user.blocked, online: true,
      isOwner: user.email === env.OWNER_EMAIL,
    };

    const headers = new Headers(corsHeaders);
    headers.append('Set-Cookie', sessionCookie(sessionToken));

    return new Response(JSON.stringify({ ok: true, user: outUser }), { status: 200, headers });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

// ── HELPERS ───────────────────────────────────────────────
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders });
}

async function hashPassword(password) {
  const enc = new TextEncoder().encode(password);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function createSession(env, userId) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`
  ).bind(token, userId, expires).run();
  return token;
}

function sessionCookie(token) {
  return `yp_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`;
}
