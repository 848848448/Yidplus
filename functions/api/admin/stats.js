import { json, corsHeaders, requireUser, isAdminRole } from '../_helpers.js';
export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const [users, shorts, msgs, online, music, channels, reports] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS c FROM users').first(),
      env.DB.prepare('SELECT COUNT(*) AS c FROM shorts').first(),
      env.DB.prepare('SELECT COUNT(*) AS c FROM messages').first(),
      env.DB.prepare('SELECT COUNT(*) AS c FROM users WHERE online = 1').first(),
      env.DB.prepare('SELECT COUNT(*) AS c FROM music_tracks').first().catch(() => ({ c: 0 })),
      env.DB.prepare('SELECT COUNT(*) AS c FROM channels').first().catch(() => ({ c: 0 })),
      env.DB.prepare('SELECT COUNT(*) AS c FROM reports WHERE resolved = 0').first().catch(() => ({ c: 0 })),
    ]);

    // New users today
    const today = new Date().toISOString().split('T')[0];
    const newToday = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM users WHERE created_at >= ?"
    ).bind(today).first().catch(() => ({ c: 0 }));

    // Daily visitors last 7 days
    const { results: daily } = await env.DB.prepare(
      `SELECT DATE(created_at) as day, COUNT(DISTINCT user_id) as visitors
       FROM login_logs
       WHERE created_at >= DATE('now', '-7 days')
       GROUP BY DATE(created_at)
       ORDER BY day ASC`
    ).all().catch(() => ({ results: [] }));

    return json({
      ok: true,
      stats: {
        users: users?.c || 0,
        new_today: newToday?.c || 0,
        online: online?.c || 0,
        shorts: shorts?.c || 0,
        messages: msgs?.c || 0,
        music: music?.c || 0,
        channels: channels?.c || 0,
        open_reports: reports?.c || 0,
      },
      daily_visitors: daily,
    });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
                                                                                                   }
