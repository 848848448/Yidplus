// functions/api/private-bot/webhook.js
//
// A standalone, PRIVATE bot — nothing to do with YID PLUS. Whatever is posted to
// it (video, photo, file, text) is emailed to the configured recipients. It has
// its own bot token (PRIVATE_BOT_TOKEN) and its own webhook secret
// (PRIVATE_BOT_WEBHOOK_SECRET), so it never touches YID PLUS data.
//
// Telegram calls: POST /api/private-bot/webhook

import { json, corsHeaders, getPrivateBotCreds, getConfig } from '../_helpers.js';

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
    const { token: _pbToken, secret: _pbSecret } = await getPrivateBotCreds(env);
    const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (_pbSecret && secret !== _pbSecret) {
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
  const token = (await getPrivateBotCreds(env)).token;
  const from = msg.from
    ? ((msg.from.first_name || '') + (msg.from.last_name ? ' ' + msg.from.last_name : '')).trim() + (msg.from.username ? ' (@' + msg.from.username + ')' : '')
    : (msg.chat.title || 'Telegram');
  const text = msg.text || msg.caption || '';

  let mediaLink = '', mediaLabel = '', mediaNote = '';
  const attachments = [];
  const fileTarget = msg.photo
    ? msg.photo[msg.photo.length - 1]
    : (msg.video || msg.audio || msg.voice || msg.document || null);
  if (fileTarget && token) {
    mediaLabel = msg.video ? 'Video' : msg.photo ? 'Photo' : msg.audio ? 'Audio' : msg.voice ? 'Voice note' : (msg.document && msg.document.file_name) ? msg.document.file_name : 'File';
    const declaredSize = Number(fileTarget.file_size || 0);
    const BOT_DL_LIMIT = 20 * 1024 * 1024;   // Telegram Bot API can't download bigger than this
    const ATTACH_LIMIT = 10 * 1024 * 1024;   // only base64-attach up to here (keeps CPU sane)
    try {
      if (declaredSize && declaredSize > BOT_DL_LIMIT) {
        // A bot literally cannot fetch files over 20MB — say so instead of silently dropping it.
        mediaNote = mediaLabel + ' is ' + (declaredSize / 1048576).toFixed(1) + ' MB — too large for a Telegram bot to forward (bots can only download up to 20 MB).';
      } else {
        const fileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileTarget.file_id}`).then((r) => r.json());
        if (!fileRes.ok) {
          mediaNote = 'Could not fetch the ' + mediaLabel.toLowerCase() + ' from Telegram' + (fileRes.description ? ' (' + fileRes.description + ')' : '') + '.';
        } else {
          const filePath = fileRes.result.file_path;
          const ext = (filePath.split('.').pop() || 'bin').toLowerCase();
          const size = Number(fileRes.result.file_size || declaredSize || 0);
          const niceName = (msg.document && msg.document.file_name) ? msg.document.file_name : (mediaLabel.replace(/\s+/g, '_').toLowerCase() + '.' + ext);
          const fileResp = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
          if (fileResp.ok) {
            let ctype = fileResp.headers.get('content-type') || 'application/octet-stream';
            const buf = await fileResp.arrayBuffer();
            let bytes = new Uint8Array(buf);

            // If a converter is configured, shrink videos toward 8MB so they
            // arrive as a clean attachment instead of a link.
            const isVideo = !!msg.video || /video\//i.test(ctype) || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(niceName);
            const _convUrl = await getConfig(env, 'VIDEO_CONVERTER_URL');
            const _convSecret = await getConfig(env, 'VIDEO_CONVERTER_SECRET');
            if (_convUrl && isVideo && bytes.length > 2 * 1024 * 1024) {
              try {
                // Guard against the converter being cold/slow (Render free tier
                // can take ~50s to wake) — if it doesn't answer in time, we just
                // send the original so the email still goes out.
                const ac = new AbortController();
                const timer = setTimeout(() => ac.abort(), 25000);
                const cr = await fetch(_convUrl.replace(/\/$/, '') + '/convert?target_mb=8', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/octet-stream', 'X-Secret': _convSecret },
                  body: bytes,
                  signal: ac.signal,
                });
                clearTimeout(timer);
                if (cr.ok) {
                  const cbytes = new Uint8Array(await cr.arrayBuffer());
                  if (cbytes.length && cbytes.length < bytes.length) { bytes = cbytes; ctype = 'video/mp4'; }
                }
              } catch (e) { /* converter optional — fall back to original */ }
            }
            // Always keep a copy in R2 for a reliable link.
            if (env.MY_BUCKET) {
              try {
                const key = `botmail/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
                await env.MY_BUCKET.put(key, bytes, { httpMetadata: { contentType: ctype } });
                const origin = env.SITE_URL || 'https://yidplus.com';
                mediaLink = origin.replace(/\/$/, '') + '/api/media/' + key;
              } catch (e) { /* link optional */ }
            }
            // Attach the real file for smaller media so it lands IN the inbox.
            if (bytes.length <= ATTACH_LIMIT) {
              attachments.push({ filename: niceName, content: _b64(bytes), content_type: ctype });
            } else {
              mediaNote = mediaLabel + ' (' + (bytes.length / 1048576).toFixed(1) + ' MB) is linked below rather than attached — it is too large to attach.';
            }
          } else {
            mediaNote = 'Could not download the ' + mediaLabel.toLowerCase() + ' from Telegram.';
          }
        }
      }
    } catch (e) { mediaNote = 'The ' + mediaLabel.toLowerCase() + " couldn't be forwarded (" + (e && e.message ? e.message : 'error') + ').'; }
  }

  const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const subject = (mediaLabel || 'Message') + ' from ' + from + (text ? ' — ' + text.slice(0, 60) : '');

  let html = '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">';
  html += '<p style="color:#666;margin:0 0 12px">New from your bot — <strong>' + esc(from) + '</strong></p>';
  if (text) html += '<p style="white-space:pre-wrap;font-size:16px">' + esc(text) + '</p>';
  if (mediaLabel) {
    const attached = attachments.length > 0;
    if (mediaLabel === 'Photo' && mediaLink) html += '<p><img src="' + mediaLink + '" style="max-width:100%;border-radius:8px"></p>';
    if (attached) html += '<p style="color:#666;font-size:13px">📎 ' + esc(mediaLabel) + ' attached to this email.</p>';
    if (mediaNote) html += '<p style="color:#B45309;font-size:13px">⚠️ ' + esc(mediaNote) + '</p>';
    if (mediaLink) html += '<p><a href="' + mediaLink + '" style="display:inline-block;background:#1F6F5C;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open / download</a></p>';
  }
  if (!text && !mediaLabel) html += '<p style="color:#999">(empty message)</p>';
  html += '</div>';

  const fromAddr = env.RESEND_FROM_EMAIL || 'YID PLUS <onboarding@resend.dev>';
  const payload = { from: fromAddr, to: recipients, subject, html };
  if (attachments.length) payload.attachments = attachments;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    // If the attachment made it too big for Resend, retry once with just the link.
    if (!r.ok && attachments.length) {
      const lite = { from: fromAddr, to: recipients, subject, html };
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(lite),
      }).catch(() => {});
    }
  } catch (e) { /* best effort */ }
}

// Base64-encode bytes in chunks (avoids call-stack limits on big files).
function _b64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
