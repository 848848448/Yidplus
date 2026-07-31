// functions/api/admin-bot/webhook.js
// The admin activity bot's webhook. Its only job: when you message the bot
// (e.g. /start), remember the chat it should send notifications to.
import { json, corsHeaders, getAdminBot } from '../_helpers.js';

async function saveSetting(env, key, value) {
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).bind(key, value).run();
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { token } = await getAdminBot(env);
    // Verify the secret so only Telegram can post here.
    const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    let expected = '';
    try {
      const r = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'admin_bot_webhook_secret'").first();
      expected = (r && r.value) || '';
    } catch (e) {}
    if (expected && secret !== expected) return new Response('Unauthorized', { status: 401 });

    const update = await request.json().catch(() => ({}));
    const msg = update.message || update.edited_message || update.channel_post;
    if (msg && msg.chat && msg.chat.id != null) {
      await saveSetting(env, 'admin_bot_chat_id', String(msg.chat.id));
      // Say hi so the owner knows it worked.
      if (token && /^\/(start|hi|hello|connect)/i.test(msg.text || '')) {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: msg.chat.id, text: '✅ Connected! You will now get YID PLUS activity here — new sign-ups, posts, reports and more.' }),
        }).catch(() => {});
      }
    }
    return json({ ok: true });
  } catch (e) {
    return json({ ok: true }); // always 200 to Telegram
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
