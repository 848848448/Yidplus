/**
 * POST /api/telegram/webhook
 * Receives Telegram updates and mirrors messages to YID PLUS rooms.
 */
import { json, corsHeaders } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    // Verify secret
    const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (env.TELEGRAM_WEBHOOK_SECRET && secret !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }

    const update = await request.json();
    const msg = update.message || update.channel_post;
    if (!msg) return json({ ok: true });

    const telegramChatId = String(msg.chat.id);

    // Look up bridge
    const bridge = await env.DB.prepare(
      'SELECT room_id, bot_user_id FROM telegram_bridges WHERE telegram_chat_id = ? AND active = 1'
    ).bind(telegramChatId).first().catch(() => null);
    if (!bridge) return json({ ok: true });

    const senderName = msg.from
      ? ((msg.from.first_name || '') + (msg.from.last_name ? ' ' + msg.from.last_name : '')).trim()
      : (msg.chat.title || 'Telegram');
    const displayNick = msg.from?.username ? '@' + msg.from.username : senderName;

    let msgType = 'text';
    let msgText = msg.text || msg.caption || '';
    let mediaKey = null;

    // Handle media
    const fileTarget = msg.photo
      ? msg.photo[msg.photo.length - 1]
      : (msg.video || msg.audio || msg.voice || msg.document || null);

    const MAX_FILE_BYTES = 250 * 1024 * 1024; // 250 MB

    if (fileTarget && (env.TG_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN)) {
      // Check file size before downloading
      const fileSize = fileTarget.file_size || 0;
      if (fileSize > MAX_FILE_BYTES) {
        msgText = msgText || '[File too large to mirror — max 250MB]';
        msgType = 'text';
      } else
      try {
        const fileRes = await fetch(
          `https://api.telegram.org/bot${(env.TG_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN)}/getFile?file_id=${fileTarget.file_id}`
        ).then(r => r.json());

        if (fileRes.ok) {
          const fileUrl = `https://api.telegram.org/file/bot${(env.TG_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN)}/${fileRes.result.file_path}`;
          const ext     = fileRes.result.file_path.split('.').pop() || 'bin';
          const key     = `chat/${bridge.room_id}/${Date.now()}_tg.${ext}`;
          const fileResp = await fetch(fileUrl);
          if (fileResp.ok && env.MY_BUCKET) {
            await env.MY_BUCKET.put(key, fileResp.body, {
              httpMetadata: { contentType: fileResp.headers.get('content-type') || 'application/octet-stream' },
            });
            mediaKey = key;
            if (msg.voice) msgType = 'voice';
            else if (msg.audio) msgType = 'file';
            else msgType = 'media';
          }
        }
      } catch (e) {
        msgText = msgText || '[Media from Telegram]';
      }
    }

    if (msg.sticker) { msgText = msg.sticker.emoji || '🎭'; }
    if (!msgText && !mediaKey) return json({ ok: true });

    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO messages (id, room_id, sender_id, sender_nick, type, text, media_key, created_at, read)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).bind(
      crypto.randomUUID(), bridge.room_id, bridge.bot_user_id,
      '[TG] ' + displayNick, msgType, msgText || null, mediaKey || null, now
    ).run();

    return json({ ok: true });
  } catch (err) {
    return json({ ok: true }); // Always 200 to Telegram
  }
  }

