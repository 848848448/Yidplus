// functions/api/admin/stats.js
// GET /api/admin/stats -> { total, online, shorts, messages, dailyVisitors }
// Requires admin role.

import { json, corsHeaders, requireUser, isAdminRole } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const totalRow  = await env.DB.prepare('SELECT COUNT(*) AS c FROM users').first();
    const onlineRow = await env.DB.prepare('SELECT COUNT(*) AS c FROM users WHERE online = 1').first();
    const shortsRow = await env.DB.prepare('SELECT COUNT(*) AS c FROM shorts').first().catch(() => ({ c: 0 }));
    const msgsRow   = await env.DB.prepare('SELECT COUNT(*) AS c FROM messages').first().catch(() => ({ c: 0 }));

    // Daily visitor counts for last 7 days, based on users.created_at
    // (simple proxy metric — real analytics would need a separate events table)
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().slice(0, 10);
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS c FROM users WHERE substr(created_at,1,10) = ?`
      ).bind(dayStr).first();
      days.push(row ? row.c : 0);
    }

    return json({
      ok: true,
      total: totalRow ? totalRow.c : 0,
      online: onlineRow ? onlineRow.c : 0,
      shorts: shortsRow ? shortsRow.c : 0,
      messages: msgsRow ? msgsRow.c : 0,
      dailyVisitors: days,
    });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
