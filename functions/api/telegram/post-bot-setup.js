// functions/api/telegram/post-bot-setup.js
// Owner-only: connect / check / disconnect the SECOND (publishing) bot's webhook.
// Uses TELEGRAM_POST_BOT_TOKEN and points Telegram at /api/telegram/post-bot.
import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

async function gate(request, env) {
  const user = await requireUser(request, env).catch(() => null);
  if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return { err: json({ ok: false, error: 'Forbidden' }, 403) };
  if (!env.TELEGRAM_POST_BOT_TOKEN) return { err: json({ ok: false, error: 'TELEGRAM_POST_BOT_TOKEN is not configured in Cloudflare settings.' }, 500) };
  return { user };
}
const hookUrl = (request) => new URL(request.url).origin + '/api/telegram/post-bot';

export async function onRequestPost(context) {
  const { request, env } = context;
  const g = await gate(request, env); if (g.err) return g.err;
  try {
    const params = new URLSearchParams();
    params.set('url', hookUrl(request));
    params.set('drop_pending_updates', 'true');
    params.set('allowed_updates', JSON.stringify(['message', 'callback_query']));
    if (env.TELEGRAM_POST_WEBHOOK_SECRET) params.set('secret_token', env.TELEGRAM_POST_WEBHOOK_SECRET);
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_POST_BOT_TOKEN}/setWebhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString(),
    });
    const data = await res.json();
    if (!data.ok) return json({ ok: false, error: data.description || 'Telegram rejected setWebhook', telegram: data }, 400);
    return json({ ok: true, url: hookUrl(request) });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const g = await gate(request, env); if (g.err) return g.err;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_POST_BOT_TOKEN}/getWebhookInfo`);
    const data = await res.json();
    const info = data.result || {};
    return json({
      ok: true, connected: !!info.url, url: info.url || null,
      pending_update_count: info.pending_update_count || 0,
      last_error_message: info.last_error_message || null,
      expected_url: hookUrl(request),
    });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const g = await gate(request, env); if (g.err) return g.err;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_POST_BOT_TOKEN}/deleteWebhook?drop_pending_updates=false`);
    const data = await res.json();
    return json({ ok: !!data.ok, telegram: data });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
