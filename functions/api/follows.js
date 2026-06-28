// GET    /api/follows?user_id=X          -> { followers, following, is_following }
// GET    /api/follows?followers=1&user_id=X -> list followers
// GET    /api/follows?following=1&user_id=X -> list following
// POST   /api/follows { user_id }         -> follow
// DELETE /api/follows?user_id=X           -> unfollow

import { json, corsHeaders, requireUser } from './_helpers.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const me = await requireUser(request, env).catch(() => null);
    const url = new URL(request.url);
    const targetId = url.searchParams.get('user_id');
    if (!targetId) return json({ ok: false, error: 'user_id required' }, 400);

    // List followers
    if (url.searchParams.get('followers')) {
      const { results } = await env.DB.prepare(
        `SELECT u.id, u.nickname, u.photo_url, u.verified
         FROM user_follows f JOIN users u ON u.id = f.follower_id
         WHERE f.following_id = ? ORDER BY f.created_at DESC LIMIT 100`
      ).bind(targetId).all();
      return json({ ok: true, users: results });
    }

    // List following
    if (url.searchParams.get('following')) {
      const { results } = await env.DB.prepare(
        `SELECT u.id, u.nickname, u.photo_url, u.verified
         FROM user_follows f JOIN users u ON u.id = f.following_id
         WHERE f.follower_id = ? ORDER BY f.created_at DESC LIMIT 100`
      ).bind(targetId).all();
      return json({ ok: true, users: results });
    }

    // Counts + is_following
    const [followersRow, followingRow] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) as cnt FROM user_follows WHERE following_id = ?').bind(targetId).first(),
      env.DB.prepare('SELECT COUNT(*) as cnt FROM user_follows WHERE follower_id = ?').bind(targetId).first(),
    ]);

    let isFollowing = false;
    if (me && me.id !== targetId) {
      const check = await env.DB.prepare(
        'SELECT 1 FROM user_follows WHERE follower_id = ? AND following_id = ?'
      ).bind(me.id, targetId).first().catch(() => null);
      isFollowing = !!check;
    }

    return json({
      ok: true,
      followers: followersRow?.cnt || 0,
      following: followingRow?.cnt || 0,
      is_following: isFollowing,
    });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const me = await requireUser(request, env);
    if (!me) return json({ ok: false, error: 'Not signed in' }, 401);
    const { user_id } = await request.json();
    if (!user_id) return json({ ok: false, error: 'user_id required' }, 400);
    if (user_id === me.id) return json({ ok: false, error: 'Cannot follow yourself' }, 400);

    await env.DB.prepare(
      'INSERT OR IGNORE INTO user_follows (id, follower_id, following_id, created_at) VALUES (?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), me.id, user_id, new Date().toISOString()).run();

    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const me = await requireUser(request, env);
    if (!me) return json({ ok: false, error: 'Not signed in' }, 401);
    const user_id = new URL(request.url).searchParams.get('user_id');
    if (!user_id) return json({ ok: false, error: 'user_id required' }, 400);

    await env.DB.prepare(
      'DELETE FROM user_follows WHERE follower_id = ? AND following_id = ?'
    ).bind(me.id, user_id).run();

    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
      }
