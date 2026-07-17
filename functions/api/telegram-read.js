import { json, corsHeaders, requireUser } from './_helpers.js';

// Ran on every request, before doing any actual work. A Worker isolate is
// reused, so once is enough.
let _schemaReady = null;

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

// POST { username } → mark a Telegram channel read up to now.
//
// Mirrors how group chats work (room_members.last_read_at): the unread count is
// simply the posts newer than this stamp. Kept in its own table rather than on
// telegram_channel_members, so reading a channel doesn't imply joining it and
// joining doesn't wipe the read state.
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: true, error: 'Not signed in' });

    if (!_schemaReady) {
      _schemaReady = env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS telegram_channel_reads (username TEXT NOT NULL, user_id TEXT NOT NULL, last_read_at TEXT, PRIMARY KEY (username, user_id))'
      ).run().catch(() => {});
    }
    await _schemaReady;

    const body = await request.json().catch(() => ({}));
    const username = String(body.username || '').replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '');
    if (!username) return json({ ok: true, error: 'username required' });

    const now = new Date().toISOString();
    await env.DB.prepare(
      'INSERT INTO telegram_channel_reads (username, user_id, last_read_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(username, user_id) DO UPDATE SET last_read_at = excluded.last_read_at'
    ).bind(username, user.id, now).run();

    return json({ ok: true, last_read_at: now });
  } catch (err) {
    return json({ ok: true, error: err.message });
  }
}
