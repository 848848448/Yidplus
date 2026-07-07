// functions/api/shorts.js
// GET    /api/shorts            -> list shorts (newest first)
// POST   /api/shorts            -> upload a short (multipart: file, caption)
// PUT    /api/shorts            -> { id, like: true|false } toggle like
// DELETE /api/shorts?id=xxx     -> delete (owner or admin)

import { json, corsHeaders, requireUser, isAdminRole, canDeleteContent, logAudit } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env).catch(() => null);
    const url = new URL(request.url);
    const singleId = url.searchParams.get('id');

    // Deep-link support: Share generates a /shorts#<id> link. Without this,
    // opening a shared link had no way to actually fetch that specific
    // short — it just silently fell back to the generic top-of-feed list.
    if (singleId) {
      const row = await env.DB.prepare(
        `SELECT s.id, s.owner_id, s.media_key, s.caption, s.likes, s.views, s.created_at,
                u.nickname, u.verified, u.photo_url
         FROM shorts s JOIN users u ON u.id = s.owner_id
         WHERE s.id = ?`
      ).bind(singleId).first();
      if (!row) return json({ ok: true, shorts: [] });
      let liked = false;
      if (user) {
        const likeRow = await env.DB.prepare('SELECT 1 FROM short_likes WHERE short_id = ? AND user_id = ?').bind(singleId, user.id).first();
        liked = !!likeRow;
      }
      return json({
        ok: true,
        shorts: [{
          id: row.id, owner_id: row.owner_id, nick: row.nickname, photo_url: row.photo_url || null,
          verified: !!row.verified, caption: row.caption, likes: row.likes, views: row.views,
          media_url: `/api/media/${encodeURIComponent(row.media_key)}`, created_at: row.created_at, liked,
        }],
      });
    }

    // Users the viewer has blocked — their shorts are hidden from the feed.
    let blockedIds = [];
    if (user) {
      const { results: br } = await env.DB.prepare('SELECT blocked_id FROM user_blocks WHERE blocker_id = ?')
        .bind(user.id).all().catch(() => ({ results: [] }));
      blockedIds = br.map(r => r.blocked_id);
    }

    let results;
    try {
      const r = await env.DB.prepare(
        `SELECT s.id, s.owner_id, s.media_key, s.caption, s.likes, s.views, s.created_at,
                u.nickname, u.verified, u.photo_url
         FROM shorts s
         JOIN users u ON u.id = s.owner_id
         WHERE (s.hidden IS NULL OR s.hidden = 0)
         ORDER BY s.created_at DESC
         LIMIT 50`
      ).all();
      results = r.results;
    } catch (e) {
      // hidden column not migrated yet
      const r = await env.DB.prepare(
        `SELECT s.id, s.owner_id, s.media_key, s.caption, s.likes, s.views, s.created_at,
                u.nickname, u.verified, u.photo_url
         FROM shorts s
         JOIN users u ON u.id = s.owner_id
         ORDER BY s.created_at DESC
         LIMIT 50`
      ).all();
      results = r.results;
    }

    if (blockedIds.length) {
      results = results.filter(row => blockedIds.indexOf(row.owner_id) === -1);
    }

    let likedIds = new Set();
    if (user) {
      const { results: likedRows } = await env.DB.prepare(
        `SELECT short_id FROM short_likes WHERE user_id = ?`
      ).bind(user.id).all();
      likedIds = new Set(likedRows.map(r => r.short_id));
    }

    const out = results.map(row => ({
      id: row.id,
      owner_id: row.owner_id,
      nick: row.nickname,
      photo_url: row.photo_url || null,
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
        id, owner_id: user.id, nick: user.nickname, verified: !!user.verified,
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
    const body = await request.json();
    const { id, like, view } = body;
    if (!id) return json({ ok: false, error: 'id is required' }, 400);

    // View tracking — no auth required, anyone can register a view.
    if (view) {
      await env.DB.prepare(`UPDATE shorts SET views = views + 1 WHERE id = ?`).bind(id).run();
      const viewRow = await env.DB.prepare(`SELECT views FROM shorts WHERE id = ?`).bind(id).first();
      return json({ ok: true, views: viewRow ? viewRow.views : 0 });
    }

    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

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

    if (!canDeleteContent(user, row.owner_id, env.OWNER_EMAIL)) {
      return json({ ok: false, error: 'Forbidden' }, 403);
    }

    await env.MY_BUCKET.delete(row.media_key);
    await env.DB.prepare(`DELETE FROM short_likes WHERE short_id = ?`).bind(id).run();
    await env.DB.prepare(`DELETE FROM short_comments WHERE short_id = ?`).bind(id).run();
    await env.DB.prepare(`DELETE FROM shorts WHERE id = ?`).bind(id).run();

    if (user.id !== row.owner_id && isAdminRole(user, env.OWNER_EMAIL)) {
      await logAudit(env, user, 'delete_short', 'short', id, 'Deleted a short uploaded by another user');
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
        }
