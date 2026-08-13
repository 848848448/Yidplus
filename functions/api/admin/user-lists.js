// The lists behind the numbers on a user's admin page.
//
// user-detail.js answers "how many"; this answers "which ones" — the same
// queries, returning rows instead of COUNT(*), so a count can be tapped to see
// what it's actually made of.
//
// GET ?user_id=xxx&type=followers|following|groups_created|groups_joined|statuses|shorts|music

import { json, corsHeaders, requireUser, isAdminRole } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: true, error: 'Forbidden' });

    const url = new URL(request.url);
    const targetId = url.searchParams.get('user_id');
    const type = url.searchParams.get('type') || '';
    if (!targetId) return json({ ok: true, error: 'user_id required' });

    const q = (sql, ...binds) =>
      env.DB.prepare(sql).bind(...binds).all().catch(() => ({ results: [] }));

    let rows = [];
    let title = type;

    switch (type) {
      case 'followers':
        title = 'Followers';
        rows = (await q(
          `SELECT u.id, u.nickname, u.photo_url, f.created_at
           FROM user_follows f LEFT JOIN users u ON u.id = f.follower_id
           WHERE f.following_id = ? ORDER BY f.created_at DESC LIMIT 200`, targetId)).results;
        break;

      case 'following':
        title = 'Following';
        rows = (await q(
          `SELECT u.id, u.nickname, u.photo_url, f.created_at
           FROM user_follows f LEFT JOIN users u ON u.id = f.following_id
           WHERE f.follower_id = ? ORDER BY f.created_at DESC LIMIT 200`, targetId)).results;
        break;

      case 'groups_created':
        title = 'Groups made';
        rows = (await q(
          `SELECT id, name AS nickname, emoji, created_at
           FROM rooms WHERE created_by = ? AND type = 'group'
           ORDER BY created_at DESC LIMIT 200`, targetId)).results;
        break;

      case 'groups_joined':
        title = 'Groups joined';
        rows = (await q(
          `SELECT r.id, r.name AS nickname, r.emoji, m.joined_at AS created_at
           FROM room_members m LEFT JOIN rooms r ON r.id = m.room_id
           WHERE m.user_id = ? ORDER BY m.joined_at DESC LIMIT 200`, targetId)).results;
        break;

      case 'telegram_channels':
        // Joining an embedded Telegram channel is tracked separately from room
        // membership, so it never showed up under groups.
        title = 'Telegram channels';
        rows = (await q(
          `SELECT c.id, COALESCE(c.title, m.username) AS nickname, m.username AS emoji, m.joined_at AS created_at
           FROM telegram_channel_members m
           LEFT JOIN telegram_channels c ON c.username = m.username
           WHERE m.user_id = ? ORDER BY m.joined_at DESC LIMIT 200`, targetId)).results;
        break;

      case 'statuses':
        title = 'Statuses';
        rows = (await q(
          'SELECT id, text AS nickname, created_at FROM statuses WHERE user_id = ? ORDER BY created_at DESC LIMIT 200',
          targetId)).results;
        break;

      case 'shorts':
        title = 'Shorts';
        rows = (await q(
          'SELECT id, caption AS nickname, created_at FROM shorts WHERE owner_id = ? ORDER BY created_at DESC LIMIT 200',
          targetId)).results;
        break;

      case 'music':
        title = 'Music';
        rows = (await q(
          'SELECT id, title AS nickname, artist AS emoji, created_at FROM music_tracks WHERE owner_id = ? ORDER BY created_at DESC LIMIT 200',
          targetId)).results;
        break;

      default:
        return json({ ok: true, error: 'Unknown list: ' + type });
    }

    return json({ ok: true, title, items: rows || [] });
  } catch (err) {
    return json({ ok: true, items: [], error: err.message });
  }
}
