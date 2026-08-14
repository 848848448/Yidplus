import { json, corsHeaders, requireUser, isAdminRole, isOwnerOrCoOwner } from '../_helpers.js';
export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

// Bookmarking a message_id you're not actually allowed to see would let it
// resurface (with full text/media) in your own bookmarks list forever —
// this is the same room-access rule chat.js applies when reading messages.
async function canAccessMessage(env, messageId, userId) {
  const room = await env.DB.prepare(
    `SELECT r.id, r.type, r.visibility FROM messages m JOIN rooms r ON r.id = m.room_id WHERE m.id = ?`
  ).bind(messageId).first().catch(() => null);
  if (!room) return false;
  const isMember = await env.DB.prepare(
    'SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?'
  ).bind(room.id, userId).first().catch(() => null);
  if (isMember) return true;
  const user = await env.DB.prepare('SELECT id, email, role FROM users WHERE id = ?').bind(userId).first().catch(() => null);
  if (room.type === 'private') return isOwnerOrCoOwner(user, env.OWNER_EMAIL);
  if (room.type === 'group' && room.visibility === 'private') return isAdminRole(user, env.OWNER_EMAIL);
  return true; // public group/channel
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const { results } = await env.DB.prepare(
      `SELECT b.*, m.text, m.type, m.sender_nick, m.created_at as msg_time, m.media_url
       FROM message_bookmarks b JOIN messages m ON m.id = b.message_id
       WHERE b.user_id = ? ORDER BY b.created_at DESC LIMIT 100`
    ).bind(user.id).all();
    return json({ ok: true, bookmarks: results });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const { message_id, room_id } = await request.json();
    if (!message_id) return json({ ok: false, error: 'message_id is required' }, 400);
    if (!(await canAccessMessage(env, message_id, user.id))) return json({ ok: false, error: 'Forbidden' }, 403);
    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT OR REPLACE INTO message_bookmarks (id, user_id, message_id, room_id, created_at) VALUES (?,?,?,?,?)'
    ).bind(id, user.id, message_id, room_id, new Date().toISOString()).run();
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const msgId = new URL(request.url).searchParams.get('message_id');
    await env.DB.prepare('DELETE FROM message_bookmarks WHERE user_id=? AND message_id=?').bind(user.id, msgId).run();
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
  }
