// functions/api/admin/users.js
// GET /api/admin/users  -> list users (fields depend on viewer's role)
// PUT /api/admin/users  -> update a user (verified / blocked / role / no_ads / profile fields)
// Body for PUT: { id, verified?, blocked?, role?, no_ads?, nickname?, email?, phone?, password? }

import { json, corsHeaders, requireUser, isAdminRole, isOwnerOrCoOwner, logAudit, hashPassword } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const isOwner = isOwnerOrCoOwner(user, env.OWNER_EMAIL);

    // Owner/Co-Owner see full PII (email, phone). Everyone else sees only
    // public fields. password_hash is NEVER returned to anyone via the API —
    // there is no legitimate reason to read it back; resets are write-only.
    let fields;
    if (isOwner) {
      fields = 'id, email, nickname, phone, role, verified, blocked, online, no_ads, created_at';
    } else {
      fields = 'id, nickname, role, verified, blocked, online';
    }

    const url    = new URL(request.url);
    const search = url.searchParams.get('search') || '';

    let results;
    if (search) {
      const q = '%' + search.toLowerCase() + '%';
      const clause = isOwner ? 'OR lower(email) LIKE ? OR lower(nickname) LIKE ?' : '';
      const r = await env.DB.prepare(
        `SELECT ${fields} FROM users WHERE lower(nickname) LIKE ? ${clause} ORDER BY created_at DESC LIMIT 20`
      ).bind(...(isOwner ? [q, q, q] : [q])).all();
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
    if (!isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const body = await request.json();
    const { id } = body;
    if (!id) return json({ ok: false, error: 'id is required' }, 400);

    const CO_OWNER = 'Jmittelman2@gmail.com';
    const target = await env.DB.prepare('SELECT email, nickname FROM users WHERE id = ?').bind(id).first();
    if (!target) return json({ ok: false, error: 'User not found' }, 404);
    if (target.email === env.OWNER_EMAIL || target.email === CO_OWNER) {
      return json({ ok: false, error: 'Cannot modify owner or co-owner account' }, 403);
    }

    const isOwner = isOwnerOrCoOwner(user, env.OWNER_EMAIL);
    const isModeratorOnly = !isOwner;

    if (typeof body.verified === 'boolean') {
      if (isModeratorOnly) return json({ ok: false, error: 'Only Super Admins can verify users' }, 403);
      await env.DB.prepare('UPDATE users SET verified = ? WHERE id = ?')
        .bind(body.verified ? 1 : 0, id).run();
      await logAudit(env, user, body.verified ? 'verify_user' : 'unverify_user', 'user', id, `@${target.nickname}`);
    }

    if (typeof body.blocked === 'boolean') {
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

    // No-ads toggle (Owner/Co-Owner only)
    if (typeof body.no_ads === 'boolean') {
      if (!isOwner) return json({ ok: false, error: 'Only Owner can manage ad exemptions' }, 403);
      await env.DB.prepare('UPDATE users SET no_ads = ? WHERE id = ?')
        .bind(body.no_ads ? 1 : 0, id).run();
      await logAudit(env, user, body.no_ads ? 'grant_no_ads' : 'revoke_no_ads', 'user', id, `@${target.nickname}`);
    }

    // Profile field edits (Owner/Co-Owner only)
    if (isOwner) {
      const profileUpdates = [];
      const profileParams  = [];

      if (body.nickname) {
        // Check uniqueness
        const taken = await env.DB.prepare('SELECT id FROM users WHERE nickname = ? AND id != ?').bind(body.nickname, id).first();
        if (taken) return json({ ok: false, error: 'Nickname already taken' }, 409);
        profileUpdates.push('nickname = ?'); profileParams.push(body.nickname);
      }
      if (body.email) {
        const taken = await env.DB.prepare('SELECT id FROM users WHERE email = ? AND id != ?').bind(body.email.toLowerCase(), id).first();
        if (taken) return json({ ok: false, error: 'Email already in use' }, 409);
        profileUpdates.push('email = ?'); profileParams.push(body.email.toLowerCase());
      }
      if (body.phone !== undefined) {
        profileUpdates.push('phone = ?'); profileParams.push(body.phone || null);
      }
      if (body.password) {
        if (body.password.length < 6) return json({ ok: false, error: 'Password must be at least 6 characters' }, 400);
        const hash = await hashPassword(body.password);
        profileUpdates.push('password_hash = ?'); profileParams.push(hash);
      }

      if (profileUpdates.length) {
        profileParams.push(id);
        await env.DB.prepare(`UPDATE users SET ${profileUpdates.join(', ')} WHERE id = ?`)
          .bind(...profileParams).run();
        await logAudit(env, user, 'edit_profile', 'user', id, `@${target.nickname}: ${profileUpdates.map(u=>u.split(' = ')[0]).join(', ')}`);
      }
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return json({ ok: false, error: 'id required' }, 400);

    const CO_OWNER = 'Jmittelman2@gmail.com';
    const target = await env.DB.prepare('SELECT email, nickname FROM users WHERE id = ?').bind(id).first();
    if (!target) return json({ ok: false, error: 'User not found' }, 404);
    if (target.email === env.OWNER_EMAIL || target.email === CO_OWNER)
      return json({ ok: false, error: 'Cannot delete owner or co-owner' }, 403);

    // Delete user and all related data
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
    await env.DB.prepare('DELETE FROM login_logs WHERE user_id = ?').bind(id).run().catch(() => {});
    await env.DB.prepare('DELETE FROM device_bans WHERE banned_by = ?').bind(target.nickname).run().catch(() => {});
    await env.DB.prepare('DELETE FROM user_badges WHERE user_id = ?').bind(id).run().catch(() => {});
    await env.DB.prepare('DELETE FROM admin_notes WHERE target_user_id = ?').bind(id).run().catch(() => {});
    await env.DB.prepare('DELETE FROM user_warnings WHERE user_id = ?').bind(id).run().catch(() => {});
    await env.DB.prepare('DELETE FROM nuclear_permissions WHERE user_id = ?').bind(id).run().catch(() => {});
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();

    await logAudit(env, user, 'delete_user', 'user', id, `@${target.nickname} (${target.email})`);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
