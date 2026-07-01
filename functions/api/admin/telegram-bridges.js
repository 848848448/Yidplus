/**
 * GET  /api/admin/telegram-bridges         -> list all bridges
 * POST /api/admin/telegram-bridges         -> add a bridge { telegram_chat_id, room_id, label }
 * DELETE /api/admin/telegram-bridges?id=X  -> remove a bridge
 */
import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

async function checkOwner(request, env) {
  const user = await requireUser(request, env);
  if (!user) return null;
  if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return null;
  return user;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const user = await checkOwner(request, env);
  if (!user) return json({ ok: false, error: 'Forbidden' }, 403);

  const { results } = await env.DB.prepare(
    `SELECT b.id, b.telegram_chat_id, b.room_id, b.label, b.active, b.created_at,
            r.name as room_name, r.type as room_type
     FROM telegram_bridges b
     LEFT JOIN rooms r ON r.id = b.room_id
     ORDER BY b.created_at DESC`
  ).all().catch(() => ({ results: [] }));

  return json({ ok: true, bridges: results });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const user = await checkOwner(request, env);
  if (!user) return json({ ok: false, error: 'Forbidden' }, 403);

  const body = await request.json();
  const { telegram_chat_id, room_id, label } = body;

  if (!telegram_chat_id || !room_id) {
    return json({ ok: false, error: 'telegram_chat_id and room_id are required' }, 400);
  }

  // Get or create a bot user for Telegram
  let botUser = await env.DB.prepare(
    "SELECT id FROM users WHERE email = 'telegram-bot@yidplus.com' LIMIT 1"
  ).first().catch(() => null);

  if (!botUser) {
    const botId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, nickname, password_hash, role, verified, blocked, created_at)
       VALUES (?, 'telegram-bot@yidplus.com', 'Telegram Bot', 'NO_LOGIN', 'member', 1, 0, ?)`
    ).bind(botId, new Date().toISOString()).run();
    botUser = { id: botId };
  }

  // Make sure bot is a member of the room
  await env.DB.prepare(
    'INSERT OR IGNORE INTO room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)'
  ).bind(room_id, botUser.id, new Date().toISOString()).run().catch(() => {});

  // Insert or update bridge
  await env.DB.prepare(
    `INSERT INTO telegram_bridges (id, telegram_chat_id, room_id, bot_user_id, label, active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(telegram_chat_id) DO UPDATE SET room_id=excluded.room_id, label=excluded.label, active=1`
  ).bind(crypto.randomUUID(), String(telegram_chat_id), room_id, botUser.id, label || telegram_chat_id, new Date().toISOString()).run();

  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const user = await checkOwner(request, env);
  if (!user) return json({ ok: false, error: 'Forbidden' }, 403);

  const url = new URL(request.url);
  const id  = url.searchParams.get('id');
  const chatId = url.searchParams.get('chat_id');

  if (id) {
    await env.DB.prepare('DELETE FROM telegram_bridges WHERE id = ?').bind(id).run();
  } else if (chatId) {
    await env.DB.prepare('UPDATE telegram_bridges SET active = 0 WHERE telegram_chat_id = ?').bind(chatId).run();
  }

  return json({ ok: true });
    }
