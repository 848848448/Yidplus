import { json, corsHeaders, requireUser } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

// POST { username } → toggle joining a Telegram channel ON YID PLUS.
// This is our own membership, not Telegram's subscriber count: it says how many
// people follow the channel here.
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: true, error: 'Not signed in' });

    await env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS telegram_channel_members (username TEXT NOT NULL, user_id TEXT NOT NULL, joined_at TEXT NOT NULL, PRIMARY KEY (username, user_id))'
    ).run().catch(() => {});

    const body = await request.json().catch(() => ({}));
    const username = String(body.username || '').replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '');
    if (!username) return json({ ok: true, error: 'username required' });

    const exists = await env.DB.prepare(
      'SELECT 1 FROM telegram_channel_members WHERE username = ? AND user_id = ?'
    ).bind(username, user.id).first();

    if (exists) {
      await env.DB.prepare('DELETE FROM telegram_channel_members WHERE username = ? AND user_id = ?')
        .bind(username, user.id).run();
    } else {
      await env.DB.prepare('INSERT OR IGNORE INTO telegram_channel_members (username, user_id, joined_at) VALUES (?, ?, ?)')
        .bind(username, user.id, new Date().toISOString()).run();
    }

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM telegram_channel_members WHERE username = ?')
      .bind(username).first();

    return json({ ok: true, joined: !exists, members: (count && count.n) || 0 });
  } catch (err) {
    return json({ ok: true, error: err.message });
  }
}
