// functions/api/telegram-webhook.js
// Telegram Bot Webhook for YID PLUS
// Bot: @yidplus_bot
//
// Flow:
// 1. First time: ask for YID PLUS email → link account
// 2. Media received → show keyboard: 🎵 Music | 📹 Video | 💬 Group
// 3. Music → Single or Album?
// 4. Group → which group?
// 5. Upload to R2 → insert into DB

const BOT_TOKEN = '8732619798:AAEPtzCpku_mIzWazbC1kGtQ9m35PrAXUiM';
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const update = await request.json();
    await handleUpdate(update, env);
    return new Response('ok', { status: 200 });
  } catch (err) {
    console.error('[telegram-webhook]', err);
    return new Response('ok', { status: 200 }); // always 200 to Telegram
  }
}

export async function onRequestGet(context) {
  return new Response(JSON.stringify({ ok: true, bot: '@yidplus_bot' }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// ─────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────
async function handleUpdate(update, env) {
  const msg = update.message || update.callback_query?.message;
  const cb  = update.callback_query;
  const chatId = msg?.chat?.id || cb?.message?.chat?.id;
  if (!chatId) return;

  const telegramId = String(update.message?.from?.id || cb?.from?.id);

  // Handle callback (button press)
  if (cb) {
    await handleCallback(cb, telegramId, env);
    return;
  }

  if (!update.message) return;

  // Check if user is linked
  const linked = await env.DB.prepare(
    'SELECT yidplus_id, yidplus_email FROM telegram_users WHERE telegram_id = ?'
  ).bind(telegramId).first().catch(() => null);

  // Get current session
  const session = await getSession(telegramId, env);

  // ── NOT LINKED YET ──
  if (!linked) {
    if (session.step === 'await_email') {
      // User sent their email
      const email = (update.message.text || '').toLowerCase().trim();
      const user = await env.DB.prepare(
        'SELECT id, email, nickname FROM users WHERE email = ?'
      ).bind(email).first().catch(() => null);

      if (!user) {
        await sendMsg(chatId, '❌ Email not found on YID PLUS. Try again or check spelling.');
        return;
      }

      await env.DB.prepare(
        'INSERT OR REPLACE INTO telegram_users (telegram_id, yidplus_email, yidplus_id, created_at) VALUES (?, ?, ?, ?)'
      ).bind(telegramId, email, user.id, new Date().toISOString()).run();

      await setSession(telegramId, 'idle', {}, env);
      await sendMsg(chatId,
        `✅ Linked! Welcome @${user.nickname}!\n\nNow send me a video, audio, or text and I'll upload it to YID PLUS for you! 🚀`
      );
      return;
    }

    // First time — ask for email
    await setSession(telegramId, 'await_email', {}, env);
    await sendMsg(chatId,
      `👋 Welcome to the *YID PLUS Bot*!\n\nTo get started, please send me your *YID PLUS email address* so I can link your account.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // ── LINKED USER ──
  const userId = linked.yidplus_id;

  // Handle text in a session step
  if (session.step === 'await_group') {
    const groupName = (update.message.text || '').trim();
    const room = await env.DB.prepare(
      "SELECT id, name FROM rooms WHERE type = 'group' AND LOWER(name) LIKE ? LIMIT 1"
    ).bind('%' + groupName.toLowerCase() + '%').first().catch(() => null);

    if (!room) {
      // List available groups
      const { results } = await env.DB.prepare(
        "SELECT id, name FROM rooms WHERE type = 'group' AND visibility = 'public' ORDER BY name LIMIT 10"
      ).all().catch(() => ({ results: [] }));

      const groupList = results.map(r => `• ${r.name}`).join('\n');
      await sendMsg(chatId, `❌ Group not found. Available groups:\n\n${groupList}\n\nTry again:`);
      return;
    }

    // Send the pending text/media to the group
    const data = JSON.parse(session.data || '{}');
    if (data.text) {
      await postToGroup(room.id, userId, data.text, env);
      await setSession(telegramId, 'idle', {}, env);
      await sendMsg(chatId, `✅ Posted to *${room.name}*!`, { parse_mode: 'Markdown' });
    } else if (data.file_id && data.file_type) {
      await sendMsg(chatId, '⏳ Uploading...');
      await downloadAndPost(chatId, data.file_id, data.file_type, 'group', userId, room.id, null, null, env);
      await setSession(telegramId, 'idle', {}, env);
    }
    return;
  }

  if (session.step === 'await_album_name') {
    const albumName = (update.message.text || '').trim();
    const data = JSON.parse(session.data || '{}');
    await sendMsg(chatId, '⏳ Uploading music...');
    await downloadAndPost(chatId, data.file_id, data.file_type, 'music', userId, null, 'album', albumName, env);
    await setSession(telegramId, 'idle', {}, env);
    return;
  }

  // ── INCOMING MEDIA ──
  const hasVideo  = !!update.message.video;
  const hasAudio  = !!update.message.audio || !!update.message.voice;
  const hasDoc    = !!update.message.document;
  const hasText   = !!update.message.text;
  const hasPhoto  = !!update.message.photo;

  if (hasVideo || hasPhoto) {
    const fileId = hasVideo
      ? update.message.video.file_id
      : update.message.photo[update.message.photo.length - 1].file_id;
    const caption = update.message.caption || '';

    await setSession(telegramId, 'await_type', JSON.stringify({
      file_id: fileId,
      file_type: hasVideo ? 'video' : 'photo',
      caption
    }), env);

    await sendKeyboard(chatId,
      '📤 What would you like to do with this?',
      [
        [{ text: '📹 Upload as Video (Shorts)', callback_data: 'type:video' }],
        [{ text: '💬 Post to a Group', callback_data: 'type:group' }],
        [{ text: '❌ Cancel', callback_data: 'type:cancel' }],
      ]
    );
    return;
  }

  if (hasAudio || hasDoc) {
    const fileId = hasAudio
      ? (update.message.audio?.file_id || update.message.voice?.file_id)
      : update.message.document.file_id;
    const caption = update.message.caption || update.message.audio?.title || '';

    await setSession(telegramId, 'await_type', JSON.stringify({
      file_id: fileId,
      file_type: 'audio',
      caption
    }), env);

    await sendKeyboard(chatId,
      '🎵 What would you like to do with this audio?',
      [
        [{ text: '🎵 Upload as Music', callback_data: 'type:music' }],
        [{ text: '💬 Post to a Group', callback_data: 'type:group' }],
        [{ text: '❌ Cancel', callback_data: 'type:cancel' }],
      ]
    );
    return;
  }

  if (hasText) {
    const text = update.message.text;
    if (text.startsWith('/start')) {
      await sendMsg(chatId,
        `👋 Hello @${update.message.from.username || 'there'}!\n\nSend me a video, audio, or text to upload to YID PLUS!\n\n📹 Video → Shorts\n🎵 Audio → Music\n💬 Text → Group post`
      );
      return;
    }

    await setSession(telegramId, 'await_type', JSON.stringify({ text }), env);
    await sendKeyboard(chatId,
      '💬 Where would you like to post this text?',
      [
        [{ text: '💬 Post to a Group', callback_data: 'type:group' }],
        [{ text: '❌ Cancel', callback_data: 'type:cancel' }],
      ]
    );
    return;
  }

  await sendMsg(chatId, 'Send me a video, audio file, or text message to upload to YID PLUS! 🚀');
}

// ─────────────────────────────────────────────
// CALLBACK HANDLER
// ─────────────────────────────────────────────
async function handleCallback(cb, telegramId, env) {
  const chatId = cb.message.chat.id;
  const data   = cb.data;
  await answerCallback(cb.id);

  const linked = await env.DB.prepare(
    'SELECT yidplus_id FROM telegram_users WHERE telegram_id = ?'
  ).bind(telegramId).first().catch(() => null);
  if (!linked) return;

  const session = await getSession(telegramId, env);
  const sdata   = JSON.parse(session.data || '{}');

  if (data === 'type:cancel') {
    await setSession(telegramId, 'idle', {}, env);
    await editMsg(chatId, cb.message.message_id, '❌ Cancelled.');
    return;
  }

  if (data === 'type:video') {
    await editMsg(chatId, cb.message.message_id, '⏳ Uploading video to Shorts...');
    await downloadAndPost(chatId, sdata.file_id, sdata.file_type, 'shorts', linked.yidplus_id, null, null, sdata.caption || '', env);
    await setSession(telegramId, 'idle', {}, env);
    return;
  }

  if (data === 'type:music') {
    await setSession(telegramId, 'await_music_type', session.data, env);
    await editMsg(chatId, cb.message.message_id, '🎵 Is this a single or part of an album?');
    await sendKeyboard(chatId, 'Choose:', [
      [{ text: '🎵 Single', callback_data: 'music:single' }],
      [{ text: '💿 Album', callback_data: 'music:album' }],
      [{ text: '❌ Cancel', callback_data: 'type:cancel' }],
    ]);
    return;
  }

  if (data === 'music:single') {
    await editMsg(chatId, cb.message.message_id, '⏳ Uploading as single...');
    await downloadAndPost(chatId, sdata.file_id, sdata.file_type, 'music', linked.yidplus_id, null, 'single', sdata.caption || '', env);
    await setSession(telegramId, 'idle', {}, env);
    return;
  }

  if (data === 'music:album') {
    await setSession(telegramId, 'await_album_name', session.data, env);
    await editMsg(chatId, cb.message.message_id, '💿 What is the album name?');
    await sendMsg(chatId, 'Type the album name:');
    return;
  }

  if (data === 'type:group') {
    // List public groups
    const { results } = await env.DB.prepare(
      "SELECT id, name FROM rooms WHERE type = 'group' AND visibility = 'public' ORDER BY name LIMIT 10"
    ).all().catch(() => ({ results: [] }));

    // Also get user's own channel
    const channel = await env.DB.prepare(
      "SELECT id, name FROM rooms WHERE type = 'channel' AND created_by = ? LIMIT 1"
    ).bind(linked.yidplus_id).first().catch(() => null);

    const buttons = [];
    if (channel) {
      buttons.push([{ text: '📡 My Channel: ' + channel.name, callback_data: 'group:' + channel.id + ':channel' }]);
    }
    results.forEach(function (r) {
      buttons.push([{ text: '👥 ' + r.name, callback_data: 'group:' + r.id + ':group' }]);
    });
    buttons.push([{ text: '❌ Cancel', callback_data: 'type:cancel' }]);

    await editMsg(chatId, cb.message.message_id, '👥 Choose where to post:');
    await sendKeyboard(chatId, 'Select a group or your channel:', buttons);
    return;
  }

  if (data.startsWith('group:')) {
    const parts  = data.split(':');
    const roomId = parts[1];
    const rtype  = parts[2]; // 'group' or 'channel'

    if (sdata.text) {
      await postToGroup(roomId, linked.yidplus_id, sdata.text, env);
      await editMsg(chatId, cb.message.message_id, '✅ Posted!');
    } else if (sdata.file_id) {
      await editMsg(chatId, cb.message.message_id, '⏳ Uploading...');
      await downloadAndPost(chatId, sdata.file_id, sdata.file_type, rtype === 'channel' ? 'channel' : 'group', linked.yidplus_id, roomId, null, sdata.caption || '', env);
    }
    await setSession(telegramId, 'idle', {}, env);
    return;
  }
}

// ─────────────────────────────────────────────
// DOWNLOAD FROM TELEGRAM + UPLOAD TO R2 + DB
// ─────────────────────────────────────────────
async function downloadAndPost(chatId, fileId, fileType, destination, userId, roomId, musicType, titleOrCaption, env) {
  try {
    // Get file info from Telegram
    const infoRes = await fetch(`${TG_API}/getFile?file_id=${fileId}`);
    const info    = await infoRes.json();

    let fileData, ext, contentType;

    if (!info.ok || !info.result?.file_path) {
      // File too large (>20MB) — Telegram Bot API limitation
      await sendMsg(chatId,
        '⚠️ Your file is too large for the bot right now (max 20MB).\n\n' +
        '🔧 We are working on support for larger files — stay tuned!\n\n' +
        'For now, please upload it directly on YID PLUS. 🙏'
      );
      return;
    } else {
      const filePath = info.result.file_path;
      const fileUrl  = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
      const fileRes  = await fetch(fileUrl);
      if (!fileRes.ok) throw new Error('Could not download file from Telegram');
      fileData = await fileRes.arrayBuffer();
      ext = filePath.split('.').pop() || 'bin';
      contentType = fileType === 'photo' ? 'image/jpeg' : fileType === 'video' ? 'video/mp4' : 'audio/mpeg';
    }

    const now = new Date().toISOString();

    // Upload to R2 (or store tg:// reference for large files)
    if (destination === 'shorts' || destination === 'video') {
      const key = fileData
        ? `shorts/${userId}/${Date.now()}.${ext}`
        : `tg://${fileId}`;
      if (fileData) {
        await env.MY_BUCKET.put(key, fileData, { httpMetadata: { contentType } });
      }
      const id = crypto.randomUUID();
      await env.DB.prepare(
        'INSERT INTO shorts (id, owner_id, media_key, caption, likes, views, created_at) VALUES (?, ?, ?, ?, 0, 0, ?)'
      ).bind(id, userId, key, titleOrCaption || '', now).run();

      await sendMsg(chatId, '✅ Video uploaded to Shorts! 📹');

    } else if (destination === 'music') {
      const key = `music/${userId}/${Date.now()}.${ext}`;
      await env.MY_BUCKET.put(key, fileData, {
        httpMetadata: { contentType: contentType }
      });
      const id = crypto.randomUUID();
      const title  = titleOrCaption || 'Untitled';
      const mtype  = musicType === 'album' ? 'album' : 'single';
      const albumId = mtype === 'album' ? crypto.randomUUID() : null;

      await env.DB.prepare(
        `INSERT INTO music_tracks (id, owner_id, title, artist, type, album_id, album_name, audio_key, trending, plays, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`
      ).bind(id, userId, title, '', mtype, albumId, mtype === 'album' ? title : null, key, now).run();

      await sendMsg(chatId, '✅ Music uploaded! 🎵');

    } else if (destination === 'group' || destination === 'channel') {
      // Post as a message to a chat room
      const key = `chat/${userId}/${Date.now()}.${ext}`;
      await env.MY_BUCKET.put(key, fileData, {
        httpMetadata: { contentType: contentType }
      });
      const mediaUrl = `https://yidplus-media.a06785e7a5ea1da913c0a95975e11d74.r2.cloudflarestorage.com/${key}`;
      const msgId = crypto.randomUUID();
      const nick  = await getUserNick(userId, env);

      await env.DB.prepare(
        `INSERT INTO messages (id, room_id, sender_id, sender_nick, type, text, media_key, created_at, read)
         VALUES (?, ?, ?, ?, 'media', ?, ?, ?, 0)`
      ).bind(msgId, roomId, userId, nick, titleOrCaption || '', key, now).run();

      await sendMsg(chatId, '✅ Posted to the group! 💬');
    }

  } catch (err) {
    await sendMsg(chatId, '❌ Upload failed: ' + err.message);
  }
}

async function postToGroup(roomId, userId, text, env) {
  const nick = await getUserNick(userId, env);
  await env.DB.prepare(
    'INSERT INTO messages (id, room_id, sender_id, sender_nick, type, text, created_at, read) VALUES (?, ?, ?, ?, \'text\', ?, ?, 0)'
  ).bind(crypto.randomUUID(), roomId, userId, nick, text, new Date().toISOString()).run();
}

async function getUserNick(userId, env) {
  const u = await env.DB.prepare('SELECT nickname FROM users WHERE id = ?').bind(userId).first().catch(() => null);
  return u ? u.nickname : 'Bot User';
}

// ─────────────────────────────────────────────
// SESSION HELPERS
// ─────────────────────────────────────────────
async function getSession(telegramId, env) {
  const row = await env.DB.prepare(
    'SELECT step, data FROM telegram_sessions WHERE telegram_id = ?'
  ).bind(telegramId).first().catch(() => null);
  return row || { step: 'idle', data: '{}' };
}

async function setSession(telegramId, step, data, env) {
  await env.DB.prepare(
    'INSERT OR REPLACE INTO telegram_sessions (telegram_id, step, data, updated_at) VALUES (?, ?, ?, ?)'
  ).bind(telegramId, step, typeof data === 'string' ? data : JSON.stringify(data), new Date().toISOString()).run();
}

// ─────────────────────────────────────────────
// TELEGRAM API HELPERS
// ─────────────────────────────────────────────
async function sendMsg(chatId, text, extra = {}) {
  return fetch(`${TG_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, ...extra }),
  });
}

async function sendKeyboard(chatId, text, buttons) {
  return fetch(`${TG_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: { inline_keyboard: buttons },
    }),
  });
}

async function editMsg(chatId, messageId, text) {
  return fetch(`${TG_API}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text }),
  });
}

async function answerCallback(callbackQueryId) {
  return fetch(`${TG_API}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  });
                                      }
