import { json, corsHeaders, requireUser, isAdminRole, logAudit } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

async function ensureCol(env) {
  await env.DB.prepare('ALTER TABLE posts ADD COLUMN is_featured INTEGER DEFAULT 0').run().catch(() => {});
}

// GET → recent posts with their featured status (featured first)
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
    await ensureCol(env);
    const res = await env.DB.prepare(
      'SELECT id, username, caption, is_featured, created_at FROM posts ORDER BY is_featured DESC, created_at DESC LIMIT 40'
    ).all();
    return json({ ok: true, posts: res.results || [] });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

// POST { post_id, featured } → feature/unfeature a post
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
    await ensureCol(env);
    const { post_id, featured } = await request.json();
    if (!post_id) return json({ ok: false, error: 'post_id required' }, 400);
    await env.DB.prepare('UPDATE posts SET is_featured = ? WHERE id = ?').bind(featured ? 1 : 0, post_id).run();
    await logAudit(env, user, featured ? 'feature_post' : 'unfeature_post', 'post', post_id, '');
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
