// functions/api/telegram-webhook.js
//
// DISABLED — this was an early, legacy Telegram integration (conversational
// bot flow: link account by email, upload media via chat keyboard menus).
// It has been superseded by the bridge-based system in
// functions/api/telegram/webhook.js + functions/api/admin/telegram-bridges.js,
// which the Admin Panel's "Telegram Bridge" screen manages.
//
// This file previously contained a bot token hardcoded directly in source
// (a real credential leak — anyone with repo access could have taken over
// the bot). It has been neutralized rather than patched, since the
// functionality it provided is no longer needed. The exposed token must be
// rotated via @BotFather regardless of this fix, since it may still be
// present in git history.
//
// If Telegram's servers still have a webhook registered pointing at this
// URL, this responds 200 without processing anything, so Telegram doesn't
// retry indefinitely — but no bot token or secret lives here anymore.

export async function onRequestPost() {
  return new Response('ok', { status: 200 });
}

export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, disabled: true, note: 'Superseded by /api/telegram/webhook' }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
