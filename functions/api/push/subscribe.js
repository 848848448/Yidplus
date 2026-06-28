import { json, corsHeaders, requireUser } from '../_helpers.js';
export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const body = await request.json();
    const { endpoint, keys } = body;
    if (!endpoint || !keys) return json({ ok: false, error: 'Invalid subscription' }, 400);
    await env.DB.prepare(
      `INSERT OR REPLACE INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), user.id, endpoint, keys.p256dh || '', keys.auth || '', new Date().toISOString()).run();
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    await env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').bind(user.id).run();
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
           }
