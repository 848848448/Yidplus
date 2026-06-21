import { json, corsHeaders, requireUser } from '../_helpers.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    return json({ ok: true, user });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
