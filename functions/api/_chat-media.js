import { requireUser, isAdminRole, isOwnerOrCoOwner } from './_helpers.js';

export async function authorizeChatMedia(request, env, key) {
  if (!key.startsWith('chat/')) return { allowed: true, private: false };
  const row = await env.DB.prepare('SELECT * FROM messages WHERE media_key = ? LIMIT 1').bind(key).first();
  if (!row) return { allowed: false, status: 404 };
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return { allowed: false, status: 410 };
  const room = await env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(row.room_id).first();
  if (!room) return { allowed: false, status: 404 };
  const user = await requireUser(request, env);
  const pending = row.scheduled_for && new Date(row.scheduled_for).getTime() > Date.now();
  if (pending && (!user || user.id !== row.sender_id)) return { allowed: false, status: 403 };
  const publicRoom = room.type !== 'private' && (room.visibility === 'public' || room.is_public === 1);
  let member = false;
  if (user) member = !!(await env.DB.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').bind(row.room_id, user.id).first());
  const moderation = user && (room.type === 'private' ? isOwnerOrCoOwner(user, env.OWNER_EMAIL) : isAdminRole(user, env.OWNER_EMAIL));
  if (!publicRoom && !member && !moderation) return { allowed: false, status: user ? 403 : 401 };
  if (row.hidden && !moderation) return { allowed: false, status: 404 };
  if (row.view_once) {
    if (!user || !member || user.id === row.sender_id) return { allowed: false, status: 403 };
    const url = new URL(request.url);
    const token = url.searchParams.get('once');
    if (!row.opened || !token) return { allowed: false, status: 403 };
    const grant = await env.DB.prepare('SELECT message_id, user_id, expires_at FROM chat_media_grants WHERE token = ?').bind(token).first().catch(() => null);
    if (!grant || grant.message_id !== row.id || grant.user_id !== user.id || Number(grant.expires_at) <= Date.now()) return { allowed: false, status: 403 };
  }
  return { allowed: true, private: true };
}
