// GET /api/telegram/get-updates  (owner only) — proxies Telegram getUpdates to find chat IDs
import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const user = await requireUser(request, env).catch(() => null);
  if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) {
    return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403 });
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates?limit=20&offset=-20`);
    const data = await res.json();
    return json({ ok: true, updates: data.result || [] });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
                 }
