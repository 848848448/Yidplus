// functions/api/channels.js
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
        `SELECT id, owner_id, nickname, followers, following, total_views, verified, bio, cover_key, created_at, privacy
         FROM channels WHERE owner_id = ?`
      ).bind(ownerId).first();

      if (!channel) return json({ ok: false, error: 'Channel not found' }, 404);

      const user = await requireUser(request, env).catch(() => null);
      const isOwner = user && user.id === ownerId;
      const isAdmin = user && (user.role === 'admin_super' || user.role === 'admin_limited');

      if (channel.privacy === 'followers_only' && !isOwner && !isAdmin) {
        // Check if the user is an approved follower in the DB
        const isFollower = user ? await env.DB.prepare(
          `SELECT 1 FROM channel_followers WHERE channel_owner_id = ? AND follower_id = ?`
        ).bind(ownerId, user.id).first() : null;

        if (!isFollower) {
          // Check if they have a pending request
          const pending = user ? await env.DB.prepare(
            `SELECT status FROM channel_follow_requests WHERE channel_owner_id = ? AND requester_id = ?`
          ).bind(ownerId, user.id).first() : null;
          return json({ ok: true, channel, wall: null, locked: true, request_status: pending ? pending.status : null });
        }
      }

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

    const body = await request.json();
    if (!body.owner_id) return json({ ok: false, error: 'owner_id is required' }, 400);

    if (body.privacy !== undefined) {
      if (user.id !== body.owner_id && !isSuperOrOwner(user, env.OWNER_EMAIL)) {
        return json({ ok: false, error: 'You can only change your own channel privacy' }, 403);
      }
      const allowed = ['public', 'followers_only'];
      if (!allowed.includes(body.privacy)) return json({ ok: false, error: 'Invalid privacy value' }, 400);
      await env.DB.prepare(`UPDATE channels SET privacy = ? WHERE owner_id = ?`)
        .bind(body.privacy, body.owner_id).run();
      return json({ ok: true, privacy: body.privacy });
    }

    if (!isSuperOrOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

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

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return json({ ok: false, error: 'id required' }, 400);
    // Only owner of channel or admin can delete
    const ch = await env.DB.prepare('SELECT owner_id FROM channels WHERE id = ?').bind(id).first();
    if (!ch) return json({ ok: false, error: 'Channel not found' }, 404);
    if (ch.owner_id !== user.id && !isAdminRole(user, env.OWNER_EMAIL)) {
      return json({ ok: false, error: 'Forbidden' }, 403);
    }
    await env.DB.prepare('DELETE FROM channels WHERE id = ?').bind(id).run();
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
        }
