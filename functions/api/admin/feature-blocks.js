// functions/api/admin/feature-blocks.js
// GET    /api/admin/feature-blocks?user_id=X   -> list all active/past blocks for a user (owner only)
// GET    /api/admin/feature-blocks              -> the CALLING user's own active blocks (any signed-in user)
// POST   /api/admin/feature-blocks              -> { user_id, feature, hours } create/refresh a block (owner only)
//                                                    hours omitted or 0 = indefinite, until manually unblocked
// DELETE /api/admin/feature-blocks?user_id=X&feature=Y -> remove a block (owner only)
//
// Blocking a user from a feature NEVER deletes or hides their existing
// content — it only prevents them from opening/using that feature going
// forward, until the timer runs out or an owner unblocks them.

import { json, corsHeaders, requireUser, isOwnerOrCoOwner, logAudit } from '../_helpers.js';

const VALID_FEATURES = ['shorts', 'statuses', 'music', 'channels', 'chat'];

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const url = new URL(request.url);
    const targetId = url.searchParams.get('user_id');

    // Self-check mode: any signed-in user can ask "am I blocked from
    // anything right now?" — every feature page calls this on load.
    if (!targetId) {
      const { results } = await env.DB.prepare(
        `SELECT feature, blocked_until FROM feature_blocks
         WHERE user_id = ? AND (blocked_until IS NULL OR blocked_until > ?)`
      ).bind(user.id, new Date().toISOString()).all().catch(() => ({ results: [] }));
      return json({ ok: true, blocks: results });
    }

    // Admin-detail mode: owner looking up a specific user's block history.
    if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
    const { results } = await env.DB.prepare(
      `SELECT id, feature, blocked_until, blocked_by, created_at FROM feature_blocks
       WHERE user_id = ? ORDER BY created_at DESC`
    ).bind(targetId).all().catch(() => ({ results: [] }));
    return json({ ok: true, blocks: results });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const body = await request.json();
    const targetId = body.user_id;
    const feature = body.feature;
    if (!targetId || !VALID_FEATURES.includes(feature)) {
      return json({ ok: false, error: 'user_id and a valid feature are required' }, 400);
    }

    const target = await env.DB.prepare('SELECT email, nickname FROM users WHERE id = ?').bind(targetId).first();
    if (!target) return json({ ok: false, error: 'User not found' }, 404);
    if ((target.email || '').toLowerCase() === env.OWNER_EMAIL || (target.email || '').toLowerCase() === 'jmittelman2@gmail.com') {
      return json({ ok: false, error: 'Cannot block the owner or co-owner' }, 403);
    }

    const hours = parseFloat(body.hours) || 0;
    const blockedUntil = hours > 0 ? new Date(Date.now() + hours * 3600000).toISOString() : null;
    const now = new Date().toISOString();

    // One row per (user, feature) — replace any existing block for this feature.
    await env.DB.prepare('DELETE FROM feature_blocks WHERE user_id = ? AND feature = ?').bind(targetId, feature).run();
    await env.DB.prepare(
      `INSERT INTO feature_blocks (id, user_id, feature, blocked_until, blocked_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), targetId, feature, blockedUntil, user.nickname, now).run();

    await logAudit(env, user, 'block_feature', 'user', targetId,
      `@${target.nickname} blocked from ${feature}${blockedUntil ? ' until ' + blockedUntil : ' (indefinite)'}`);

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
    if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const url = new URL(request.url);
    const targetId = url.searchParams.get('user_id');
    const feature = url.searchParams.get('feature');
    if (!targetId || !feature) return json({ ok: false, error: 'user_id and feature are required' }, 400);

    await env.DB.prepare('DELETE FROM feature_blocks WHERE user_id = ? AND feature = ?').bind(targetId, feature).run();

    const target = await env.DB.prepare('SELECT nickname FROM users WHERE id = ?').bind(targetId).first().catch(() => null);
    await logAudit(env, user, 'unblock_feature', 'user', targetId, `@${target ? target.nickname : targetId} unblocked from ${feature}`);

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
