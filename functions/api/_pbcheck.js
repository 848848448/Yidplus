// TEMP — checks the private-bot email + converter setup (booleans + a health
// ping, never secret values). Remove after.
import { getPrivateBotCreds } from './_helpers.js';

export async function onRequestGet(context) {
  const { env } = context;
  const out = {};
  try {
    const { token, secret } = await getPrivateBotCreds(env);
    out.bot_token_set = !!token;
    out.bot_secret_set = !!secret;
    out.resend_key_set = !!env.RESEND_API_KEY;
    out.resend_from = env.RESEND_FROM_EMAIL || '(default onboarding@resend.dev)';
    out.converter_url_set = !!env.VIDEO_CONVERTER_URL;
    out.converter_secret_set = !!env.VIDEO_CONVERTER_SECRET;

    // email forwarding config from its own table
    try {
      const row = await env.DB.prepare("SELECT enabled, recipients FROM bot_email_config WHERE id = 1").first();
      if (row) {
        out.email_enabled = !!row.enabled;
        let rec = []; try { rec = JSON.parse(row.recipients || '[]'); } catch (e) {}
        out.recipient_count = rec.length;
        out.recipients_preview = rec;
      } else { out.email_enabled = false; out.recipient_count = 0; }
    } catch (e) { out.email_cfg_error = String(e && e.message); }

    // ping the converter /health
    if (env.VIDEO_CONVERTER_URL) {
      try {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 90000);
        const r = await fetch(env.VIDEO_CONVERTER_URL.replace(/\/$/, '') + '/health', { signal: ac.signal });
        clearTimeout(t);
        out.converter_health_status = r.status;
        out.converter_health_body = (await r.text()).slice(0, 120);
      } catch (e) { out.converter_health_error = String(e && e.message); }
    }
  } catch (e) { out.error = String(e && e.message); }
  return new Response(JSON.stringify(out, null, 2), { headers: { 'Content-Type': 'application/json' } });
}
