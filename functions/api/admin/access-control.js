// functions/api/admin/access-control.js
// Owner-only sign-in access control.
//   GET                                  -> { ok, locked, allowlist:[{email,nickname,note,created_at}] }
//   PUT    { locked:true|false }          -> lock / unlock sign-in for everyone
//   POST   { action:'allow', email }      -> add an email to the allowlist
//   POST   { action:'create_account', email, nickname, password }
//                                         -> create a new account + allowlist it
//   POST   { action:'force_logout', user_id }
//                                         -> kill all of that user's sessions (must re-login)
//   DELETE ?email=                        -> remove an email from the allowlist

import { json, corsHeaders, requireUser, isOwnerOrCoOwner, hashPassword, isValidEmail } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

async function ensureTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS access_allowlist (
       email TEXT PRIMARY KEY,
       added_by TEXT,
       note TEXT,
       created_at TEXT
     )`
  ).run().catch(() => {});
}

async function requireOwner(request, env) {
  const user = await requireUser(request, env);
  if (!user) return { err: json({ ok: false, error: 'Not signed in' }, 401) };
  if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) {
    return { err: json({ ok: false, error: 'Owner only' }, 403) };
  }
  return { user };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const gate = await requireOwner(request, env);
    if (gate.err) return gate.err;
    await ensureTable(env);

    const lockRow = await env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = 'signin_locked'"
    ).first().catch(() => null);

    const { results } = await env.DB.prepare(
      `SELECT a.email, a.note, a.created_at, u.nickname
       FROM access_allowlist a
       LEFT JOIN users u ON u.email = a.email
       ORDER BY a.created_at DESC`
    ).all().catch(() => ({ results: [] }));

    return json({ ok: true, locked: !!(lockRow && lockRow.value === 'true'), allowlist: results });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestPut(context) {
  const { request, env } = context;
  try {
    const gate = await requireOwner(request, env);
    if (gate.err) return gate.err;
    const body = await request.json();
    const locked = body.locked ? 'true' : 'false';
    await env.DB.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('signin_locked', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).bind(locked, new Date().toISOString()).run();
    return json({ ok: true, locked: locked === 'true' });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const gate = await requireOwner(request, env);
    if (gate.err) return gate.err;
    await ensureTable(env);
    const body = await request.json();
    const now = new Date().toISOString();

    // ── Give someone permission to sign in (allowlist an email) ──
    if (body.action === 'allow') {
      const email = (body.email || '').toLowerCase().trim();
      if (!isValidEmail(email)) return json({ ok: false, error: 'Enter a valid email' }, 400);
      await env.DB.prepare(
        `INSERT OR IGNORE INTO access_allowlist (email, added_by, note, created_at) VALUES (?, ?, ?, ?)`
      ).bind(email, gate.user.id, (body.note || '').trim() || null, now).run();
      return json({ ok: true });
    }

    // ── Create a brand-new account (bypasses public sign-up) and allowlist it ──
    if (body.action === 'create_account') {
      const email    = (body.email || '').toLowerCase().trim();
      const nickname = (body.nickname || '').trim();
      const password = (body.password || '').trim();
      if (!isValidEmail(email))     return json({ ok: false, error: 'Enter a valid email' }, 400);
      if (nickname.length < 2)      return json({ ok: false, error: 'Nickname too short' }, 400);
      if (password.length < 6)      return json({ ok: false, error: 'Password must be at least 6 characters' }, 400);

      const existsEmail = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first().catch(() => null);
      if (existsEmail) return json({ ok: false, error: 'An account with that email already exists' }, 409);
      const existsNick = await env.DB.prepare('SELECT id FROM users WHERE lower(nickname) = lower(?)').bind(nickname).first().catch(() => null);
      if (existsNick) return json({ ok: false, error: 'That nickname is taken' }, 409);

      const hash = await hashPassword(password);
      const userId = crypto.randomUUID();
      await env.DB.prepare(
        'INSERT INTO users (id, email, nickname, phone, password_hash, role, verified, blocked, online, created_at) VALUES (?, ?, ?, NULL, ?, ?, 0, 0, 0, ?)'
      ).bind(userId, email, nickname, hash, 'member', now).run();
      await env.DB.prepare(
        'INSERT INTO channels (id, owner_id, nickname, followers, following, total_views, verified, bio, created_at) VALUES (?, ?, ?, 0, 0, 0, 0, NULL, ?)'
      ).bind(crypto.randomUUID(), userId, nickname, now).run().catch(() => {});
      // Auto-allow so they can sign in even while sign-in is locked.
      await env.DB.prepare(
        `INSERT OR IGNORE INTO access_allowlist (email, added_by, note, created_at) VALUES (?, ?, 'created by owner', ?)`
      ).bind(email, gate.user.id, now).run();

      return json({ ok: true, user: { id: userId, email, nickname } });
    }

    // ── Force-logout: kill every session this user has ──
    if (body.action === 'force_logout') {
      const uid = body.user_id;
      if (!uid) return json({ ok: false, error: 'user_id required' }, 400);
      await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(uid).run().catch(() => {});
      await env.DB.prepare('UPDATE users SET online = 0 WHERE id = ?').bind(uid).run().catch(() => {});
      return json({ ok: true });
    }

    return json({ ok: false, error: 'Unknown action' }, 400);
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const gate = await requireOwner(request, env);
    if (gate.err) return gate.err;
    const url = new URL(request.url);
    const email = (url.searchParams.get('email') || '').toLowerCase().trim();
    if (!email) return json({ ok: false, error: 'email required' }, 400);
    await env.DB.prepare('DELETE FROM access_allowlist WHERE email = ?').bind(email).run();
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
