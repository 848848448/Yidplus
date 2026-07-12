// functions/api/admin/insights.js
// Owner/admin live dashboard data:
//   { ok, online_now, active_sessions, today:{users,messages,shorts},
//     total_users, growth:[{day,count}...], duplicates:[{key,type,users:[...]}] }

import { json, corsHeaders, requireUser, isAdminRole } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function startOfTodayISO() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Admins only' }, 403);

    const today = startOfTodayISO();

    const [onlineNow, sessions, totalUsers, tUsers, tMsgs, tShorts] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS c FROM users WHERE online = 1 AND last_ping >= datetime('now','-60 seconds')").first()
        .catch(() => env.DB.prepare('SELECT COUNT(*) AS c FROM users WHERE online = 1').first().catch(() => ({ c: 0 }))),
      env.DB.prepare('SELECT COUNT(DISTINCT user_id) AS c FROM sessions').first().catch(() => ({ c: 0 })),
      env.DB.prepare('SELECT COUNT(*) AS c FROM users').first().catch(() => ({ c: 0 })),
      env.DB.prepare('SELECT COUNT(*) AS c FROM users WHERE created_at >= ?').bind(today).first().catch(() => ({ c: 0 })),
      env.DB.prepare('SELECT COUNT(*) AS c FROM messages WHERE created_at >= ?').bind(today).first().catch(() => ({ c: 0 })),
      env.DB.prepare('SELECT COUNT(*) AS c FROM shorts WHERE created_at >= ?').bind(today).first().catch(() => ({ c: 0 })),
    ]);

    // New users per day, last 14 days
    const { results: growthRows } = await env.DB.prepare(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
       FROM users
       WHERE created_at >= date('now', '-13 days')
       GROUP BY day ORDER BY day ASC`
    ).all().catch(() => ({ results: [] }));

    // Fill missing days with 0 so the chart is continuous
    const growth = [];
    const base = new Date(); base.setUTCHours(0, 0, 0, 0);
    for (let i = 13; i >= 0; i--) {
      const d = new Date(base); d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      const found = growthRows.find(r => r.day === key);
      growth.push({ day: key, count: found ? found.count : 0 });
    }

    // Duplicate accounts: same IP or fingerprint used by >1 distinct user
    const { results: dupRows } = await env.DB.prepare(
      `SELECT ip AS k, 'IP' AS type, COUNT(DISTINCT user_id) AS n,
              GROUP_CONCAT(DISTINCT user_id) AS ids
       FROM login_logs WHERE ip IS NOT NULL AND ip != ''
       GROUP BY ip HAVING n > 1
       UNION ALL
       SELECT fingerprint AS k, 'Device' AS type, COUNT(DISTINCT user_id) AS n,
              GROUP_CONCAT(DISTINCT user_id) AS ids
       FROM login_logs WHERE fingerprint IS NOT NULL AND fingerprint != ''
       GROUP BY fingerprint HAVING n > 1
       ORDER BY n DESC LIMIT 25`
    ).all().catch(() => ({ results: [] }));

    // Resolve user nicknames for the duplicate clusters
    const allIds = [...new Set(dupRows.flatMap(r => (r.ids || '').split(',')).filter(Boolean))];
    let nickMap = {};
    if (allIds.length) {
      const placeholders = allIds.map(() => '?').join(',');
      const { results: us } = await env.DB.prepare(
        `SELECT id, nickname FROM users WHERE id IN (${placeholders})`
      ).bind(...allIds).all().catch(() => ({ results: [] }));
      us.forEach(u => { nickMap[u.id] = u.nickname; });
    }
    const duplicates = dupRows.map(r => ({
      key: r.type === 'IP' ? r.k : String(r.k).slice(0, 12),
      type: r.type,
      count: r.n,
      users: (r.ids || '').split(',').filter(Boolean).map(id => ({ id, nickname: nickMap[id] || '(deleted)' })),
    }));

    // Who is online right now (recent heartbeat)
    const onlineList = await env.DB.prepare(
      "SELECT id, nickname, photo_url FROM users WHERE online = 1 AND last_ping >= datetime('now','-60 seconds') ORDER BY last_ping DESC LIMIT 50"
    ).all().catch(() => ({ results: [] }));

    return json({
      ok: true,
      online_now: onlineNow?.c || 0,
      online_users: onlineList.results || [],
      active_sessions: sessions?.c || 0,
      total_users: totalUsers?.c || 0,
      today: { users: tUsers?.c || 0, messages: tMsgs?.c || 0, shorts: tShorts?.c || 0 },
      growth,
      duplicates,
    });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
