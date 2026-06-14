// functions/api/shorts.js
// GET    /api/shorts            -> list shorts (newest first)
// POST   /api/shorts            -> upload a short (multipart: file, caption)
// PUT    /api/shorts            -> { id, like: true|false } toggle like
// DELETE /api/shorts?id=xxx     -> delete (owner or admin)

import { json, corsHeaders, requireUser, isAdminRole } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env).catch(() => null);

    const { results } = await env.DB.prepare(
      `SELECT s.id, s.owner_id, s.media_key, s.caption, s.likes, s.views, s.created_at,
              u.nickname, u.verified
       FROM shorts s
       JOIN users u ON u.id = s.owner_id
       ORDER BY s.created_at DESC
       LIMIT 50`
    ).all();

    let likedIds = new Set();
    if (user) {
      const { results: likedRows } = await env.DB.prepare(
        `SELECT short_id FROM short_likes WHERE user_id = ?`
      ).bind(user.id).all();
      likedIds = new Set(likedRows.map(r => r.short_id));
    }

    const out = results.map(row => ({
      id: row.id,
      nick: row.nickname,
      verified: !!row.verified,
      caption: row.caption,
      likes: row.likes,
      views: row.views,
      created_at: row.created_at,
      media_url: `/api/media/${encodeURIComponent(row.media_key)}`,
      liked: likedIds.has(row.id),
    }));

    return json({ ok: true, shorts: out });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const form = await request.formData();
    const file = form.get('file');
    const caption = (form.get('caption') || '').toString();

    if (!file || typeof file !== 'object' || !file.arrayBuffer) {
      return json({ ok: false, error: 'file is required' }, 400);
    }

    const ext = (file.name && file.name.includes('.')) ? file.name.split('.').pop() : 'mp4';
    const key = `shorts/${user.id}/${Date.now()}_${crypto.randomUUID()}.${ext}`;

    await env.MY_BUCKET.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || 'video/mp4' },
    });

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO shorts (id, owner_id, media_key, caption, likes, views, created_at)
       VALUES (?, ?, ?, ?, 0, 0, ?)`
    ).bind(id, user.id, key, caption, now).run();

    return json({
      ok: true,
      short: {
        id, nick: user.nickname, verified: !!user.verified,
        caption, likes: 0, views: 0, created_at: now,
        media_url: `/api/media/${encodeURIComponent(key)}`, liked: false,
      },
    }, 201);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const body = await request.json();
    const { id, like } = body;
    if (!id) return json({ ok: false, error: 'id is required' }, 400);

    const existing = await env.DB.prepare(
      `SELECT 1 FROM short_likes WHERE short_id = ? AND user_id = ?`
    ).bind(id, user.id).first();

    if (like && !existing) {
      await env.DB.prepare(
        `INSERT INTO short_likes (short_id, user_id) VALUES (?, ?)`
      ).bind(id, user.id).run();
      await env.DB.prepare(`UPDATE shorts SET likes = likes + 1 WHERE id = ?`).bind(id).run();
    } else if (!like && existing) {
      await env.DB.prepare(
        `DELETE FROM short_likes WHERE short_id = ? AND user_id = ?`
      ).bind(id, user.id).run();
      await env.DB.prepare(`UPDATE shorts SET likes = MAX(0, likes - 1) WHERE id = ?`).bind(id).run();
    }

    const row = await env.DB.prepare(`SELECT likes FROM shorts WHERE id = ?`).bind(id).first();
    return json({ ok: true, likes: row ? row.likes : 0 });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return json({ ok: false, error: 'id is required' }, 400);

    const row = await env.DB.prepare(`SELECT owner_id, media_key FROM shorts WHERE id = ?`).bind(id).first();
    if (!row) return json({ ok: false, error: 'Not found' }, 404);

    const canDelete = row.owner_id === user.id || isAdminRole(user, env.OWNER_EMAIL);
    if (!canDelete) return json({ ok: false, error: 'Forbidden' }, 403);

    await env.MY_BUCKET.delete(row.media_key);
    await env.DB.prepare(`DELETE FROM short_likes WHERE short_id = ?`).bind(id).run();
    await env.DB.prepare(`DELETE FROM short_comments WHERE short_id = ?`).bind(id).run();
    await env.DB.prepare(`DELETE FROM shorts WHERE id = ?`).bind(id).run();

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
