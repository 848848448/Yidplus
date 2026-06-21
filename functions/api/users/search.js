import { json, corsHeaders, requireUser } from '../_helpers.js';
export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const q = (new URL(request.url).searchParams.get('q') || '').trim();
    if (!q) return json({ ok: true, users: [] });
    const { results } = await env.DB.prepare(
      "SELECT id, nickname FROM users WHERE nickname LIKE ? AND id != ? AND blocked = 0 LIMIT 20"
    ).bind('%' + q + '%', user.id).all();
    return json({ ok: true, users: results });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
