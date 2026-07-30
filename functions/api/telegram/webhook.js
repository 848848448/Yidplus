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

    // ── Email forwarding ─────────────────────────────────────────────
    // If turned on, mail whatever gets posted to the bot to the configured
    // recipients. Runs independently of the room bridge below.
    try {
      const cfg = await env.DB.prepare('SELECT enabled, recipients FROM bot_email_config WHERE id = 1').first().catch(() => null);
      if (cfg && cfg.enabled && env.RESEND_API_KEY) {
        let recipients = [];
        try { recipients = JSON.parse(cfg.recipients || '[]'); } catch (e) { recipients = []; }
        if (recipients.length) {
          context.waitUntil(forwardToEmail(env, msg, recipients).catch(() => {}));
        }
      }
    } catch (e) { /* never let this break the bridge path */ }

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

    if (fileTarget && env.TELEGRAM_BOT_TOKEN) {
      // Check file size before downloading
      const fileSize = fileTarget.file_size || 0;
      if (fileSize > MAX_FILE_BYTES) {
        msgText = msgText || '[File too large to mirror — max 250MB]';
        msgType = 'text';
      } else
      try {
        const fileRes = await fetch(
          `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileTarget.file_id}`
        ).then(r => r.json());

        if (fileRes.ok) {
          const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${fileRes.result.file_path}`;
          const ext     = fileRes.result.file_path.split('.').pop() || 'bin';
          const key     = `chat/${bridge.room_id}/${Date.now()}_tg.${ext}`;
          const fileResp = await fetch(fileUrl);
          if (fileResp.ok && env.MY_BUCKET) {
            await env.MY_BUCKET.put(key, fileResp.body, {
              httpMetadata: { contentType: fileResp.headers.get('content-type') || 'application/octet-stream' },
            });
            mediaKey = key;
            msgType  = msg.voice ? 'voice' : 'media';
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

// Download any media to R2 (so we can link it) and email the message to the
// configured recipients via Resend.
async function forwardToEmail(env, msg, recipients) {
  const from = msg.from
    ? ((msg.from.first_name || '') + (msg.from.last_name ? ' ' + msg.from.last_name : '')).trim() + (msg.from.username ? ' (@' + msg.from.username + ')' : '')
    : (msg.chat.title || 'Telegram');
  const text = msg.text || msg.caption || '';

  // Media → store in R2 and build a public link (email can't carry big videos).
  let mediaLink = '', mediaLabel = '';
  const fileTarget = msg.photo
    ? msg.photo[msg.photo.length - 1]
    : (msg.video || msg.audio || msg.voice || msg.document || null);
  if (fileTarget && env.TELEGRAM_BOT_TOKEN && env.MY_BUCKET) {
    try {
      const fileRes = await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileTarget.file_id}`
      ).then((r) => r.json());
      if (fileRes.ok) {
        const filePath = fileRes.result.file_path;
        const ext = (filePath.split('.').pop() || 'bin').toLowerCase();
        const key = `botmail/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const fileResp = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`);
        if (fileResp.ok) {
          await env.MY_BUCKET.put(key, fileResp.body, {
            httpMetadata: { contentType: fileResp.headers.get('content-type') || 'application/octet-stream' },
          });
          const origin = env.SITE_URL || 'https://yidplus.com';
          mediaLink = origin.replace(/\/$/, '') + '/api/media/' + key;
          mediaLabel = msg.video ? 'Video' : msg.photo ? 'Photo' : msg.audio ? 'Audio' : msg.voice ? 'Voice note' : 'File';
        }
      }
    } catch (e) { /* media optional — still send the text */ }
  }

  const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const subject = mediaLabel
    ? mediaLabel + ' from ' + from + (text ? ' — ' + text.slice(0, 60) : '')
    : ('Message from ' + from + (text ? ' — ' + text.slice(0, 60) : ''));

  let html = '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">';
  html += '<p style="color:#666;margin:0 0 12px">New from your Telegram bot — <strong>' + esc(from) + '</strong></p>';
  if (text) html += '<p style="white-space:pre-wrap;font-size:16px">' + esc(text) + '</p>';
  if (mediaLink) {
    if (mediaLabel === 'Photo') {
      html += '<p><img src="' + mediaLink + '" style="max-width:100%;border-radius:8px"></p>';
    }
    html += '<p><a href="' + mediaLink + '" style="display:inline-block;background:#1F6F5C;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open / download the ' + esc(mediaLabel.toLowerCase()) + '</a></p>';
  }
  if (!text && !mediaLink) html += '<p style="color:#999">(empty message)</p>';
  html += '</div>';

  const fromAddr = env.RESEND_FROM_EMAIL || 'YID PLUS <onboarding@resend.dev>';
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromAddr, to: recipients, subject, html }),
  }).catch(() => {});
}
