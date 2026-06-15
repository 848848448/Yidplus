// functions/api/posts.js
// GET  /api/posts  -> list recent posts (newest first)
// POST /api/posts  -> { username, caption, content } create a post

import { json, corsHeaders, requireUser } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const { results } = await env.DB.prepare(
      `SELECT id, username, user_id, caption, content, likes, comments, created_at
       FROM posts ORDER BY created_at DESC LIMIT 30`
    ).all();

    return json({ ok: true, posts: results });
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

    await env.DB.prepare(
      `INSERT INTO posts (id, username, user_id, caption, content, likes, comments, created_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?)`
    ).bind(id, user.nickname || body.username || 'Anonymous', user.id, caption, body.content || '', now).run();

    return json({ ok: true, post: { id, username: user.nickname, caption, content: body.content || '', likes: 0, comments: 0, created_at: now } }, 201);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
