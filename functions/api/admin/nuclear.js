// functions/api/admin/nuclear.js
// POST /api/admin/nuclear  { category, action: 'hide'|'restore' }
// GET  /api/admin/nuclear?permissions=1   -> list who has nuclear permission
// POST /api/admin/nuclear?permissions=1   -> { user_id } grant permission
// DELETE /api/admin/nuclear?permissions=1&id=X -> revoke permission

import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';

const VALID_CATEGORIES = ['shorts', 'music', 'channels', 'statuses', 'messages', 'posts'];

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

async function hasNuclearAccess(user, env) {
  if (isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return true;
  const row = await env.DB.prepare(
    `SELECT 1 FROM nuclear_permissions WHERE user_id = ? LIMIT 1`
  ).bind(user.id).first().catch(() => null);
  return !!row;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL))
      return json({ ok: false, error: 'Forbidden' }, 403);

    const url = new URL(request.url);
    if (url.searchParams.get('permissions')) {
      const { results } = await env.DB.prepare(
        `SELECT np.user_id, np.granted_by, np.created_at, u.nickname, u.email
         FROM nuclear_permissions np
         JOIN users u ON u.id = np.user_id
         ORDER BY np.created_at DESC`
      ).all();
      return json({ ok: true, permissions: results });
    }

    const { results } = await env.DB.prepare(
      `SELECT * FROM nuclear_log ORDER BY created_at DESC LIMIT 100`
    ).all().catch(() => ({ results: [] }));
    return json({ ok: true, logs: results });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    const url = new URL(request.url);

    // Grant nuclear permission
    if (url.searchParams.get('permissions')) {
      if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL))
        return json({ ok: false, error: 'Forbidden' }, 403);
      const { user_id } = await request.json();
      if (!user_id) return json({ ok: false, error: 'user_id required' }, 400);
      await env.DB.prepare(
        `INSERT OR REPLACE INTO nuclear_permissions (user_id, granted_by, created_at) VALUES (?, ?, ?)`
      ).bind(user_id, user.nickname, new Date().toISOString()).run();
      return json({ ok: true });
    }

    // Perform nuclear action
    if (!user || !(await hasNuclearAccess(user, env)))
      return json({ ok: false, error: 'Forbidden' }, 403);

    const body = await request.json();
    const { category, action } = body;
    if (!VALID_CATEGORIES.includes(category)) return json({ ok: false, error: 'Invalid category' }, 400);
    if (!['hide', 'restore'].includes(action)) return json({ ok: false, error: 'action must be hide or restore' }, 400);

    const hidden = action === 'hide' ? 1 : 0;
    const now = new Date().toISOString();

    // Each category maps to a table + column
    const tableMap = {
      shorts:   { table: 'shorts',   col: 'hidden' },
      music:    { table: 'music_tracks', col: 'hidden' },
      statuses: { table: 'statuses', col: 'hidden' },
      messages: { table: 'messages', col: 'hidden' },
      posts:    { table: 'posts',    col: 'hidden' },
      channels: { table: 'channels', col: 'hidden' },
    };

    const { table, col } = tableMap[category];
    await env.DB.prepare(`UPDATE ${table} SET ${col} = ?`).bind(hidden).run().catch(() => {});

    // Log it
    await env.DB.prepare(
      `INSERT INTO nuclear_log (id, category, action, done_by, created_at) VALUES (?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), category, action, user.nickname, now).run().catch(() => {});

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL))
      return json({ ok: false, error: 'Forbidden' }, 403);

    const url = new URL(request.url);
    if (url.searchParams.get('permissions')) {
      const id = url.searchParams.get('id');
      if (!id) return json({ ok: false, error: 'id required' }, 400);
      await env.DB.prepare(`DELETE FROM nuclear_permissions WHERE user_id = ?`).bind(id).run();
      return json({ ok: true });
    }
    return json({ ok: false, error: 'specify permissions=1' }, 400);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
         }
