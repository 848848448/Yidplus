// functions/api/admin/check-email.js
// POST /api/admin/check-email  -> { email } -> { role }
// Used by the admin gate (Step 1) to verify the email is authorized.

import { json, corsHeaders } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const email = (body.email || '').trim().toLowerCase();
    if (!email) return json({ ok: false, error: 'email is required' }, 400);

    if (email === env.OWNER_EMAIL) {
      return json({ ok: true, role: 'owner' });
    }

    const user = await env.DB.prepare(
      `SELECT role FROM users WHERE email = ?`
    ).bind(email).first();

    return json({ ok: true, role: user ? user.role : 'member' });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
