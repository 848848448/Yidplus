import { json, corsHeaders, requireUser, isAdminRole } from '../_helpers.js';
export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
    const users  = await env.DB.prepare('SELECT COUNT(*) AS c FROM users').first();
    const posts  = await env.DB.prepare('SELECT COUNT(*) AS c FROM posts').first();
    const shorts = await env.DB.prepare('SELECT COUNT(*) AS c FROM shorts').first();
    const msgs   = await env.DB.prepare('SELECT COUNT(*) AS c FROM messages').first();
    const online = await env.DB.prepare('SELECT COUNT(*) AS c FROM users WHERE online = 1').first();
    return json({ ok: true, stats: { users: users.c, posts: posts.c, shorts: shorts.c, messages: msgs.c, online: online.c } });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
      }
