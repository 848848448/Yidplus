// TEMP — audits all 4 bots: token validity + webhook status. Remove after.
import { getPrivateBotCreds, getAdminBot, getConfig } from './_helpers.js';

async function tg(token, method) {
  try { const r = await fetch(`https://api.telegram.org/bot${token}/${method}`); return await r.json(); } catch (e) { return { ok: false, error: String(e && e.message) }; }
}
async function checkBot(env, token) {
  if (!token) return { configured: false };
  const me = await tg(token, 'getMe');
  const hook = await tg(token, 'getWebhookInfo');
  return {
    configured: true,
    valid: !!(me && me.ok),
    username: me && me.ok ? '@' + me.result.username : null,
    error: me && me.ok ? null : (me && me.description) || 'invalid',
    webhook_url: hook && hook.ok ? (hook.result.url || '(none)') : null,
    pending: hook && hook.ok ? hook.result.pending_update_count : null,
    last_error: hook && hook.ok ? (hook.result.last_error_message || null) : null,
  };
}

export async function onRequestGet(context) {
  const { env } = context;
  const out = {};
  // 1) Channel MTProto userbot — check via last synced telegram post recency
  try {
    const row = await env.DB.prepare("SELECT MAX(posted_at) AS last FROM telegram_posts").first().catch(() => null);
    out.channel_userbot = { last_post: row ? row.last : null };
    if (row && row.last) {
      const ageH = (Date.now() - new Date(row.last).getTime()) / 3600000;
      out.channel_userbot.hours_since_last = Math.round(ageH);
      out.channel_userbot.likely_alive = ageH < 24;
    }
  } catch (e) { out.channel_userbot = { error: String(e && e.message) }; }

  // 2) Private email bot
  try { const { token } = await getPrivateBotCreds(env); out.private_email_bot = await checkBot(env, token); }
  catch (e) { out.private_email_bot = { error: String(e && e.message) }; }

  // 3) Admin activity bot
  try { const { token, chatId } = await getAdminBot(env); out.admin_activity_bot = await checkBot(env, token); out.admin_activity_bot.chat_linked = !!chatId; }
  catch (e) { out.admin_activity_bot = { error: String(e && e.message) }; }

  // 4) Post bot
  try { const token = env.TELEGRAM_POST_BOT_TOKEN || (await getConfig(env, 'TELEGRAM_POST_BOT_TOKEN')); out.post_bot = await checkBot(env, token); }
  catch (e) { out.post_bot = { error: String(e && e.message) }; }

  return new Response(JSON.stringify(out, null, 2), { headers: { 'Content-Type': 'application/json' } });
}
