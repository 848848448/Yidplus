// GET    /api/posts/comments?post_id=X -> list comments (with like counts + my_liked)
// POST   /api/posts/comments            -> add comment { post_id, text }
// PUT    /api/posts/comments            -> toggle like { comment_id }
// DELETE /api/posts/comments?id=X        -> delete a comment (own, or admin)
import { json, corsHeaders, requireUser, isAdminRole } from '../_helpers.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

async function ensureLikesTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS comment_likes (
      comment_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at TEXT,
      PRIMARY KEY (comment_id, user_id)
    )`
  ).run().catch(() => {});
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const postId = new URL(request.url).searchParams.get('post_id');
    if (!postId) return json({ ok: false, error: 'post_id required' }, 400);

    const user = await requireUser(request, env).catch(() => null);
    await ensureLikesTable(env);

    const { results } = await env.DB.prepare(
      'SELECT id, user_id, nickname, text, created_at FROM post_comments WHERE post_id = ? ORDER BY created_at ASC LIMIT 100'
    ).bind(postId).all();

    const ids = results.map(c => c.id);
    let counts = {}, mine = {};
    if (ids.length) {
      const ph = ids.map(() => '?').join(',');
      const { results: cr } = await env.DB.prepare(
        `SELECT comment_id, COUNT(*) as cnt FROM comment_likes WHERE comment_id IN (${ph}) GROUP BY comment_id`
      ).bind(...ids).all().catch(() => ({ results: [] }));
      cr.forEach(r => { counts[r.comment_id] = r.cnt; });
      if (user) {
        const { results: mr } = await env.DB.prepare(
          `SELECT comment_id FROM comment_likes WHERE user_id = ? AND comment_id IN (${ph})`
        ).bind(user.id, ...ids).all().catch(() => ({ results: [] }));
        mr.forEach(r => { mine[r.comment_id] = true; });
      }
    }

    const comments = results.map(c => ({
      ...c,
      likes: counts[c.id] || 0,
      my_liked: !!mine[c.id],
      is_mine: user ? (c.user_id === user.id) : false,
      can_delete: user ? (c.user_id === user.id || isAdminRole(user, env.OWNER_EMAIL)) : false,
    }));

    return json({ ok: true, comments });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const { post_id, text } = await request.json();
    if (!post_id || !text?.trim()) return json({ ok: false, error: 'post_id and text required' }, 400);
    if (text.length > 500) return json({ ok: false, error: 'Comment too long' }, 400);

    const recentCount = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM post_comments WHERE user_id = ? AND created_at > datetime('now', '-1 minute')"
    ).bind(user.id).first().catch(() => ({ cnt: 0 }));
    if ((recentCount?.cnt || 0) >= 5) return json({ ok: false, error: 'Too many comments. Please wait.' }, 429);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      'INSERT INTO post_comments (id, post_id, user_id, nickname, text, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(id, post_id, user.id, user.nickname || '', text.trim(), now).run();

    await env.DB.prepare('UPDATE posts SET comments = comments + 1 WHERE id = ?').bind(post_id).run().catch(() => {});

    return json({ ok: true, id, comment: {
      id, user_id: user.id, nickname: user.nickname || '', text: text.trim(),
      created_at: now, likes: 0, my_liked: false, is_mine: true, can_delete: true,
    }});
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestPut(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const { comment_id } = await request.json();
    if (!comment_id) return json({ ok: false, error: 'comment_id required' }, 400);

    await ensureLikesTable(env);
    const existing = await env.DB.prepare(
      'SELECT 1 FROM comment_likes WHERE comment_id = ? AND user_id = ?'
    ).bind(comment_id, user.id).first().catch(() => null);

    if (existing) {
      await env.DB.prepare('DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?')
        .bind(comment_id, user.id).run();
    } else {
      await env.DB.prepare('INSERT INTO comment_likes (comment_id, user_id, created_at) VALUES (?, ?, ?)')
        .bind(comment_id, user.id, new Date().toISOString()).run();
    }

    const cnt = await env.DB.prepare('SELECT COUNT(*) as cnt FROM comment_likes WHERE comment_id = ?')
      .bind(comment_id).first().catch(() => ({ cnt: 0 }));

    return json({ ok: true, liked: !existing, likes: cnt?.cnt || 0 });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return json({ ok: false, error: 'id required' }, 400);

    const comment = await env.DB.prepare('SELECT user_id, post_id FROM post_comments WHERE id = ?')
      .bind(id).first();
    if (!comment) return json({ ok: false, error: 'Not found' }, 404);

    if (comment.user_id !== user.id && !isAdminRole(user, env.OWNER_EMAIL)) {
      return json({ ok: false, error: 'Forbidden' }, 403);
    }

    await env.DB.prepare('DELETE FROM post_comments WHERE id = ?').bind(id).run();
    await env.DB.prepare('DELETE FROM comment_likes WHERE comment_id = ?').bind(id).run().catch(() => {});
    await env.DB.prepare('UPDATE posts SET comments = MAX(0, comments - 1) WHERE id = ?')
      .bind(comment.post_id).run().catch(() => {});

    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
