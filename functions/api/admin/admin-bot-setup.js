// functions/api/admin/admin-bot-setup.js
// Owner-only. Configure the admin activity bot entirely from the app.
//   GET            -> status (token set? connected? chat linked? bot name)
//   POST {save}    -> validate + save token, register webhook
//   POST {test}    -> send a test message
//   POST {events}  -> save which event types to notify

import { json, corsHeaders, requireUser, isOwnerOrCoOwner, getAdminBot, notifyAdmin } from '../_helpers.js';

const HOOK_PATH = '/api/admin-bot/webhook';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

async function saveSetting(env, key, value) {
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).bind(key, value).run();
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Owner only' }, 403);
    const { token, chatId, events } = await getAdminBot(env);
    let botName = null, connected = false;
    if (token) {
      const me = await fetch(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json()).catch(() => null);
      if (me && me.ok) botName = me.result.username ? '@' + me.result.username : me.result.first_name;
      const info = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`).then((r) => r.json()).catch(() => null);
      connected = !!(info && info.result && info.result.url);
    }
    return json({ ok: true, has_token: !!token, token_valid: !!botName, bot: botName, connected, chat_linked: !!chatId, events: events || {} });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Owner only' }, 403);
    const body = await request.json().catch(() => ({}));

    if (body.action === 'save') {
      const token = (body.token || '').trim();
      if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(token)) return json({ ok: false, error: 'That does not look like a bot token.' });
      const me = await fetch(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json()).catch(() => null);
      if (!me || !me.ok) return json({ ok: false, error: 'Telegram rejected this token: ' + ((me && me.description) || 'Unauthorized') });
      const secret = 'ab_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      await saveSetting(env, 'admin_bot_token', token);
      await saveSetting(env, 'admin_bot_webhook_secret', secret);
      // Register the webhook.
      const origin = (env.SITE_URL || new URL(request.url).origin).replace(/\/$/, '');
      const hook = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: origin + HOOK_PATH, secret_token: secret, allowed_updates: ['message'] }),
      }).then((r) => r.json()).catch(() => null);
      const bot = me.result.username ? '@' + me.result.username : me.result.first_name;
      return json({ ok: true, saved: true, bot, connected: !!(hook && hook.ok), open_url: me.result.username ? 'https://t.me/' + me.result.username : null });
    }

    if (body.action === 'events') {
      await saveSetting(env, 'admin_bot_events', JSON.stringify(body.events || {}));
      return json({ ok: true, saved: true });
    }

    if (body.action === 'test') {
      const { token, chatId } = await getAdminBot(env);
      if (!token) return json({ ok: false, error: 'Save a token first.' });
      if (!chatId) return json({ ok: false, error: 'Not linked yet — open the bot in Telegram and send it /start, then try again.' });
      await notifyAdmin(env, '🔔 <b>Test</b> — your YID PLUS admin bot is working.');
      return json({ ok: true, sent: true });
    }

    return json({ ok: false, error: 'Unknown action' });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
