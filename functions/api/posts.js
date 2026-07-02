// functions/api/posts.js
// GET    /api/posts            -> list recent posts (newest first), with liked flag per viewer
// POST   /api/posts            -> { caption, content } create a post
// PUT    /api/posts            -> { id, like: true|false } toggle like
// DELETE /api/posts?id=xxx     -> delete own post, or any post if Moderator/Admin (cascades likes+comments)

import { json, corsHeaders, requireUser, canDeleteContent, isAdminRole, logAudit } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env).catch(() => null);
    const url = new URL(request.url);
    const filterUserId = url.searchParams.get('user_id');

    const { results } = filterUserId
      ? await env.DB.prepare(
          `SELECT id, username, user_id, caption, content, likes, comments, created_at
           FROM posts WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`
        ).bind(filterUserId).all()
      : await env.DB.prepare(
          `SELECT id, username, user_id, caption, content, likes, comments, created_at
           FROM posts ORDER BY created_at DESC LIMIT 30`
        ).all();

    let likedIds = new Set();
    if (user) {
      const { results: likedRows } = await env.DB.prepare(
        `SELECT post_id FROM post_likes WHERE user_id = ?`
      ).bind(user.id).all();
      likedIds = new Set(likedRows.map(r => r.post_id));
    }

    const out = results.map(p => ({ ...p, liked: likedIds.has(p.id) }));
    return json({ ok: true, posts: out });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const body = await request.json();
    const caption = (body.caption || '').trim();
    if (!caption) return json({ ok: false, error: 'caption is required' }, 400);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // username is a denormalized snapshot of the nickname at post time —
    // always sourced from the authenticated user, never trusted from the client.
    await env.DB.prepare(
      `INSERT INTO posts (id, username, user_id, caption, content, likes, comments, created_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?)`
    ).bind(id, user.nickname || 'Anonymous', user.id, caption, body.content || '', now).run();

    return json({ ok: true, post: { id, username: user.nickname, user_id: user.id, caption, content: body.content || '', likes: 0, comments: 0, created_at: now, liked: false } }, 201);
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
      `SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?`
    ).bind(id, user.id).first();

    if (like && !existing) {
      await env.DB.prepare(`INSERT INTO post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)`)
        .bind(id, user.id, new Date().toISOString()).run();
      await env.DB.prepare(`UPDATE posts SET likes = likes + 1 WHERE id = ?`).bind(id).run();
    } else if (!like && existing) {
      await env.DB.prepare(`DELETE FROM post_likes WHERE post_id = ? AND user_id = ?`).bind(id, user.id).run();
      await env.DB.prepare(`UPDATE posts SET likes = MAX(0, likes - 1) WHERE id = ?`).bind(id).run();
    }

    const row = await env.DB.prepare(`SELECT likes FROM posts WHERE id = ?`).bind(id).first();
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

    const post = await env.DB.prepare(`SELECT user_id, username FROM posts WHERE id = ?`).bind(id).first();
    if (!post) return json({ ok: false, error: 'Post not found' }, 404);

    if (!canDeleteContent(user, post.user_id, env.OWNER_EMAIL)) {
      return json({ ok: false, error: 'Forbidden' }, 403);
    }

    // Cascading delete: remove likes + comments before the post itself.
    await env.DB.prepare(`DELETE FROM post_likes WHERE post_id = ?`).bind(id).run();
    await env.DB.prepare(`DELETE FROM post_comments WHERE post_id = ?`).bind(id).run();
    await env.DB.prepare(`DELETE FROM posts WHERE id = ?`).bind(id).run();

    // Audit log only when a moderator/admin deletes someone else's content.
    if (user.id !== post.user_id && isAdminRole(user, env.OWNER_EMAIL)) {
      await logAudit(env, user, 'delete_post', 'post', id, `Deleted post by @${post.username}`);
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
        }
