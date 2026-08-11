// God Mode live feed: a merged, platform-wide stream of recent activity so the
// owner can see everything happening at a glance. Owner/co-owner only.
import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const q = (sql, args) => env.DB.prepare(sql).bind(...(args || [])).all().catch(() => ({ results: [] }));

    const [signups, posts, shorts, statuses, logins, reports, tgPosts, online] = await Promise.all([
      q(`SELECT id, nickname, created_at FROM users ORDER BY created_at DESC LIMIT 12`),
      q(`SELECT p.id, p.caption, p.created_at, u.nickname FROM posts p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT 12`),
      q(`SELECT s.id, s.created_at, u.nickname FROM shorts s LEFT JOIN users u ON u.id = s.owner_id ORDER BY s.created_at DESC LIMIT 8`),
      q(`SELECT s.id, s.created_at, u.nickname FROM statuses s LEFT JOIN users u ON u.id = s.user_id ORDER BY s.created_at DESC LIMIT 8`),
      q(`SELECT s.created_at, u.nickname, s.user_id FROM sessions s LEFT JOIN users u ON u.id = s.user_id ORDER BY s.created_at DESC LIMIT 12`),
      q(`SELECT r.id, r.reason, r.created_at, r.reported_nick FROM reports r ORDER BY r.created_at DESC LIMIT 10`).catch(() => ({ results: [] })),
      q(`SELECT id, username, posted_at FROM telegram_posts ORDER BY posted_at DESC LIMIT 8`),
      env.DB.prepare(`SELECT COUNT(*) AS c FROM users WHERE online = 1`).first().catch(() => ({ c: 0 })),
    ]);

    const ev = [];
    (signups.results || []).forEach(r => ev.push({ t: r.created_at, type: 'signup', icon: '👤', text: `New user @${r.nickname || 'user'} joined`, user_id: r.id }));
    (posts.results || []).forEach(r => ev.push({ t: r.created_at, type: 'post', icon: '📝', text: `@${r.nickname || 'user'} posted${r.caption ? ': ' + String(r.caption).slice(0, 50) : ''}` }));
    (shorts.results || []).forEach(r => ev.push({ t: r.created_at, type: 'short', icon: '🎬', text: `@${r.nickname || 'user'} added a Short` }));
    (statuses.results || []).forEach(r => ev.push({ t: r.created_at, type: 'status', icon: '⭕', text: `@${r.nickname || 'user'} posted a Status` }));
    (logins.results || []).forEach(r => ev.push({ t: r.created_at, type: 'login', icon: '🔓', text: `@${r.nickname || 'user'} signed in`, user_id: r.user_id }));
    (reports.results || []).forEach(r => ev.push({ t: r.created_at, type: 'report', icon: '🚩', text: `Report on @${r.reported_nick || 'user'}${r.reason ? ' — ' + String(r.reason).slice(0, 40) : ''}` }));
    (tgPosts.results || []).forEach(r => ev.push({ t: r.posted_at, type: 'tg', icon: '📡', text: `New Telegram post in @${r.username}` }));

    ev.sort((a, b) => (b.t || '').localeCompare(a.t || ''));

    // Quick command-center stats.
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const [totalU, newToday, pendReports] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) AS c FROM users`).first().catch(() => ({ c: 0 })),
      env.DB.prepare(`SELECT COUNT(*) AS c FROM users WHERE created_at > ?`).bind(todayStart.toISOString()).first().catch(() => ({ c: 0 })),
      env.DB.prepare(`SELECT COUNT(*) AS c FROM reports WHERE COALESCE(status,'open') = 'open'`).first().catch(() => ({ c: 0 })),
    ]);

    return json({
      ok: true,
      online_now: (online && online.c) || 0,
      total_users: (totalU && totalU.c) || 0,
      new_today: (newToday && newToday.c) || 0,
      reports_pending: (pendReports && pendReports.c) || 0,
      events: ev.slice(0, 40),
    });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}
