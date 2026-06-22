// functions/api/channel-follows.js
// GET  /api/channel-follows?channel_owner_id=X   -> list pending requests (owner/admin only)
// GET  /api/channel-follows?check=1&channel_owner_id=X  -> check if current user is approved follower
// POST /api/channel-follows { channel_owner_id }  -> send a follow request
// PUT  /api/channel-follows { request_id, action: 'approve'|'reject' }  -> owner responds
// DELETE /api/channel-follows?channel_owner_id=X  -> unfollow / cancel request

import { json, corsHeaders, requireUser } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

// GET — list pending requests (for the channel owner's inbox)
// OR check if the current user is an approved follower
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const url = new URL(request.url);
    const ownerId = url.searchParams.get('channel_owner_id');
    const check   = url.searchParams.get('check');

    if (!ownerId) return json({ ok: false, error: 'channel_owner_id is required' }, 400);

    // Quick follower-status check for a visitor
    if (check) {
      const row = await env.DB.prepare(
        `SELECT 1 FROM channel_followers WHERE channel_owner_id = ? AND follower_id = ?`
      ).bind(ownerId, user.id).first();
      const req = await env.DB.prepare(
        `SELECT status FROM channel_follow_requests WHERE channel_owner_id = ? AND requester_id = ?`
      ).bind(ownerId, user.id).first();
      return json({ ok: true, is_follower: !!row, request_status: req ? req.status : null });
    }

    // Only the channel owner or an admin can see the pending list
    const isAdmin = user.role === 'admin_super' || user.role === 'admin_limited';
    if (user.id !== ownerId && !isAdmin) return json({ ok: false, error: 'Forbidden' }, 403);

    const { results } = await env.DB.prepare(
      `SELECT id, requester_id, requester_nick, status, created_at
       FROM channel_follow_requests
       WHERE channel_owner_id = ? AND status = 'pending'
       ORDER BY created_at DESC`
    ).bind(ownerId).all();

    return json({ ok: true, requests: results });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

// POST — send a follow request
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const body = await request.json();
    const ownerId = body.channel_owner_id;
    if (!ownerId) return json({ ok: false, error: 'channel_owner_id is required' }, 400);
    if (ownerId === user.id) return json({ ok: false, error: 'You cannot follow your own channel' }, 400);

    // Admins are auto-approved — never need to request
    const isAdmin = user.role === 'admin_super' || user.role === 'admin_limited';
    if (isAdmin) {
      await env.DB.prepare(
        `INSERT OR REPLACE INTO channel_followers (channel_owner_id, follower_id, followed_at) VALUES (?, ?, ?)`
      ).bind(ownerId, user.id, new Date().toISOString()).run();
      return json({ ok: true, status: 'approved' });
    }

    // Check if already a follower
    const already = await env.DB.prepare(
      `SELECT 1 FROM channel_followers WHERE channel_owner_id = ? AND follower_id = ?`
    ).bind(ownerId, user.id).first();
    if (already) return json({ ok: true, status: 'already_following' });

    // Check channel privacy — if public, auto-approve
    const channel = await env.DB.prepare(
      `SELECT privacy FROM channels WHERE owner_id = ?`
    ).bind(ownerId).first();

    const now = new Date().toISOString();

    if (!channel || channel.privacy !== 'followers_only') {
      // Public channel — just follow directly, no request needed
      await env.DB.prepare(
        `INSERT OR REPLACE INTO channel_followers (channel_owner_id, follower_id, followed_at) VALUES (?, ?, ?)`
      ).bind(ownerId, user.id, now).run();
      return json({ ok: true, status: 'approved' });
    }

    // Private channel — create a pending request
    const existing = await env.DB.prepare(
      `SELECT status FROM channel_follow_requests WHERE channel_owner_id = ? AND requester_id = ?`
    ).bind(ownerId, user.id).first();

    if (existing) return json({ ok: true, status: existing.status });

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO channel_follow_requests (id, channel_owner_id, requester_id, requester_nick, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`
    ).bind(id, ownerId, user.id, user.nickname || '', now, now).run();

    return json({ ok: true, status: 'pending' });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

// PUT — owner approves or rejects a request
export async function onRequestPut(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const body = await request.json();
    const { request_id, action } = body;
    if (!request_id || !['approve', 'reject'].includes(action)) {
      return json({ ok: false, error: 'request_id and action (approve/reject) required' }, 400);
    }

    const req = await env.DB.prepare(
      `SELECT * FROM channel_follow_requests WHERE id = ?`
    ).bind(request_id).first();
    if (!req) return json({ ok: false, error: 'Request not found' }, 404);

    // Only the channel owner or an admin can respond
    const isAdmin = user.role === 'admin_super' || user.role === 'admin_limited';
    if (user.id !== req.channel_owner_id && !isAdmin) return json({ ok: false, error: 'Forbidden' }, 403);

    const now = new Date().toISOString();
    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    await env.DB.prepare(
      `UPDATE channel_follow_requests SET status = ?, updated_at = ? WHERE id = ?`
    ).bind(newStatus, now, request_id).run();

    if (action === 'approve') {
      await env.DB.prepare(
        `INSERT OR REPLACE INTO channel_followers (channel_owner_id, follower_id, followed_at) VALUES (?, ?, ?)`
      ).bind(req.channel_owner_id, req.requester_id, now).run();
    }

    return json({ ok: true, status: newStatus });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

// DELETE — unfollow or cancel a pending request
export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const url = new URL(request.url);
    const ownerId = url.searchParams.get('channel_owner_id');
    if (!ownerId) return json({ ok: false, error: 'channel_owner_id is required' }, 400);

    await env.DB.prepare(
      `DELETE FROM channel_followers WHERE channel_owner_id = ? AND follower_id = ?`
    ).bind(ownerId, user.id).run();
    await env.DB.prepare(
      `DELETE FROM channel_follow_requests WHERE channel_owner_id = ? AND requester_id = ?`
    ).bind(ownerId, user.id).run();

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
      }
