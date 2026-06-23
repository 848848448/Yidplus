// functions/api/admin/users.js
// GET /api/admin/users  -> list users (fields depend on viewer's role)
// PUT /api/admin/users  -> update a user (verified / blocked / role)
// Body for PUT: { id, verified?, blocked?, role? }

import { json, corsHeaders, requireUser, isAdminRole, isSuperOrOwner, logAudit } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const canSeePII = isSuperOrOwner(user, env.OWNER_EMAIL);
    const fields = canSeePII
      ? 'id, email, nickname, phone, role, verified, blocked, online, created_at'
      : 'id, nickname, role, verified, blocked, online';

    const url    = new URL(request.url);
    const search = url.searchParams.get('search') || '';

    let results;
    if (search) {
      const q = '%' + search.toLowerCase() + '%';
      const r = await env.DB.prepare(
        `SELECT ${fields} FROM users WHERE lower(nickname) LIKE ? ${canSeePII ? 'OR lower(email) LIKE ?' : ''} ORDER BY created_at DESC LIMIT 20`
      ).bind(...(canSeePII ? [q, q] : [q])).all();
      results = r.results;
    } else {
      const r = await env.DB.prepare(
        `SELECT ${fields} FROM users ORDER BY created_at DESC`
      ).all();
      results = r.results;
    }

    return json({ ok: true, users: results });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    // Moderators (admin_limited) and Super Admins can both reach this
    // endpoint, but Moderators are restricted to block/unblock only.
    if (!isAdminRole(user, env.OWNER_EMAIL)) {
      return json({ ok: false, error: 'Forbidden' }, 403);
    }

    const body = await request.json();
    const { id } = body;
    if (!id) return json({ ok: false, error: 'id is required' }, 400);

    const target = await env.DB.prepare('SELECT email, nickname FROM users WHERE id = ?').bind(id).first();
    if (!target) return json({ ok: false, error: 'User not found' }, 404);
    if (target.email === env.OWNER_EMAIL) {
      return json({ ok: false, error: 'Cannot modify the owner account' }, 403);
    }

    const isModeratorOnly = !isSuperOrOwner(user, env.OWNER_EMAIL);

    if (typeof body.verified === 'boolean') {
      if (isModeratorOnly) return json({ ok: false, error: 'Only Super Admins can verify users' }, 403);
      await env.DB.prepare('UPDATE users SET verified = ? WHERE id = ?')
        .bind(body.verified ? 1 : 0, id).run();
      await logAudit(env, user, body.verified ? 'verify_user' : 'unverify_user', 'user', id, `@${target.nickname}`);
    }

    if (typeof body.blocked === 'boolean') {
      // Moderators AND Super Admins can block/unblock.
      await env.DB.prepare('UPDATE users SET blocked = ? WHERE id = ?')
        .bind(body.blocked ? 1 : 0, id).run();
      await logAudit(env, user, body.blocked ? 'block_user' : 'unblock_user', 'user', id, `@${target.nickname}`);
    }

    if (body.role) {
      if (isModeratorOnly) return json({ ok: false, error: 'Only Super Admins can change roles' }, 403);
      await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?')
        .bind(body.role, id).run();
      await logAudit(env, user, 'change_role', 'user', id, `@${target.nickname} -> ${body.role}`);
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
      }
