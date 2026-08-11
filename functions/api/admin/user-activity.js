// Live watch: a merged recent-activity timeline for ONE user (owner only).
import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
    const uid = new URL(request.url).searchParams.get('user_id');
    if (!uid) return json({ ok: false, error: 'user_id required' }, 400);

    const q = (sql, args) => env.DB.prepare(sql).bind(...(args || [])).all().catch(() => ({ results: [] }));

    const prof = await env.DB.prepare('SELECT id, nickname, email, online, blocked, role FROM users WHERE id = ?').bind(uid).first().catch(() => null);
    if (!prof) return json({ ok: false, error: 'User not found' }, 404);

    const [msgs, posts, shorts, statuses, sessions] = await Promise.all([
      q(`SELECT m.created_at, r.name AS room, r.type AS rtype FROM messages m LEFT JOIN rooms r ON r.id = m.room_id WHERE m.sender_id = ? ORDER BY m.created_at DESC LIMIT 15`, [uid]),
      q(`SELECT caption, created_at FROM posts WHERE user_id = ? ORDER BY created_at DESC LIMIT 8`, [uid]),
      q(`SELECT created_at FROM shorts WHERE owner_id = ? ORDER BY created_at DESC LIMIT 6`, [uid]),
      q(`SELECT created_at FROM statuses WHERE user_id = ? ORDER BY created_at DESC LIMIT 6`, [uid]),
      q(`SELECT created_at, ip, fingerprint FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 8`, [uid]),
    ]);

    const ev = [];
    (msgs.results || []).forEach(r => ev.push({ t: r.created_at, icon: '💬', text: 'Sent a message' + (r.room ? ' in ' + r.room : (r.rtype === 'private' ? ' (DM)' : '')) }));
    (posts.results || []).forEach(r => ev.push({ t: r.created_at, icon: '📝', text: 'Posted' + (r.caption ? ': ' + String(r.caption).slice(0, 50) : '') }));
    (shorts.results || []).forEach(r => ev.push({ t: r.created_at, icon: '🎬', text: 'Added a Short' }));
    (statuses.results || []).forEach(r => ev.push({ t: r.created_at, icon: '⭕', text: 'Posted a Status' }));
    (sessions.results || []).forEach(r => ev.push({ t: r.created_at, icon: '🔓', text: 'Signed in' + (r.ip ? ' from ' + r.ip : '') }));

    ev.sort((a, b) => (b.t || '').localeCompare(a.t || ''));

    return json({ ok: true, profile: prof, events: ev.slice(0, 40) });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}
