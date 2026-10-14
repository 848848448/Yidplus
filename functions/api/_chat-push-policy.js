// Shared recipient policy for immediate and scheduled notifications.
export function messageCanNotify(message, now = Date.now()) {
  if (!message || message.hidden || message.view_once) return false;
  if (message.scheduled_for && (!Number.isFinite(Date.parse(message.scheduled_for)) || Date.parse(message.scheduled_for) > now)) return false;
  if (message.expires_at && (!Number.isFinite(Date.parse(message.expires_at)) || Date.parse(message.expires_at) <= now)) return false;
  return true;
}
export async function eligibleChatRecipients(env, message, onlyUserId = null) {
  if (!messageCanNotify(message)) return [];
  const room = await env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(message.room_id).first();
  if (!room || !['private','group'].includes(room.type)) return [];
  if (await env.DB.prepare('SELECT 1 FROM disabled_rooms WHERE room_id = ?').bind(message.room_id).first()) return [];
  const sender = await env.DB.prepare('SELECT id, blocked FROM users WHERE id = ?').bind(message.sender_id).first();
  if (!sender || sender.blocked) return [];
  const senderMember = await env.DB.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').bind(message.room_id, message.sender_id).first();
  if (!senderMember) return [];
  const members = await env.DB.prepare('SELECT u.*, rm.* FROM room_members rm JOIN users u ON u.id = rm.user_id WHERE rm.room_id = ?' + (onlyUserId ? ' AND rm.user_id = ?' : '')).bind(message.room_id, ...(onlyUserId ? [onlyUserId] : [])).all();
  const rows = members.results || [];
  const blocks = await env.DB.prepare('SELECT blocker_id, blocked_id FROM user_blocks WHERE blocker_id = ? OR blocked_id = ?').bind(message.sender_id, message.sender_id).all();
  return rows.filter(m => m.user_id !== message.sender_id && !m.muted && !m.blocked && m.notif_messages!==0 && m.notif_messages!==false && m.notif_messages!=='0' &&
    (!m.muted_until || (Number.isFinite(Date.parse(m.muted_until)) && Date.parse(m.muted_until) <= Date.now())) &&
    !(blocks.results || []).some(b => b.blocker_id === m.user_id || b.blocked_id === m.user_id)).map(m => m.user_id);
}
export function chatPushPayload(message, room) {
  const text = message.type === 'text' ? String(message.text || '').slice(0, 100) : '[' + message.type + ']';
  return { title: room.type === 'group' ? room.name || 'Group' : message.sender_nick || 'New message',
    body: room.type === 'group' ? (message.sender_nick || 'Someone') + ': ' + text : text,
    icon: '/images/logo.png', badge: '/images/logo.png', url: '/chat', tag: 'yidplus-msg-' + message.room_id };
}
