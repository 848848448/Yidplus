// functions/api/admin/email-test.js
// POST /api/admin/email-test  { to }   (owner only)
//   Sends a real test email through Resend and returns the EXACT Resend
//   API response (status + body), so delivery problems can be diagnosed
//   precisely instead of guessing. Also reports which config is present.

import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) {
      return json({ ok: false, error: 'Forbidden' }, 403);
    }

    const body = await request.json().catch(() => ({}));
    const to = (body.to || user.email || '').trim();
    if (!to) return json({ ok: false, error: 'No recipient' }, 400);

    const hasKey = !!env.RESEND_API_KEY;
    const fromConfigured = !!env.RESEND_FROM_EMAIL;
    const fromAddr = env.RESEND_FROM_EMAIL || 'YID PLUS <onboarding@resend.dev>';

    // Report config even if we can't send.
    const config = {
      resend_api_key_present: hasKey,
      resend_from_email_configured: fromConfigured,
      from_address_used: fromAddr,
    };

    if (!hasKey) {
      return json({ ok: true, delivered: false, config, hint: 'RESEND_API_KEY is not set in Cloudflare — no email can be sent. Add it in Cloudflare > your project > Settings > Environment Variables, then redeploy.' });
    }

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddr,
        to: [to],
        subject: 'YID PLUS test email',
        html: '<div style="font-family:sans-serif;padding:16px"><h2 style="color:#1F6F5C">It works! ✅</h2><p>This is a test email from YID PLUS. If you can read this, email delivery is configured correctly.</p></div>',
      }),
    }).catch(err => ({ ok: false, _networkError: err.message, status: 0 }));

    let respBody = null;
    try { respBody = await resp.json(); } catch (e) { respBody = { _note: 'no JSON body' }; }

    // Resend returns a message id on success. Treat success as: HTTP 2xx AND
    // a body that isn't an error. Some setups surface errors with a 200, so
    // check the body too rather than trusting the status alone.
    const httpOk = resp.status >= 200 && resp.status < 300;
    const bodyHasId = respBody && respBody.id;
    const bodyHasError = respBody && (respBody.error || respBody.message || respBody.statusCode >= 400);

    if (!httpOk || bodyHasError || !bodyHasId) {
      return json({
        ok: true,
        delivered: false,
        config,
        resend_status: resp.status || 0,
        resend_response: respBody,
        network_error: resp._networkError || null,
        hint: _hintFor(resp.status, respBody, fromConfigured),
      });
    }

    return json({ ok: true, delivered: true, config, resend_status: resp.status, resend_response: respBody, sent_to: to });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

function _hintFor(status, respBody, fromConfigured) {
  const msg = (respBody && (respBody.message || respBody.error || (respBody.error && respBody.error.message) || '')) + '';
  const lower = msg.toLowerCase();

  // Resend's most common real-world block: on a shared/unverified sender you
  // may ONLY send to your own account email. Sending to anyone else fails
  // with a message about testing / verifying a domain / recipients.
  if (lower.includes('you can only send testing emails') ||
      lower.includes('own email address') ||
      lower.includes('testing emails to your')) {
    return 'Resend is in testing mode: it will ONLY deliver to your own Resend account email until you verify a domain. Verify yidplus.com in Resend (Domains tab), then set RESEND_FROM_EMAIL to an address on it (e.g. noreply@yidplus.com). After that, emails reach all users.';
  }
  if (status === 401 || status === 403) {
    if (lower.includes('domain') || lower.includes('verify') || lower.includes('testing') || lower.includes('only send')) {
      return 'Your sender domain isn\u2019t verified in Resend, so it only delivers to your own account email. Verify yidplus.com in Resend and set RESEND_FROM_EMAIL to an address on it.';
    }
    return 'The Resend API key looks invalid or lacks permission. Re-check RESEND_API_KEY in Cloudflare.';
  }
  if (lower.includes('domain') || lower.includes('verify') || lower.includes('not allowed') || lower.includes('from')) {
    return fromConfigured
      ? 'Your RESEND_FROM_EMAIL domain is not verified in Resend. Add and verify the domain in Resend (Domains tab), or use an address on a domain you have verified.'
      : 'Resend\u2019s shared test sender only delivers to your own Resend account email. To email real users, verify a domain in Resend and set RESEND_FROM_EMAIL to an address on it.';
  }
  if (status === 422) {
    return 'Resend rejected the request (422) — usually the "from" address is on an unverified domain. Verify your domain in Resend and set RESEND_FROM_EMAIL.';
  }
  if (status >= 200 && status < 300) {
    return 'Resend accepted the request but didn\u2019t return a message id — check the response above. If RESEND_FROM_EMAIL isn\u2019t on a verified domain, verify your domain in Resend.';
  }
  return 'Check the resend_response above for the exact reason.';
}
