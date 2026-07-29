// functions/api/admin/statuses.js
// Owner/admin-only: list every active status so the admin can review and remove
// any of them. Deletion goes through the existing PUT /api/statuses
// {action:'delete'} which already lets admins remove anyone's status.
//   GET -> { ok, statuses:[{id,user_id,nickname,photo_url,type,text,media_url,created_at,views,privacy}] }

import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    const isAdmin = user && (user.role === 'admin_super' || isOwnerOrCoOwner(user, env.OWNER_EMAIL));
    if (!isAdmin) return json({ ok: false, error: 'Admin only' }, 403);

    // Active = created within the last 24h.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let rows = [];
    try {
      const r = await env.DB.prepare(
        `SELECT s.id, s.user_id, s.type, s.text, s.media_key, s.bg, s.color, s.created_at, s.privacy, s.views,
                u.nickname, u.photo_url, u.verified
         FROM statuses s JOIN users u ON u.id = s.user_id
         WHERE s.created_at > ?
         ORDER BY s.created_at DESC LIMIT 500`
      ).bind(since).all();
      rows = r.results || [];
    } catch (e) {
      const r = await env.DB.prepare(
        `SELECT s.id, s.user_id, s.type, s.text, s.media_key, s.created_at,
                u.nickname, u.photo_url
         FROM statuses s JOIN users u ON u.id = s.user_id
         WHERE s.created_at > ? ORDER BY s.created_at DESC LIMIT 500`
      ).bind(since).all().catch(() => ({ results: [] }));
      rows = r.results || [];
    }

    const statuses = rows.map((s) => ({
      ...s,
      media_url: s.media_key ? '/api/media/' + encodeURIComponent(s.media_key) : null,
    }));
    return json({ ok: true, statuses });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
