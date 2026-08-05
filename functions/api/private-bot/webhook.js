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
    const _resendKey = await getConfig(env, 'RESEND_API_KEY');
    if (!recipients.length || !_resendKey) return json({ ok: true });

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

  let mediaLink = '', mediaLabel = '', mediaNote = '', posterLink = '';
  const attachments = [];
  const fileTarget = msg.photo
    ? msg.photo[msg.photo.length - 1]
    : (msg.video || msg.animation || msg.video_note || msg.audio || msg.voice || msg.document || null);
  if (fileTarget && token) {
    mediaLabel = (msg.video || msg.animation || msg.video_note) ? 'Video' : msg.photo ? 'Photo' : msg.audio ? 'Audio' : msg.voice ? 'Voice note' : (msg.document && msg.document.file_name) ? msg.document.file_name : 'File';
    // Pull the video's thumbnail (Telegram ships one with every video) and store
    // it, so the email can show the actual video frame as an image — visible in
    // every mail app (even Gmail) with no link or download needed to SEE it.
    const _thumbId = ((fileTarget.thumbnail || fileTarget.thumb || {}) || {}).file_id;
    if (_thumbId && env.MY_BUCKET) {
      try {
        const tf = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${_thumbId}`).then((r) => r.json());
        if (tf.ok) {
          const tr = await fetch(`https://api.telegram.org/file/bot${token}/${tf.result.file_path}`);
          if (tr.ok) {
            const tb = new Uint8Array(await tr.arrayBuffer());
            const tkey = `botmail/poster_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
            await env.MY_BUCKET.put(tkey, tb, { httpMetadata: { contentType: 'image/jpeg' } });
            posterLink = (env.SITE_URL || 'https://yidplus.com').replace(/\/$/, '') + '/api/media/' + tkey;
          }
        }
      } catch (e) { /* poster is optional */ }
    }
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

            // Only shrink videos that are too big to attach (>10MB). Small
            // videos are attached as-is — no need to touch the converter, which
            // (on a cold free-tier host) could otherwise stall the whole email.
            const isVideo = !!(msg.video || msg.animation || msg.video_note) || /video\//i.test(ctype) || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(niceName);
            const _convUrl = await getConfig(env, 'VIDEO_CONVERTER_URL');
            const _convSecret = await getConfig(env, 'VIDEO_CONVERTER_SECRET');
            if (_convUrl && isVideo && bytes.length > ATTACH_LIMIT) {
              try {
                // Cap the wait so a slow/cold converter can't blow the request
                // budget — if it doesn't answer in time, send the link instead.
                const ac = new AbortController();
                const timer = setTimeout(() => ac.abort(), 12000);
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
            // Attach smaller media (incl. video) so it lands in the inbox and
            // can be opened/downloaded straight from the email.
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

  const isVideoLabel = mediaLabel === 'Video';
  const isAudioLabel = mediaLabel === 'Audio' || mediaLabel === 'Voice note';
  const attached = attachments.length > 0;

  let html = '<div style="background:#eceef1;padding:18px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif">';
  html += '<div style="max-width:540px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.08)">';
  // Header
  html += '<div style="background:linear-gradient(135deg,#2E9E82,#1F6F5C);color:#fff;padding:16px 20px">' +
            '<div style="font-weight:800;font-size:16px">📩 New message</div>' +
            '<div style="opacity:.92;font-size:13px;margin-top:3px">from <strong>' + esc(from) + '</strong></div>' +
          '</div>';
  html += '<div style="padding:18px 20px">';
  // Text / caption
  if (text) html += '<div style="white-space:pre-wrap;font-size:16px;line-height:1.55;color:#111;margin:0 0 14px">' + esc(text) + '</div>';
  // Media
  if (mediaLabel) {
    if (mediaLabel === 'Photo' && mediaLink) {
      html += '<a href="' + mediaLink + '" target="_blank"><img src="' + mediaLink + '" style="max-width:100%;border-radius:12px;display:block"></a>';
    } else if (isVideoLabel && mediaLink) {
      // Gmail strips <video> (it renders as a broken grey box), so instead show
      // the video's real frame as a plain image — visible with no click and no
      // download — then offer both Watch (streams in browser) and Download.
      if (posterLink) {
        html += '<a href="' + mediaLink + '" target="_blank" style="text-decoration:none;display:block;position:relative">' +
          '<img src="' + posterLink + '" width="100%" style="max-width:100%;width:100%;border-radius:12px;display:block;background:#000">' +
          '<span style="position:absolute;top:50%;left:50%;margin:-33px 0 0 -33px;width:66px;height:66px;border-radius:50%;background:rgba(0,0,0,.55);display:block"></span>' +
          '<span style="position:absolute;top:50%;left:50%;margin:-14px 0 0 -8px;width:0;height:0;border-left:24px solid #fff;border-top:14px solid transparent;border-bottom:14px solid transparent;display:block"></span>' +
        '</a>';
      } else {
        html += '<div style="background:#111;border-radius:12px;height:150px;text-align:center;color:#fff;line-height:150px;font-size:15px;font-weight:700">🎬 Video</div>';
      }
      html += '<div style="margin-top:12px">' +
        '<a href="' + mediaLink + '" target="_blank" style="display:inline-block;background:#1F6F5C;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;margin-right:8px">▶ Watch video</a>' +
        '<a href="' + mediaLink + '?dl=1" target="_blank" style="display:inline-block;background:#eef1f3;color:#1F6F5C;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">⬇ Download</a>' +
      '</div>';
    } else if (isAudioLabel && mediaLink) {
      html += '<a href="' + mediaLink + '" target="_blank" style="display:inline-block;background:#1F6F5C;color:#fff;padding:13px 22px;border-radius:11px;text-decoration:none;font-weight:700;font-size:15px">🎵 Play ' + esc(mediaLabel.toLowerCase()) + '</a>';
    } else if (mediaLink) {
      html += '<a href="' + mediaLink + '" target="_blank" style="display:inline-block;background:#1F6F5C;color:#fff;padding:13px 22px;border-radius:11px;text-decoration:none;font-weight:700;font-size:15px">📄 Open ' + esc(mediaLabel) + '</a>';
    }
    if (attached) html += '<div style="color:#8a8f98;font-size:12px;margin-top:12px">📎 Also attached to this email — open it right from your inbox.</div>';
    if (mediaNote) html += '<div style="color:#B45309;font-size:12.5px;margin-top:10px;background:#FEF3E2;padding:8px 12px;border-radius:8px">⚠️ ' + esc(mediaNote) + '</div>';
  }
  if (!text && !mediaLabel) html += '<div style="color:#999">(empty message)</div>';
  html += '</div>'; // padding
  html += '<div style="padding:12px 20px;border-top:1px solid #eef0f2;color:#9aa0a8;font-size:11px">Forwarded to you by YID PLUS</div>';
  html += '</div></div>';

  const fromAddr = (await getConfig(env, 'RESEND_FROM_EMAIL')) || 'YID PLUS <onboarding@resend.dev>';
  const _rk = await getConfig(env, 'RESEND_API_KEY');
  const payload = { from: fromAddr, to: recipients, subject, html };
  if (attachments.length) payload.attachments = attachments;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${_rk}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    // If the attachment made it too big for Resend, retry once with just the link.
    if (!r.ok && attachments.length) {
      const lite = { from: fromAddr, to: recipients, subject, html };
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${_rk}`, 'Content-Type': 'application/json' },
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
