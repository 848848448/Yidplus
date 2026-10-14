import { json, corsHeaders, requireUser } from '../_helpers.js';
import { shortVisible } from '../_content-visibility.js';
export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const shortId = new URL(request.url).searchParams.get('short_id');
    if (!shortId) return json({ ok: false, error: 'short_id required' }, 400);
    const user = await requireUser(request,env).catch(() => null);
    if (!await shortVisible(env,shortId,user)) return json({ok:false,error:'Not found'},404);
    const { results } = await env.DB.prepare(
      'SELECT id, user_id, nickname, text, created_at FROM short_comments WHERE short_id = ? ORDER BY created_at ASC LIMIT 100'
    ).bind(shortId).all();
    return json({ ok: true, comments: results });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const body = await request.json();
    const text = (body.text || '').trim();
    if (!text || !body.short_id) return json({ ok: false, error: 'short_id and text required' }, 400);
    if (text.length > 200) return json({ok:false,error:'Comment too long'},400);
    if (!await shortVisible(env,body.short_id,user)) return json({ok:false,error:'Not found'},404);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare('INSERT INTO short_comments (id, short_id, user_id, nickname, text, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, body.short_id, user.id, user.nickname || '', text, now).run();
    return json({ ok: true, id }, 201);
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
  }
