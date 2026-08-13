// Diagnose the whole "Telegram bot → email" chain and say exactly what's broken.
// Owner only. Also sends a real test email so we see Resend's actual response.
import { json, corsHeaders, requireUser, isOwnerOrCoOwner, getConfig, getPrivateBotCreds } from '../_helpers.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const checks = [];
    const add = (ok, label, detail) => checks.push({ ok, label, detail: detail || '' });

    // 1) Bot token
    const { token, secret } = await getPrivateBotCreds(env);
    add(!!token, 'Bot token set', token ? '' : 'Set PRIVATE_BOT_TOKEN in Config & Keys.');

    // 2) Webhook registered + healthy
    let info = null;
    if (token) {
      info = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`).then((r) => r.json()).catch(() => null);
    }
    const wh = info && info.result;
    add(!!(wh && wh.url), 'Webhook registered', wh && wh.url ? wh.url : 'No webhook set — Telegram isn\'t sending messages here. Click "Connect / re-register".');
    if (wh) {
      const allowed = wh.allowed_updates || [];
      add(allowed.length === 0 || allowed.includes('message'), 'Text messages allowed', allowed.length && !allowed.includes('message') ? 'Webhook allowed_updates is missing "message" — re-register.' : '');
      if (wh.last_error_message) add(false, 'Last delivery error', wh.last_error_message + (wh.last_error_date ? ' (at ' + new Date(wh.last_error_date * 1000).toISOString() + ')' : ''));
      else add(true, 'No recent delivery errors', '');
      if (wh.pending_update_count) add(false, 'Pending updates stuck', wh.pending_update_count + ' updates are queued and not being delivered — usually a webhook error above.');
    }

    // 3) Bot email config
    const cfg = await env.DB.prepare('SELECT enabled, recipients FROM bot_email_config WHERE id = 1').first().catch(() => null);
    add(!!(cfg && cfg.enabled), 'Bot email turned ON', cfg && cfg.enabled ? '' : 'Turn it on in Admin → Bot Email.');
    let recips = [];
    try { recips = JSON.parse((cfg && cfg.recipients) || '[]'); } catch (e) {}
    add(recips.length > 0, 'Recipients set', recips.length ? recips.join(', ') : 'Add your email in Admin → Bot Email.');

    // 4) Resend
    const rk = await getConfig(env, 'RESEND_API_KEY');
    const fromAddr = (await getConfig(env, 'RESEND_FROM_EMAIL')) || 'YID PLUS <onboarding@resend.dev>';
    add(!!rk, 'Resend API key set', rk ? '' : 'Set RESEND_API_KEY in Config & Keys.');
    add(true, 'From address', fromAddr + (fromAddr.includes('resend.dev') ? '  ⚠️ using resend.dev test address — it can ONLY send to your Resend account owner email. Verify your own domain for real delivery.' : ''));

    // 5) Actually send a test email and capture Resend's response
    let sendResult = 'skipped';
    if (rk && recips.length) {
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${rk}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: fromAddr, to: recips, subject: 'YID PLUS bot email test', html: '<p>This is a test from the bot-email diagnostic. If you got this, email delivery works.</p>' }),
        });
        const body = await r.json().catch(() => ({}));
        if (r.ok) { sendResult = 'sent'; add(true, 'Test email sent', 'Check your inbox (and spam). id: ' + (body.id || '')); }
        else { sendResult = 'failed'; add(false, 'Test email FAILED', 'Resend said: ' + (body.message || body.error || ('HTTP ' + r.status)) + '. This is why nothing arrives.'); }
      } catch (e) { sendResult = 'error'; add(false, 'Test email error', e.message); }
    }

    const allOk = checks.every((c) => c.ok);
    return json({ ok: true, all_ok: allOk, send_result: sendResult, checks });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}
