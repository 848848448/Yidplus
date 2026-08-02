// functions/api/telegram/post-bot.js
// Second Telegram bot: a personal PUBLISHING bot. A person links their YID PLUS
// account once (email + emailed code), then sends the bot a photo/video/text and
// picks — via inline buttons — where to post it. Everything is published UNDER
// THEIR OWN account. Uses its own token: TELEGRAM_POST_BOT_TOKEN.
import { json } from '../_helpers.js';

const API = (env) => `https://api.telegram.org/bot${env.TELEGRAM_POST_BOT_TOKEN}`;

async function tg(env, method, params) {
  return fetch(`${API(env)}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).then(r => r.json()).catch(() => null);
}
const say = (env, chatId, text, extra) => tg(env, 'sendMessage', { chat_id: chatId, text, ...(extra || {}) });

async function ensureTables(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS telegram_links (telegram_user_id TEXT PRIMARY KEY, user_id TEXT, linked_at TEXT)').run().catch(() => {});
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS telegram_bot_state (telegram_user_id TEXT PRIMARY KEY, step TEXT, data TEXT, updated_at TEXT)').run().catch(() => {});
}
async function getState(env, tgId) {
  const r = await env.DB.prepare('SELECT step, data FROM telegram_bot_state WHERE telegram_user_id = ?').bind(tgId).first().catch(() => null);
  if (!r) return { step: null, data: {} };
  let data = {}; try { data = JSON.parse(r.data || '{}'); } catch (e) {}
  return { step: r.step, data };
}
async function setState(env, tgId, step, data) {
  await env.DB.prepare(
    'INSERT INTO telegram_bot_state (telegram_user_id, step, data, updated_at) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT(telegram_user_id) DO UPDATE SET step=excluded.step, data=excluded.data, updated_at=excluded.updated_at'
  ).bind(tgId, step, JSON.stringify(data || {}), new Date().toISOString()).run().catch(() => {});
}
const clearState = (env, tgId) => env.DB.prepare('DELETE FROM telegram_bot_state WHERE telegram_user_id = ?').bind(tgId).run().catch(() => {});

async function sendCodeEmail(env, email, code, nick) {
  if (!env.RESEND_API_KEY) return false;
  const from = env.RESEND_FROM_EMAIL || 'YID PLUS <onboarding@resend.dev>';
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:16px">
      <h2 style="color:#14503F">Link your Telegram</h2>
      <p style="font-size:15px;color:#222">Hi ${nick || ''}, your code to connect the YID PLUS posting bot is:</p>
      <div style="font-size:30px;font-weight:800;letter-spacing:6px;color:#14503F;margin:14px 0">${code}</div>
      <p style="font-size:13px;color:#888">If you didn't request this, ignore this email.</p></div>`;
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [email], subject: 'Your YID PLUS bot code', html }),
  }).catch(() => null);
  return !!(resp && resp.ok);
}

// Download a Telegram file → R2, return the stored key.
async function storeMedia(env, fileId, prefix, userId, ext) {
  try {
    const info = await fetch(`${API(env)}/getFile?file_id=${fileId}`).then(r => r.json());
    if (!info.ok || !info.result || !info.result.file_path) return null;
    // Telegram's getFile only works up to 20MB via the Bot API. Larger files
    // return no file_path, so we bail cleanly rather than storing an empty key.
    const url = `https://api.telegram.org/file/bot${env.TELEGRAM_POST_BOT_TOKEN}/${info.result.file_path}`;
    const realExt = (info.result.file_path.split('.').pop() || ext || 'bin');
    const key = `${prefix}/${userId}/${Date.now()}.${realExt}`;
    const resp = await fetch(url);
    if (!resp.ok || !env.MY_BUCKET) return null;
    await env.MY_BUCKET.put(key, resp.body, { httpMetadata: { contentType: resp.headers.get('content-type') || 'application/octet-stream' } });
    return key;
  } catch (e) { return null; }
}

function destKeyboard(hasVideo, hasImage) {
  const row = [];
  if (hasImage || hasVideo || true) row.push({ text: '📡 Channel post', callback_data: 'dest:channel' });
  if (hasVideo) row.push({ text: '🎬 Short', callback_data: 'dest:short' });
  const row2 = [{ text: '📿 Status', callback_data: 'dest:status' }, { text: '💬 Group', callback_data: 'dest:group' }];
  return { inline_keyboard: [row, row2, [{ text: '✖ Cancel', callback_data: 'dest:cancel' }]] };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (!env.TELEGRAM_POST_BOT_TOKEN) return json({ ok: true });
    if (env.TELEGRAM_POST_WEBHOOK_SECRET) {
      const s = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (s !== env.TELEGRAM_POST_WEBHOOK_SECRET) return new Response('Unauthorized', { status: 401 });
    }
    await ensureTables(env);
    const update = await request.json();

    // ── Button presses (destination choice) ──
    if (update.callback_query) {
      const cq = update.callback_query;
      const tgId = String(cq.from.id);
      const chatId = cq.message.chat.id;
      await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id });

      const link = await env.DB.prepare('SELECT user_id FROM telegram_links WHERE telegram_user_id = ?').bind(tgId).first().catch(() => null);
      if (!link) { await say(env, chatId, 'Please link your account first — send your email.'); return json({ ok: true }); }
      const user = await env.DB.prepare('SELECT id, nickname, verified FROM users WHERE id = ?').bind(link.user_id).first().catch(() => null);
      if (!user) { await say(env, chatId, 'Account not found.'); return json({ ok: true }); }

      const data = cq.data || '';
      const st = await getState(env, tgId);

      if (data === 'dest:cancel') { await clearState(env, tgId); await say(env, chatId, 'Cancelled. Send me something else whenever you like.'); return json({ ok: true }); }

      // Choosing a group → list the user's groups
      if (data === 'dest:group') {
        const { results: groups } = await env.DB.prepare(
          "SELECT r.id, r.name FROM rooms r JOIN room_members m ON m.room_id = r.id WHERE m.user_id = ? AND r.type = 'group' LIMIT 20"
        ).bind(user.id).all().catch(() => ({ results: [] }));
        if (!groups.length) { await say(env, chatId, 'You have no groups to post to.'); return json({ ok: true }); }
        const kb = { inline_keyboard: groups.map(g => [{ text: g.name || 'Group', callback_data: 'grp:' + g.id }]) };
        await say(env, chatId, 'Which group?', { reply_markup: kb });
        return json({ ok: true });
      }

      const p = st.data || {};
      const now = new Date().toISOString();
      let done = '';

      if (data.startsWith('grp:')) {
        const roomId = data.slice(4);
        // Defense-in-depth: only post to a group the user is actually in.
        const member = await env.DB.prepare(
          "SELECT 1 FROM room_members m JOIN rooms r ON r.id = m.room_id WHERE m.room_id = ? AND m.user_id = ? AND r.type = 'group'"
        ).bind(roomId, user.id).first().catch(() => null);
        if (!member) { await say(env, chatId, 'You are not a member of that group.'); return json({ ok: true }); }
        await env.DB.prepare(
          `INSERT INTO messages (id, room_id, sender_id, sender_nick, type, text, media_key, created_at, read) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
        ).bind(crypto.randomUUID(), roomId, user.id, user.nickname || '', p.mediaKey ? 'media' : 'text', p.text || null, p.mediaKey || null, now).run().catch(() => {});
        done = '💬 Posted to your group!';
      } else if (data === 'dest:channel') {
        // Store the raw R2 key in content — buildPostCard builds /api/media/{key}
        // itself, so storing a full URL here produced a doubled path and a
        // broken image.
        const mediaContent = p.mediaKey || '';
        try {
          await env.DB.prepare(
            `INSERT INTO posts (id, username, user_id, caption, content, likes, comments, created_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?)`
          ).bind(crypto.randomUUID(), user.nickname || 'Anonymous', user.id, p.text || '', mediaContent, now).run();
        } catch (e) {
          await env.DB.prepare(
            `INSERT INTO posts (username, user_id, caption, content, likes, comments, created_at) VALUES (?, ?, ?, ?, 0, 0, ?)`
          ).bind(user.nickname || 'Anonymous', user.id, p.text || '', mediaContent, now).run().catch(() => {});
        }
        done = '📡 Posted to your channel!';
      } else if (data === 'dest:short') {
        if (!p.mediaKey || !p.isVideo) { await say(env, chatId, 'A Short needs a video. Send a video first.'); return json({ ok: true }); }
        await env.DB.prepare(
          `INSERT INTO shorts (id, owner_id, media_key, caption, likes, views, created_at) VALUES (?, ?, ?, ?, 0, 0, ?)`
        ).bind(crypto.randomUUID(), user.id, p.mediaKey, p.text || '', now).run().catch(() => {});
        done = '🎬 Posted as a Short!';
      } else if (data === 'dest:status') {
        await env.DB.prepare(
          'INSERT INTO statuses (id, user_id, type, text, media_key, bg, color, privacy, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(crypto.randomUUID(), user.id, p.mediaKey ? 'media' : 'text', p.text || '', p.mediaKey || null, '#1F6F5C', '#ffffff', 'public', now).run().catch(() => {});
        done = '📿 Posted to your Status!';
      }

      if (done) { await clearState(env, tgId); await say(env, chatId, done + ' Send me the next thing whenever you like.'); }
      return json({ ok: true });
    }

    // ── Regular messages ──
    const msg = update.message;
    if (!msg || !msg.from) return json({ ok: true });
    const tgId = String(msg.from.id);
    const chatId = msg.chat.id;

    const link = await env.DB.prepare('SELECT user_id FROM telegram_links WHERE telegram_user_id = ?').bind(tgId).first().catch(() => null);

    // ── Not linked: run the email → code flow ──
    if (!link) {
      const st = await getState(env, tgId);
      const text = (msg.text || '').trim();

      if (st.step === 'await_email') {
        const email = text.toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { await say(env, chatId, 'That doesn\'t look like an email. Try again:'); return json({ ok: true }); }
        const u = await env.DB.prepare('SELECT id, nickname FROM users WHERE lower(email) = ?').bind(email).first().catch(() => null);
        if (!u) { await say(env, chatId, 'No YID PLUS account has that email. Check the spelling and try again:'); return json({ ok: true }); }
        const code = String(Math.floor(100000 + Math.random() * 900000));
        await setState(env, tgId, 'await_code', { email, code, user_id: u.id, expires: Date.now() + 15 * 60 * 1000, attempts: 0 });
        const sent = await sendCodeEmail(env, email, code, u.nickname);
        await say(env, chatId, sent ? `📧 I sent a 6-digit code to ${email}. Send it here within 15 minutes to finish linking.` : 'Could not send the email right now. Try again later.');
        return json({ ok: true });
      }
      if (st.step === 'await_code') {
        // Expired code → make them restart (stops indefinite brute-forcing).
        if (!st.data.expires || Date.now() > st.data.expires) {
          await setState(env, tgId, 'await_email', {});
          await say(env, chatId, '⌛ That code expired. Send your email again to get a new one.');
          return json({ ok: true });
        }
        if (text.replace(/\s/g, '') === String(st.data.code)) {
          await env.DB.prepare(
            'INSERT INTO telegram_links (telegram_user_id, user_id, linked_at) VALUES (?, ?, ?) ' +
            'ON CONFLICT(telegram_user_id) DO UPDATE SET user_id=excluded.user_id, linked_at=excluded.linked_at'
          ).bind(tgId, st.data.user_id, new Date().toISOString()).run().catch(() => {});
          await clearState(env, tgId);
          await say(env, chatId, '✅ Linked! Now send me a photo, video, or text and I\'ll ask where to post it.');
        } else {
          // Cap wrong guesses so the 6-digit code can't be brute-forced.
          const attempts = (st.data.attempts || 0) + 1;
          if (attempts >= 5) {
            await setState(env, tgId, 'await_email', {});
            await say(env, chatId, '🚫 Too many wrong codes. Send your email again to start over.');
          } else {
            await setState(env, tgId, 'await_code', Object.assign({}, st.data, { attempts: attempts }));
            await say(env, chatId, 'Wrong code (' + (5 - attempts) + ' left). Try again, or send your email to restart.');
          }
        }
        return json({ ok: true });
      }
      // First contact
      await setState(env, tgId, 'await_email', {});
      await say(env, chatId, '👋 Welcome to the YID PLUS posting bot!\n\nTo post under your account, first link it: send me the email address of your YID PLUS account.');
      return json({ ok: true });
    }

    // ── Linked: capture content, then ask where to post ──
    const user = await env.DB.prepare('SELECT id, nickname FROM users WHERE id = ?').bind(link.user_id).first().catch(() => null);
    if (!user) { await say(env, chatId, 'Account not found. Contact support.'); return json({ ok: true }); }

    const caption = (msg.caption || msg.text || '').trim();
    let mediaKey = null, isVideo = false, mediaFailed = false;
    if (msg.photo) {
      mediaKey = await storeMedia(env, msg.photo[msg.photo.length - 1].file_id, 'posts', user.id, 'jpg');
      if (!mediaKey) mediaFailed = true;
    } else if (msg.video) {
      isVideo = true;
      mediaKey = await storeMedia(env, msg.video.file_id, 'shorts', user.id, 'mp4');
      if (!mediaKey) mediaFailed = true;
    } else if (msg.animation) {
      // GIFs arrive as animation (mp4 without sound) — treat as a short-style video.
      isVideo = true;
      mediaKey = await storeMedia(env, msg.animation.file_id, 'shorts', user.id, 'mp4');
      if (!mediaKey) mediaFailed = true;
    } else if (msg.voice) {
      mediaKey = await storeMedia(env, msg.voice.file_id, 'posts', user.id, 'ogg');
      if (!mediaKey) mediaFailed = true;
    } else if (msg.audio) {
      mediaKey = await storeMedia(env, msg.audio.file_id, 'posts', user.id, 'mp3');
      if (!mediaKey) mediaFailed = true;
    } else if (msg.document) {
      mediaKey = await storeMedia(env, msg.document.file_id, 'posts', user.id, 'bin');
      if (!mediaKey) mediaFailed = true;
    }

    // The upload was attempted but failed — tell the user instead of silently
    // asking where to post nothing.
    if (mediaFailed && !mediaKey) {
      await say(env, chatId, '⚠ I couldn\'t download that file from Telegram (it may be too large). Try a smaller file, or send text.');
      return json({ ok: true });
    }

    if (!caption && !mediaKey) { await say(env, chatId, 'Send me some text, a photo, or a video to post.'); return json({ ok: true }); }

    await setState(env, tgId, 'await_dest', { text: caption, mediaKey, isVideo });
    await say(env, chatId, 'Where should I post this?', { reply_markup: destKeyboard(isVideo, !!mediaKey && !isVideo) });
    return json({ ok: true });
  } catch (err) {
    return json({ ok: true }); // always 200 so Telegram doesn't retry-storm
  }
}
