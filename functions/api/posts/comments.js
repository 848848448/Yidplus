// GET  /api/posts/comments?post_id=X -> list comments
// POST /api/posts/comments            -> add comment { post_id, text }
import { json, corsHeaders, requireUser } from '../_helpers.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const postId = new URL(request.url).searchParams.get('post_id');
    if (!postId) return json({ ok: false, error: 'post_id required' }, 400);
    const { results } = await env.DB.prepare(
      'SELECT id, user_id, nickname, text, created_at FROM post_comments WHERE post_id = ? ORDER BY created_at ASC LIMIT 100'
    ).bind(postId).all();
    return json({ ok: true, comments: results });
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

    // Spam check — max 5 comments per minute
    const recentCount = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM post_comments WHERE user_id = ? AND created_at > datetime('now', '-1 minute')"
    ).bind(user.id).first().catch(() => ({ cnt: 0 }));
    if ((recentCount?.cnt || 0) >= 5) return json({ ok: false, error: 'Too many comments. Please wait.' }, 429);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      'INSERT INTO post_comments (id, post_id, user_id, nickname, text, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(id, post_id, user.id, user.nickname || '', text.trim(), now).run();

    // Update comment count on post
    await env.DB.prepare('UPDATE posts SET comments = comments + 1 WHERE id = ?').bind(post_id).run();

    return json({ ok: true, id });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
