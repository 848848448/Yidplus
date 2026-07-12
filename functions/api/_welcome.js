// Best-effort welcome DM for new sign-ups. Reads the configurable welcome
// message from app_settings and, if enabled, opens a private chat from the
// owner account to the new user with that text. Never throws into the caller —
// registration must succeed even if this fails.
export async function sendWelcomeMessage(env, newUserId, newUserNick) {
  try {
    const enabledRow = await env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = 'welcome_enabled'"
    ).first().catch(() => null);
    if (!enabledRow || enabledRow.value !== 'true') return;

    const msgRow = await env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = 'welcome_message'"
    ).first().catch(() => null);
    const text = (msgRow && msgRow.value ? String(msgRow.value) : '').trim();
    if (!text) return;

    // Find the owner account to send from.
    const ownerEmail = (env.OWNER_EMAIL || '').toLowerCase();
    const owner = await env.DB.prepare(
      'SELECT id, nickname FROM users WHERE lower(email) = ? LIMIT 1'
    ).bind(ownerEmail).first().catch(() => null);
    if (!owner || owner.id === newUserId) return;

    const now = new Date().toISOString();
    const roomId = crypto.randomUUID();

    await env.DB.prepare(
      "INSERT INTO rooms (id, type, name, emoji, created_by, created_at) VALUES (?, 'private', '', '👤', ?, ?)"
    ).bind(roomId, owner.id, now).run();

    await env.DB.prepare(
      'INSERT INTO room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)'
    ).bind(roomId, owner.id, now).run().catch(() => {});
    await env.DB.prepare(
      'INSERT INTO room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)'
    ).bind(roomId, newUserId, now).run().catch(() => {});

    await env.DB.prepare(
      'INSERT INTO messages (id, room_id, sender_id, sender_nick, type, text, created_at, read) VALUES (?, ?, ?, ?, ?, ?, ?, 0)'
    ).bind(crypto.randomUUID(), roomId, owner.id, owner.nickname || 'YID PLUS', 'text',
      text.replace(/\{name\}/g, newUserNick || ''), now).run();
  } catch (e) { /* best-effort only */ }
}
