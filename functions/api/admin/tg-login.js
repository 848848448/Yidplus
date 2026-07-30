// functions/api/admin/tg-login.js
// Owner-only proxy so the Telegram worker can be re-logged-in from the admin
// panel instead of hand-built URLs. The app (server-side) CAN reach the worker,
// so we forward the login steps and pass back what it says.
//   POST { step:'status'|'login'|'code'|'password', secret, phone, code, password }

import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';

const WORKER_BASE = 'https://yidplus-telegram-worker.avrumy5872877.workers.dev';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) {
      return json({ ok: false, error: 'Owner only' }, 403);
    }

    const body = await request.json().catch(() => ({}));
    const step = body.step;
    const secret = (body.secret || '').trim();
    if (!secret) return json({ ok: false, error: 'Worker admin secret required' });

    const base = (env.TG_WORKER_URL || WORKER_BASE).replace(/\/$/, '');
    const q = new URLSearchParams();
    q.set('secret', secret);

    let path;
    if (step === 'status') {
      path = '/status';
    } else if (step === 'login') {
      if (!body.phone) return json({ ok: false, error: 'Phone number required' });
      // Telegram wants just + and digits — strip spaces, dashes, parens.
      var phone = String(body.phone).replace(/[^\d+]/g, '');
      if (phone && phone[0] !== '+') phone = '+' + phone;
      path = '/login'; q.set('phone', phone);
    } else if (step === 'code') {
      if (!body.code) return json({ ok: false, error: 'Code required' });
      path = '/code'; q.set('code', String(body.code).trim());
    } else if (step === 'password') {
      if (!body.password) return json({ ok: false, error: 'Password required' });
      path = '/password'; q.set('password', String(body.password));
    } else {
      return json({ ok: false, error: 'Unknown step' });
    }

    let resp, text;
    try {
      resp = await fetch(base + path + '?' + q.toString(), { headers: { 'User-Agent': 'yidplus-admin' } });
      text = await resp.text();
    } catch (e) {
      return json({ ok: false, error: 'Could not reach the worker: ' + (e && e.message) });
    }

    let data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text.slice(0, 300) }; }
    // Bubble the worker's own response straight through.
    return json({ ok: resp.ok, worker_status: resp.status, result: data });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
