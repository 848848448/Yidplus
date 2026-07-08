// functions/api/support-chats.js
//
// USER-FACING:
//   POST /api/support-chats
//     { screen, question_label, text, contact_email?, contact_nick? }
//     Creates a new ticket + its first message. If the caller is signed in,
//     user_id/nick/email are taken from their session (never trusted from
//     the client); if not (login screen), contact_email/contact_nick are
//     used instead so an admin has a way to identify/reach them.
//   POST /api/support-chats { chat_id, text }   -> the ticket owner replies (if signed in)
//   GET  /api/support-chats?chat_id=X            -> the ticket owner reads their own thread
//
// ADMIN-FACING (any admin can read; claim rules below control who can reply):
//   GET  /api/support-chats?tab=new|mine|all      -> the inbox list
//   GET  /api/support-chats?chat_id=X&admin=1     -> full thread + claim info
//   POST /api/support-chats { chat_id, claim: true }   -> claim an unclaimed ticket
//   POST /api/support-chats { chat_id, text, admin: true } -> admin reply (must be the
//        claimer, or one of the two owners — a regular admin can never reply
//        to a ticket someone else already claimed)
//   POST /api/support-chats { chat_id, close: true }   -> close a ticket (claimer or owner)

import { json, corsHeaders, requireUser, isAdminRole, isOwnerOrCoOwner, checkRateLimit } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

async function canActOnChat(env, user, chat) {
  // Owners can always act on any ticket, claimed or not.
  if (isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return true;
  // A regular admin can act only if the ticket is unclaimed, or claimed by them.
  return !chat.claimed_by || chat.claimed_by === user.id;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const url = new URL(request.url);
    const chatId = url.searchParams.get('chat_id');
    const asAdmin = url.searchParams.get('admin');
    const tab = url.searchParams.get('tab');

    const user = await requireUser(request, env).catch(() => null);

    if (chatId) {
      const chat = await env.DB.prepare('SELECT * FROM support_chats WHERE id = ?').bind(chatId).first();
      if (!chat) return json({ ok: false, error: 'Not found' }, 404);

      if (asAdmin) {
        if (!user || !isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
      } else {
        // The ticket's own owner (if it was created while signed in) can read it too.
        if (!user || chat.user_id !== user.id) return json({ ok: false, error: 'Forbidden' }, 403);
      }

      const { results: messages } = await env.DB.prepare(
        'SELECT id, sender_type, sender_id, sender_nick, text, created_at FROM support_messages WHERE chat_id = ? ORDER BY created_at ASC'
      ).bind(chatId).all();

      return json({ ok: true, chat, messages });
    }

    // Inbox listing — admin only.
    if (!user || !isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    let query = 'SELECT * FROM support_chats';
    let params = [];
    if (tab === 'new') {
      query += " WHERE status != 'closed' AND claimed_by IS NULL";
    } else if (tab === 'mine') {
      query += ' WHERE claimed_by = ?';
      params.push(user.id);
    } // 'all' or missing -> no filter

    query += ' ORDER BY created_at DESC LIMIT 200';
    const { results } = await env.DB.prepare(query).bind(...params).all().catch(() => ({ results: [] }));
    return json({ ok: true, chats: results });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const user = await requireUser(request, env).catch(() => null);
    const now = new Date().toISOString();

    // ── Claim a ticket ──
    if (body.chat_id && body.claim) {
      if (!user || !isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
      const chat = await env.DB.prepare('SELECT * FROM support_chats WHERE id = ?').bind(body.chat_id).first();
      if (!chat) return json({ ok: false, error: 'Not found' }, 404);
      if (chat.claimed_by && chat.claimed_by !== user.id && !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) {
        return json({ ok: false, error: 'Someone else is already helping this person' }, 409);
      }
      await env.DB.prepare("UPDATE support_chats SET claimed_by = ?, claimed_by_nick = ?, status = 'claimed', updated_at = ? WHERE id = ?")
        .bind(user.id, user.nickname || '', now, body.chat_id).run();
      return json({ ok: true });
    }

    // ── Close a ticket ──
    if (body.chat_id && body.close) {
      if (!user || !isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
      const chat = await env.DB.prepare('SELECT * FROM support_chats WHERE id = ?').bind(body.chat_id).first();
      if (!chat) return json({ ok: false, error: 'Not found' }, 404);
      if (!(await canActOnChat(env, user, chat))) return json({ ok: false, error: 'Someone else is already helping this person' }, 409);
      await env.DB.prepare("UPDATE support_chats SET status = 'closed', updated_at = ? WHERE id = ?").bind(now, body.chat_id).run();
      return json({ ok: true });
    }

    // ── Reply to an existing ticket ──
    if (body.chat_id && body.text) {
      const chat = await env.DB.prepare('SELECT * FROM support_chats WHERE id = ?').bind(body.chat_id).first();
      if (!chat) return json({ ok: false, error: 'Not found' }, 404);

      let senderType, senderId, senderNick;
      if (body.admin) {
        if (!user || !isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
        if (!(await canActOnChat(env, user, chat))) return json({ ok: false, error: 'Someone else is already helping this person' }, 409);
        // Replying auto-claims an unclaimed ticket.
        if (!chat.claimed_by) {
          await env.DB.prepare("UPDATE support_chats SET claimed_by = ?, claimed_by_nick = ?, status = 'claimed' WHERE id = ?")
            .bind(user.id, user.nickname || '', body.chat_id).run();
        }
        senderType = 'admin'; senderId = user.id; senderNick = user.nickname || '';
      } else {
        if (!user || chat.user_id !== user.id) return json({ ok: false, error: 'Forbidden' }, 403);
        senderType = 'user'; senderId = user.id; senderNick = user.nickname || '';
      }

      const msgId = crypto.randomUUID();
      await env.DB.prepare(
        'INSERT INTO support_messages (id, chat_id, sender_type, sender_id, sender_nick, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(msgId, body.chat_id, senderType, senderId, senderNick, String(body.text).trim(), now).run();
      await env.DB.prepare('UPDATE support_chats SET updated_at = ? WHERE id = ?').bind(now, body.chat_id).run();

      return json({ ok: true, id: msgId }, 201);
    }

    // ── Create a new ticket ──
    const allowed = await checkRateLimit(env, request, 'support_ticket', 10, 60);
    if (!allowed) return json({ ok: false, error: 'Too many messages. Please wait a bit before sending another.' }, 429);

    const screen = body.screen;
    const questionLabel = (body.question_label || '').trim();
    const text = (body.text || '').trim();
    if (!screen || !questionLabel || !text) {
      return json({ ok: false, error: 'screen, question_label and text are required' }, 400);
    }

    const chatId = crypto.randomUUID();
    const userId = user ? user.id : null;
    const userNick = user ? (user.nickname || '') : (body.contact_nick || '').trim();
    const userEmail = user ? (user.email || '') : (body.contact_email || '').trim().toLowerCase();

    await env.DB.prepare(
      `INSERT INTO support_chats (id, user_id, user_nick, user_email, screen, question_label, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?)`
    ).bind(chatId, userId, userNick, userEmail, screen, questionLabel, now, now).run();

    const msgId = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO support_messages (id, chat_id, sender_type, sender_id, sender_nick, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(msgId, chatId, 'user', userId, userNick, text, now).run();

    return json({ ok: true, chat_id: chatId }, 201);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
