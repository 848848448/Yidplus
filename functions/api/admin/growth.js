import { json, corsHeaders, requireUser, isAdminRole } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

// Growth analytics: total users, new signups per day (last 30 days), and
// active-user counts (DAU / WAU / MAU) derived from sessions as an activity proxy.
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const totalRow = await env.DB.prepare('SELECT COUNT(*) AS c FROM users').first();
    const total = totalRow ? totalRow.c : 0;

    // New users per day for the last 30 days.
    let perDay = [];
    try {
      const res = await env.DB.prepare(
        "SELECT substr(created_at,1,10) AS day, COUNT(*) AS c FROM users " +
        "WHERE created_at >= datetime('now','-30 days') GROUP BY day ORDER BY day"
      ).all();
      perDay = (res.results || []).map(function (r) { return { day: r.day, count: r.c }; });
    } catch (e) {}

    // Active users (distinct user_id with a session created in the window).
    async function active(days) {
      try {
        const r = await env.DB.prepare(
          "SELECT COUNT(DISTINCT user_id) AS c FROM sessions WHERE created_at >= datetime('now','-" + days + " days')"
        ).first();
        return r ? r.c : 0;
      } catch (e) { return null; }
    }
    const dau = await active(1);
    const wau = await active(7);
    const mau = await active(30);

    // New users in the last 24h / 7d for quick headline numbers.
    async function newUsers(days) {
      try {
        const r = await env.DB.prepare(
          "SELECT COUNT(*) AS c FROM users WHERE created_at >= datetime('now','-" + days + " days')"
        ).first();
        return r ? r.c : 0;
      } catch (e) { return null; }
    }

    return json({
      ok: true,
      total: total,
      new_24h: await newUsers(1),
      new_7d: await newUsers(7),
      dau: dau, wau: wau, mau: mau,
      per_day: perDay,
      generated_at: new Date().toISOString()
    });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
