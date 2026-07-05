// GET    /api/follows?user_id=X               -> { followers, following, is_following, is_private, has_pending_request }
// GET    /api/follows?followers=1&user_id=X    -> list followers
// GET    /api/follows?following=1&user_id=X    -> list following
// GET    /api/follows?requests=1               -> list my pending follow requests (people who want to follow ME)
// POST   /api/follows { user_id }              -> follow (or send request if target is private)
// POST   /api/follows/accept { requester_id }  -> accept a follow request (handled below via action param)
// DELETE /api/follows?user_id=X                -> unfollow
// DELETE /api/follows?user_id=X&request=1      -> cancel my own pending request, or reject an incoming one

import { json, corsHeaders, requireUser } from './_helpers.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const me = await requireUser(request, env).catch(() => null);
    const url = new URL(request.url);

    // List MY pending incoming follow requests
    if (url.searchParams.get('requests')) {
      if (!me) return json({ ok: false, error: 'Not signed in' }, 401);
      const { results } = await env.DB.prepare(
        `SELECT fr.id as request_id, u.id, u.nickname, u.photo_url, u.verified, fr.created_at
         FROM follow_requests fr JOIN users u ON u.id = fr.requester_id
         WHERE fr.target_id = ? ORDER BY fr.created_at DESC LIMIT 100`
      ).bind(me.id).all().catch(() => ({ results: [] }));
      return json({ ok: true, requests: results });
    }

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

    // Counts + is_following + privacy + pending request status
    const [followersRow, followingRow, targetUser] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) as cnt FROM user_follows WHERE following_id = ?').bind(targetId).first(),
      env.DB.prepare('SELECT COUNT(*) as cnt FROM user_follows WHERE follower_id = ?').bind(targetId).first(),
      env.DB.prepare('SELECT is_private FROM users WHERE id = ?').bind(targetId).first().catch(() => null),
    ]);

    let isFollowing = false;
    let hasPendingRequest = false;
    if (me && me.id !== targetId) {
      const check = await env.DB.prepare(
        'SELECT 1 FROM user_follows WHERE follower_id = ? AND following_id = ?'
      ).bind(me.id, targetId).first().catch(() => null);
      isFollowing = !!check;

      if (!isFollowing) {
        const pending = await env.DB.prepare(
          'SELECT 1 FROM follow_requests WHERE requester_id = ? AND target_id = ?'
        ).bind(me.id, targetId).first().catch(() => null);
        hasPendingRequest = !!pending;
      }
    }

    return json({
      ok: true,
      followers: followersRow?.cnt || 0,
      following: followingRow?.cnt || 0,
      is_following: isFollowing,
      is_private: !!(targetUser && targetUser.is_private),
      has_pending_request: hasPendingRequest,
    });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const me = await requireUser(request, env);
    if (!me) return json({ ok: false, error: 'Not signed in' }, 401);
    const body = await request.json();

    // ── Accept a follow request ──
    if (body.action === 'accept' && body.requester_id) {
      const req = await env.DB.prepare(
        'SELECT id FROM follow_requests WHERE requester_id = ? AND target_id = ?'
      ).bind(body.requester_id, me.id).first().catch(() => null);
      if (!req) return json({ ok: false, error: 'Request not found' }, 404);

      await env.DB.prepare(
        'INSERT OR IGNORE INTO user_follows (id, follower_id, following_id, created_at) VALUES (?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), body.requester_id, me.id, new Date().toISOString()).run();
      await env.DB.prepare('DELETE FROM follow_requests WHERE id = ?').bind(req.id).run().catch(() => {});

      return json({ ok: true, accepted: true });
    }

    // ── Normal follow / follow-request ──
    const { user_id } = body;
    if (!user_id) return json({ ok: false, error: 'user_id required' }, 400);
    if (user_id === me.id) return json({ ok: false, error: 'Cannot follow yourself' }, 400);

    const target = await env.DB.prepare('SELECT is_private FROM users WHERE id = ?').bind(user_id).first()
      .catch(() => env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(user_id).first());
    if (!target) return json({ ok: false, error: 'User not found' }, 404);

    if (target.is_private) {
      // Send a follow request instead of following directly
      await env.DB.prepare(
        'INSERT OR IGNORE INTO follow_requests (id, requester_id, target_id, created_at) VALUES (?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), me.id, user_id, new Date().toISOString()).run();
      return json({ ok: true, requested: true });
    }

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
    const url = new URL(request.url);
    const user_id = url.searchParams.get('user_id');
    if (!user_id) return json({ ok: false, error: 'user_id required' }, 400);

    // Cancel my own pending request, or reject an incoming one
    if (url.searchParams.get('request')) {
      await env.DB.prepare(
        'DELETE FROM follow_requests WHERE (requester_id = ? AND target_id = ?) OR (requester_id = ? AND target_id = ?)'
      ).bind(me.id, user_id, user_id, me.id).run().catch(() => {});
      return json({ ok: true });
    }

    await env.DB.prepare(
      'DELETE FROM user_follows WHERE follower_id = ? AND following_id = ?'
    ).bind(me.id, user_id).run();

    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
      }
