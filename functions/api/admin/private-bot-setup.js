// functions/api/admin/private-bot-setup.js
// Owner-only. Connect / check / configure the standalone private bot.
//   GET            -> webhook status + whether token/secret are set + bot name
//   POST {save}    -> validate a token against Telegram and save token+secret
//                     into app_settings (no Cloudflare needed)
//   POST (default) -> register the webhook with Telegram (setWebhook)

import { json, corsHeaders, requireUser, isOwnerOrCoOwner, getPrivateBotCreds } from '../_helpers.js';

const HOOK_PATH = '/api/private-bot/webhook';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

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
    const { token, secret } = await getPrivateBotCreds(env);
    let info = null, botName = null;
    if (token) {
      info = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`).then((r) => r.json()).catch(() => null);
      const me = await fetch(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json()).catch(() => null);
      if (me && me.ok) botName = me.result.username ? '@' + me.result.username : me.result.first_name;
    }
    return json({
      ok: true,
      has_token: !!token,
      has_secret: !!secret,
      token_valid: !!botName,
      bot: botName,
      webhook_url: info && info.result ? info.result.url : '',
      connected: !!(info && info.result && info.result.url),
    });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Owner only' }, 403);

    const body = await request.json().catch(() => ({}));

    // Save token + secret into app_settings after checking the token works.
    if (body.action === 'save') {
      const token = (body.token || '').trim();
      let secret = (body.webhook_secret || '').trim();
      if (!token) return json({ ok: false, error: 'Paste the bot token.' });
      if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(token)) return json({ ok: false, error: 'That does not look like a bot token.' });
      // Verify with Telegram before saving.
      const me = await fetch(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json()).catch(() => null);
      if (!me || !me.ok) return json({ ok: false, error: 'Telegram rejected this token: ' + ((me && me.description) || 'Unauthorized') + '. Get a fresh one from BotFather → /token.' });
      if (!secret) secret = 'yp_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      await saveSetting(env, 'private_bot_token', token);
      await saveSetting(env, 'private_bot_webhook_secret', secret);
      return json({ ok: true, saved: true, bot: me.result.username ? '@' + me.result.username : me.result.first_name });
    }

    // Default: register the webhook.
    const { token, secret } = await getPrivateBotCreds(env);
    if (!token) return json({ ok: false, error: 'No bot token set yet. Paste it above and press Save first.' });
    if (!secret) return json({ ok: false, error: 'No webhook secret set yet. Save the token first.' });

    const origin = (env.SITE_URL || new URL(request.url).origin).replace(/\/$/, '');
    const hookUrl = origin + HOOK_PATH;
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: hookUrl, secret_token: secret, allowed_updates: ['message', 'channel_post', 'message_reaction', 'edited_message'] }),
    }).then((r) => r.json()).catch((e) => ({ ok: false, description: String(e && e.message) }));

    if (res && res.ok) return json({ ok: true, connected: true, webhook_url: hookUrl });
    return json({ ok: false, error: (res && res.description) || 'setWebhook failed' });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
