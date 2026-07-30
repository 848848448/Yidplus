// functions/api/private-bot/webhook.js
//
// A standalone, PRIVATE bot — nothing to do with YID PLUS. Whatever is posted to
// it (video, photo, file, text) is emailed to the configured recipients. It has
// its own bot token (PRIVATE_BOT_TOKEN) and its own webhook secret
// (PRIVATE_BOT_WEBHOOK_SECRET), so it never touches YID PLUS data.
//
// Telegram calls: POST /api/private-bot/webhook

import { json, corsHeaders } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

async function ensure(env) {
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS bot_email_config (id INTEGER PRIMARY KEY CHECK (id = 1), enabled INTEGER DEFAULT 0, recipients TEXT DEFAULT \'[]\')'
  ).run().catch(() => {});
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    // Verify the webhook secret so only Telegram can post here.
    const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (env.PRIVATE_BOT_WEBHOOK_SECRET && secret !== env.PRIVATE_BOT_WEBHOOK_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }

    const update = await request.json().catch(() => ({}));
    const msg = update.message || update.channel_post;
    if (!msg) return json({ ok: true });

    await ensure(env);
    const cfg = await env.DB.prepare('SELECT enabled, recipients FROM bot_email_config WHERE id = 1').first().catch(() => null);
    if (!cfg || !cfg.enabled) return json({ ok: true });
    let recipients = [];
    try { recipients = JSON.parse(cfg.recipients || '[]'); } catch (e) { recipients = []; }
    if (!recipients.length || !env.RESEND_API_KEY) return json({ ok: true });

    context.waitUntil(forwardToEmail(env, msg, recipients).catch(() => {}));
    return json({ ok: true });
  } catch (err) {
    return json({ ok: true }); // always 200 to Telegram
  }
}

// Download any media to R2 (so we can link it) and email the message.
async function forwardToEmail(env, msg, recipients) {
  const token = env.PRIVATE_BOT_TOKEN;
  const from = msg.from
    ? ((msg.from.first_name || '') + (msg.from.last_name ? ' ' + msg.from.last_name : '')).trim() + (msg.from.username ? ' (@' + msg.from.username + ')' : '')
    : (msg.chat.title || 'Telegram');
  const text = msg.text || msg.caption || '';

  let mediaLink = '', mediaLabel = '';
  const fileTarget = msg.photo
    ? msg.photo[msg.photo.length - 1]
    : (msg.video || msg.audio || msg.voice || msg.document || null);
  if (fileTarget && token && env.MY_BUCKET) {
    try {
      const fileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileTarget.file_id}`).then((r) => r.json());
      if (fileRes.ok) {
        const filePath = fileRes.result.file_path;
        const ext = (filePath.split('.').pop() || 'bin').toLowerCase();
        const key = `botmail/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const fileResp = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
        if (fileResp.ok) {
          await env.MY_BUCKET.put(key, fileResp.body, {
            httpMetadata: { contentType: fileResp.headers.get('content-type') || 'application/octet-stream' },
          });
          const origin = env.SITE_URL || 'https://yidplus.com';
          mediaLink = origin.replace(/\/$/, '') + '/api/media/' + key;
          mediaLabel = msg.video ? 'Video' : msg.photo ? 'Photo' : msg.audio ? 'Audio' : msg.voice ? 'Voice note' : 'File';
        }
      }
    } catch (e) { /* media optional */ }
  }

  const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const subject = (mediaLabel || 'Message') + ' from ' + from + (text ? ' — ' + text.slice(0, 60) : '');

  let html = '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">';
  html += '<p style="color:#666;margin:0 0 12px">New from your bot — <strong>' + esc(from) + '</strong></p>';
  if (text) html += '<p style="white-space:pre-wrap;font-size:16px">' + esc(text) + '</p>';
  if (mediaLink) {
    if (mediaLabel === 'Photo') html += '<p><img src="' + mediaLink + '" style="max-width:100%;border-radius:8px"></p>';
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
