// functions/api/admin/email-blast.js
// Owner-only: send an email to every registered user via Resend (batched).
//   POST { subject, message }  -> { ok, sent, total }

import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Owner only' }, 403);
    if (!env.RESEND_API_KEY) return json({ ok: false, error: 'Email is not configured (RESEND_API_KEY missing)' }, 500);

    const body = await request.json();
    const subject = (body.subject || '').trim();
    const message = (body.message || '').trim();
    if (!subject || !message) return json({ ok: false, error: 'Subject and message are required' }, 400);

    const { results: users } = await env.DB.prepare(
      "SELECT email FROM users WHERE email IS NOT NULL AND email != '' AND (blocked IS NULL OR blocked = 0)"
    ).all().catch(() => ({ results: [] }));
    const emails = [...new Set(users.map(u => u.email).filter(Boolean))];
    if (!emails.length) return json({ ok: true, sent: 0, total: 0 });

    const from = env.RESEND_FROM_EMAIL || 'YID PLUS <onboarding@resend.dev>';
    const html =
      `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:16px">
         <h2 style="color:#14503F">${esc(subject)}</h2>
         <div style="font-size:15px;line-height:1.6;color:#222;white-space:pre-wrap">${esc(message)}</div>
         <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
         <p style="font-size:12px;color:#888">YID PLUS · yidplus.com</p>
       </div>`;

    let sent = 0;
    // Resend batch endpoint accepts up to 100 messages per call.
    for (let i = 0; i < emails.length; i += 100) {
      const chunk = emails.slice(i, i + 100).map(to => ({ from, to, subject, html }));
      try {
        const resp = await fetch('https://api.resend.com/emails/batch', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(chunk),
        });
        if (resp.ok) sent += chunk.length;
      } catch (e) { /* skip a failed chunk, continue */ }
    }

    return json({ ok: true, sent, total: emails.length });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
