import { json, corsHeaders, requireUser } from '../_helpers.js';
export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env).catch(() => null);
    if (!user) return json({ ok: true });
    const { id } = await request.json();
    if (!id) return json({ ok: false, error: 'id required' }, 400);
    await env.DB.prepare(
      'UPDATE statuses SET views = COALESCE(views, 0) + 1 WHERE id = ? AND user_id != ?'
    ).bind(id, user.id).run().catch(() => {});
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
  }
