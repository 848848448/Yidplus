// TEMP — asks Telegram whether PRIVATE_BOT_TOKEN is valid. Reveals only the
// bot's own username / Telegram's error, never the token. Remove after.
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  // Allow testing a token directly via ?token= to isolate Cloudflare vs the token itself.
  const raw = url.searchParams.get('token') || env.PRIVATE_BOT_TOKEN || '';
  const token = raw.trim();
  const out = {
    source: url.searchParams.get('token') ? 'query param' : 'PRIVATE_BOT_TOKEN in Cloudflare',
    token_present: !!raw,
    token_length_raw: raw.length,
    token_length_trimmed: token.length,
    had_surrounding_whitespace: raw !== token,
    looks_like_token: /^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(token),
  };
  if (!token) return json(out);
  try {
    const r = await fetch('https://api.telegram.org/bot' + token + '/getMe');
    const data = await r.json();
    out.telegram_status = r.status;
    out.telegram_ok = data.ok;
    out.bot_username = data.ok && data.result ? data.result.username : null;
    out.telegram_error = data.ok ? null : data.description;
  } catch (e) {
    out.fetch_error = String(e && e.message);
  }
  return json(out);
}
function json(o) { return new Response(JSON.stringify(o, null, 2), { headers: { 'Content-Type': 'application/json' } }); }
