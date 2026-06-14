// functions/api/auth/register.js
// POST /api/auth/register
// Body: { email, password, nickname, phone }
// Creates a user in D1, sets a session cookie, returns user object.

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
    const nickname = (body.nickname || '').trim();
    const phone    = (body.phone || '').trim();

    if (!email || !password || !nickname) {
      return json({ ok: false, error: 'email, password and nickname are required' }, 400);
    }
    if (password.length < 6) {
      return json({ ok: false, error: 'Password must be at least 6 characters' }, 400);
    }

    // Check if email already exists
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (existing) {
      return json({ ok: false, error: 'This email is already registered.' }, 409);
    }

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    const role = email === env.OWNER_EMAIL ? 'admin_super' : 'member';
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, nickname, phone, role, verified, blocked, online, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, 1, ?)`
    ).bind(id, email, passwordHash, nickname, phone, role, now).run();

    // Auto-create personal channel
    await env.DB.prepare(
      `INSERT INTO channels (id, owner_id, nickname, followers, following, total_views, verified, bio, created_at)
       VALUES (?, ?, ?, 0, 0, 0, 0, '', ?)`
    ).bind(crypto.randomUUID(), id, nickname, now).run();

    const sessionToken = await createSession(env, id);

    const user = {
      id, email, nickname, phone, role,
      verified: false, blocked: false, online: true,
      isOwner: email === env.OWNER_EMAIL,
    };

    const headers = new Headers(corsHeaders);
    headers.append('Set-Cookie', sessionCookie(sessionToken));

    return new Response(JSON.stringify({ ok: true, user }), { status: 201, headers });
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
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
  await env.DB.prepare(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`
  ).bind(token, userId, expires).run();
  return token;
}

function sessionCookie(token) {
  return `yp_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`;
}
