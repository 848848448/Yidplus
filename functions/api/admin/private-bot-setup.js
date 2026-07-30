// functions/api/admin/private-bot-setup.js
// Owner-only. Connect / check the standalone private bot.
//   GET  -> webhook status (getWebhookInfo) + whether the token/secret are set
//   POST -> registers the webhook with Telegram (setWebhook)

import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';

const HOOK_PATH = '/api/private-bot/webhook';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Owner only' }, 403);
    const hasToken = !!env.PRIVATE_BOT_TOKEN;
    const hasSecret = !!env.PRIVATE_BOT_WEBHOOK_SECRET;
    let info = null, botName = null;
    if (hasToken) {
      info = await fetch(`https://api.telegram.org/bot${env.PRIVATE_BOT_TOKEN}/getWebhookInfo`).then((r) => r.json()).catch(() => null);
      const me = await fetch(`https://api.telegram.org/bot${env.PRIVATE_BOT_TOKEN}/getMe`).then((r) => r.json()).catch(() => null);
      if (me && me.ok) botName = me.result.username ? '@' + me.result.username : me.result.first_name;
    }
    return json({
      ok: true,
      has_token: hasToken,
      has_secret: hasSecret,
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
    if (!env.PRIVATE_BOT_TOKEN) return json({ ok: false, error: 'PRIVATE_BOT_TOKEN is not set in Cloudflare yet.' });
    if (!env.PRIVATE_BOT_WEBHOOK_SECRET) return json({ ok: false, error: 'PRIVATE_BOT_WEBHOOK_SECRET is not set in Cloudflare yet.' });

    const origin = (env.SITE_URL || new URL(request.url).origin).replace(/\/$/, '');
    const hookUrl = origin + HOOK_PATH;
    const res = await fetch(`https://api.telegram.org/bot${env.PRIVATE_BOT_TOKEN}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: hookUrl,
        secret_token: env.PRIVATE_BOT_WEBHOOK_SECRET,
        allowed_updates: ['message', 'channel_post'],
      }),
    }).then((r) => r.json()).catch((e) => ({ ok: false, description: String(e && e.message) }));

    if (res && res.ok) return json({ ok: true, connected: true, webhook_url: hookUrl });
    return json({ ok: false, error: (res && res.description) || 'setWebhook failed' });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
