// Channel info for an embedded Telegram channel: who joined here, removing a
// member, and deleting a post. Admin-only actions are gated the same way the
// rest of the Telegram admin endpoints are (owner / super admin).
//
// GET    ?username=xxx                     -> { members: [...], is_admin }
// DELETE ?username=xxx&user_id=yyy         -> remove that member   (admin)
// DELETE ?username=xxx&tg_msg_id=123       -> delete that post     (admin)

import { json, corsHeaders, requireUser, isSuperOrOwner } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const username = (new URL(request.url).searchParams.get('username') || '')
      .replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '');
    if (!username) return json({ ok: true, members: [] });

    const user = await requireUser(request, env).catch(() => null);
    // Who's in your community isn't for passers-by. No emails are exposed
    // either way, but a signed-out visitor has no business enumerating members
    // and their ids — the counts on the channel row are public, the list isn't.
    if (!user) return json({ ok: true, error: 'Sign in to view members', members: [] });
    const isAdmin = !!(user && isSuperOrOwner(user, env.OWNER_EMAIL));

    const res = await env.DB.prepare(
      `SELECT m.user_id, m.joined_at, u.nickname, u.photo_url
       FROM telegram_channel_members m
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.username = ?
       ORDER BY m.joined_at ASC`
    ).bind(username).all().catch(() => ({ results: [] }));

    const posts = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM telegram_posts WHERE username = ?'
    ).bind(username).first().catch(() => ({ n: 0 }));

    return json({
      ok: true,
      is_admin: isAdmin,
      post_count: (posts && posts.n) || 0,
      members: (res.results || []).map((m) => ({
        user_id: m.user_id,
        name: m.nickname || 'Member',
        photo_url: m.photo_url || null,
        joined_at: m.joined_at,
      })),
    });
  } catch (err) {
    return json({ ok: true, members: [], error: err.message });
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isSuperOrOwner(user, env.OWNER_EMAIL)) return json({ ok: true, error: 'Forbidden' });

    const url = new URL(request.url);
    const username = (url.searchParams.get('username') || '').replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '');
    if (!username) return json({ ok: true, error: 'username required' });

    const userId = url.searchParams.get('user_id');
    const msgId = parseInt(url.searchParams.get('tg_msg_id'));

    if (userId) {
      await env.DB.prepare('DELETE FROM telegram_channel_members WHERE username = ? AND user_id = ?')
        .bind(username, userId).run();
      const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM telegram_channel_members WHERE username = ?')
        .bind(username).first();
      return json({ ok: true, removed: 'member', members: (c && c.n) || 0 });
    }

    if (msgId) {
      // Removing it here only hides it from the site — the post stays on
      // Telegram. The sync's seen-marker is already past it, so it won't come
      // back on the next run.
      await env.DB.prepare('DELETE FROM telegram_posts WHERE username = ? AND tg_msg_id = ?')
        .bind(username, msgId).run();
      await env.DB.prepare('DELETE FROM telegram_reactions WHERE username = ? AND tg_msg_id = ?')
        .bind(username, msgId).run().catch(() => {});
      return json({ ok: true, removed: 'post' });
    }

    return json({ ok: true, error: 'Pass user_id or tg_msg_id' });
  } catch (err) {
    return json({ ok: true, error: err.message });
  }
}
