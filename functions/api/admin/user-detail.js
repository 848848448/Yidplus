// functions/api/admin/user-detail.js
// GET /api/admin/user-detail?user_id=X
// Full activity picture for one user: profile (owner-only PII), content
// counts across every feature, login history, and recent audit-log entries
// involving them (as actor or as target). Owner/Co-Owner only — this is
// the "see exactly what someone does" panel.

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
    const targetId = url.searchParams.get('user_id');
    if (!targetId) return json({ ok: false, error: 'user_id is required' }, 400);

    const profile = await env.DB.prepare(
      `SELECT id, email, nickname, phone, role, verified, blocked, no_ads, created_at,
              (CASE WHEN online = 1 AND last_ping >= datetime('now','-60 seconds') THEN 1 ELSE 0 END) AS online,
              last_ping
       FROM users WHERE id = ?`
    ).bind(targetId).first().catch(() =>
      env.DB.prepare(
        `SELECT id, email, nickname, phone, role, verified, blocked, no_ads, created_at, online
         FROM users WHERE id = ?`
      ).bind(targetId).first()
    );
    if (!profile) return json({ ok: false, error: 'User not found' }, 404);

    const [messages, shorts, statuses, music, groupsCreated, groupsJoined, tgChannels] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS c FROM messages WHERE sender_id = ?').bind(targetId).first().catch(() => ({ c: 0 })),
      env.DB.prepare('SELECT COUNT(*) AS c FROM shorts WHERE owner_id = ?').bind(targetId).first().catch(() => ({ c: 0 })),
      env.DB.prepare('SELECT COUNT(*) AS c FROM statuses WHERE user_id = ?').bind(targetId).first().catch(() => ({ c: 0 })),
      env.DB.prepare('SELECT COUNT(*) AS c FROM music_tracks WHERE owner_id = ?').bind(targetId).first().catch(() => ({ c: 0 })),
      env.DB.prepare("SELECT COUNT(*) AS c FROM rooms WHERE created_by = ? AND type = 'group'").bind(targetId).first().catch(() => ({ c: 0 })),
      env.DB.prepare('SELECT COUNT(*) AS c FROM room_members WHERE user_id = ?').bind(targetId).first().catch(() => ({ c: 0 })),
      // Telegram channel membership lives in its own table, so it was
      // invisible here — a user could be in six channels and show none.
      env.DB.prepare('SELECT COUNT(*) AS c FROM telegram_channel_members WHERE user_id = ?').bind(targetId).first().catch(() => ({ c: 0 })),
    ]);

    const [followers, following] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS c FROM user_follows WHERE following_id = ?').bind(targetId).first().catch(() => ({ c: 0 })),
      env.DB.prepare('SELECT COUNT(*) AS c FROM user_follows WHERE follower_id = ?').bind(targetId).first().catch(() => ({ c: 0 })),
    ]);

    // Distinct devices/IPs this user has signed in from, with a ban flag so the
    // owner can cut off a blocked user's device right from this view.
    const { results: deviceRows } = await env.DB.prepare(
      `SELECT ip, fingerprint, COUNT(*) AS hits, MAX(created_at) AS last_seen
       FROM login_logs
       WHERE user_id = ? AND (ip IS NOT NULL OR fingerprint IS NOT NULL)
       GROUP BY ip, fingerprint
       ORDER BY last_seen DESC LIMIT 15`
    ).bind(targetId).all().catch(() => ({ results: [] }));

    const { results: bans } = await env.DB.prepare(
      'SELECT ip, fingerprint FROM device_bans'
    ).all().catch(() => ({ results: [] }));
    const bannedIps = new Set(bans.map(b => b.ip).filter(Boolean));
    const bannedFps = new Set(bans.map(b => b.fingerprint).filter(Boolean));
    const devices = deviceRows.map(d => ({
      ip: d.ip, fingerprint: d.fingerprint, hits: d.hits, last_seen: d.last_seen,
      banned: bannedIps.has(d.ip) || bannedFps.has(d.fingerprint),
    }));

    const { results: loginHistory } = await env.DB.prepare(
      `SELECT ip, fingerprint, action, created_at FROM login_logs
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 25`
    ).bind(targetId).all().catch(() => ({ results: [] }));

    // Audit trail: things this user did as a moderator/admin (actor_id),
    // plus moderation actions taken against them (target_id).
    const { results: auditAsActor } = await env.DB.prepare(
      `SELECT id, action, target_type, target_id, details, created_at
       FROM audit_logs WHERE actor_id = ? ORDER BY created_at DESC LIMIT 25`
    ).bind(targetId).all().catch(() => ({ results: [] }));

    const { results: auditAsTarget } = await env.DB.prepare(
      `SELECT id, actor_id, actor_nick, action, details, created_at
       FROM audit_logs WHERE target_id = ? ORDER BY created_at DESC LIMIT 25`
    ).bind(targetId).all().catch(() => ({ results: [] }));

    return json({
      ok: true,
      profile,
      counts: {
        messages: messages?.c || 0,
        shorts: shorts?.c || 0,
        statuses: statuses?.c || 0,
        music: music?.c || 0,
        groups_created: groupsCreated?.c || 0,
        groups_joined: groupsJoined?.c || 0,
        telegram_channels: tgChannels?.c || 0,
        followers: followers?.c || 0,
        following: following?.c || 0,
      },
      devices,
      login_history: loginHistory,
      audit_as_actor: auditAsActor,
      audit_as_target: auditAsTarget,
    });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
