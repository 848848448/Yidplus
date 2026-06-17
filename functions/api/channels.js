// functions/api/channels.js
// GET /api/channels -> list channels (newest/most-followed first) for home page previews
// GET /api/channels?owner_id=xxx -> single channel detail (for channel page / wall)
// PUT /api/channels -> { verified } toggle verified badge — Super Admin only

import { json, corsHeaders, requireUser, isSuperOrOwner, logAudit } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const url = new URL(request.url);
    const ownerId = url.searchParams.get('owner_id');

    if (ownerId) {
      const channel = await env.DB.prepare(
        `SELECT id, owner_id, nickname, followers, following, total_views, verified, bio, cover_key, created_at
         FROM channels WHERE owner_id = ?`
      ).bind(ownerId).first();

      if (!channel) return json({ ok: false, error: 'Channel not found' }, 404);

      // The "wall": posts + shorts by this user, merged and sorted by date.
      const { results: posts } = await env.DB.prepare(
        `SELECT id, caption, content, likes, comments, created_at, 'post' AS wall_type
         FROM posts WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`
      ).bind(ownerId).all();

      const { results: shorts } = await env.DB.prepare(
        `SELECT id, caption, media_key, likes, views, created_at, 'short' AS wall_type
         FROM shorts WHERE owner_id = ? ORDER BY created_at DESC LIMIT 30`
      ).bind(ownerId).all();

      const wall = [...posts, ...shorts]
        .map(item => item.media_key ? { ...item, media_url: `/api/media/${encodeURIComponent(item.media_key)}` } : item)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      return json({ ok: true, channel, wall });
    }

    const { results } = await env.DB.prepare(
      `SELECT id, owner_id, nickname, followers, verified FROM channels
       ORDER BY followers DESC, created_at DESC LIMIT 20`
    ).all();

    return json({ ok: true, channels: results });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isSuperOrOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const body = await request.json();
    if (!body.owner_id) return json({ ok: false, error: 'owner_id is required' }, 400);

    if (typeof body.verified === 'boolean') {
      await env.DB.prepare(`UPDATE channels SET verified = ? WHERE owner_id = ?`)
        .bind(body.verified ? 1 : 0, body.owner_id).run();
      await logAudit(env, user, body.verified ? 'verify_channel' : 'unverify_channel', 'channel', body.owner_id, '');
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
  }
