// functions/api/auth/sessions.js
// DELETE /api/auth/sessions?id=X   -> revoke one of the user's own sessions (device logout)
// DELETE /api/auth/sessions?all=1  -> revoke every session for the user (logout all devices)
//
// This was missing entirely — the Settings page's "Logout" (per-device) and
// "Logout All Devices" buttons called this route but got a 404 every time.

import { json, corsHeaders, requireUser, getCookie } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const url = new URL(request.url);
    const all = url.searchParams.get('all');
    const id  = url.searchParams.get('id');

    if (all) {
      await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
      return json({ ok: true });
    }

    if (!id) return json({ ok: false, error: 'id or all is required' }, 400);

    // Ownership check — a user may only revoke their own sessions.
    const row = await env.DB.prepare('SELECT user_id FROM sessions WHERE id = ?').bind(id).first();
    if (!row) return json({ ok: false, error: 'Session not found' }, 404);
    if (row.user_id !== user.id) return json({ ok: false, error: 'Forbidden' }, 403);

    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();

    // If the caller just revoked the session they're currently using, also
    // clear their cookie so the browser doesn't keep sending a dead token.
    const currentSessionId = getCookie(request, 'yp_session');
    const headers = { ...corsHeaders, 'Content-Type': 'application/json' };
    if (currentSessionId === id) {
      headers['Set-Cookie'] = 'yp_session=; HttpOnly; Path=/; Max-Age=0';
    }
    return new Response(JSON.stringify({ ok: true }), { headers });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
