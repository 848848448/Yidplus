// functions/api/admin/users.js
// GET /api/admin/users  -> list users (fields depend on viewer's role)
// PUT /api/admin/users  -> update a user (verified / blocked / role)
// Body for PUT: { id, verified?, blocked?, role? }

import { json, corsHeaders, requireUser, isAdminRole, isSuperOrOwner } from '../_helpers.js';

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

    const { results } = await env.DB.prepare(
      `SELECT ${fields} FROM users ORDER BY created_at DESC`
    ).all();

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
    if (!isSuperOrOwner(user, env.OWNER_EMAIL)) {
      return json({ ok: false, error: 'Only super admins can manage users' }, 403);
    }

    const body = await request.json();
    const { id } = body;
    if (!id) return json({ ok: false, error: 'id is required' }, 400);

    const target = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(id).first();
    if (!target) return json({ ok: false, error: 'User not found' }, 404);
    if (target.email === env.OWNER_EMAIL) {
      return json({ ok: false, error: 'Cannot modify the owner account' }, 403);
    }

    if (typeof body.verified === 'boolean') {
      await env.DB.prepare('UPDATE users SET verified = ? WHERE id = ?')
        .bind(body.verified ? 1 : 0, id).run();
    }
    if (typeof body.blocked === 'boolean') {
      await env.DB.prepare('UPDATE users SET blocked = ? WHERE id = ?')
        .bind(body.blocked ? 1 : 0, id).run();
    }
    if (body.role) {
      if (user.role !== 'admin_super' && user.email !== env.OWNER_EMAIL) {
        return json({ ok: false, error: 'Only the owner can change roles' }, 403);
      }
      await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?')
        .bind(body.role, id).run();
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
  }
