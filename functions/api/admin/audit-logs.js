// functions/api/admin/audit-logs.js
// GET /api/admin/audit-logs?limit=50 -> list recent moderator/admin actions
// Super Admin only.

import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const url = new URL(request.url);
    const limit = Math.min(200, parseInt(url.searchParams.get('limit') || '50', 10));

    const { results } = await env.DB.prepare(
      `SELECT id, actor_id, actor_nick, actor_role, action, target_type, target_id, details, created_at
       FROM audit_logs ORDER BY created_at DESC LIMIT ?`
    ).bind(limit).all();

    return json({ ok: true, logs: results });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
                                                             }
