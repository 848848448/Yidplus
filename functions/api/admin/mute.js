import { json, corsHeaders, requireUser, isAdminRole, isSuperOrOwner, logAudit } from '../_helpers.js';
export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
    const { user_id, hours } = await request.json();
    if (!user_id) return json({ ok: false, error: 'user_id required' }, 400);
    const CO_OWNER = 'Jmittelman2@gmail.com';
    const target = await env.DB.prepare('SELECT email, nickname FROM users WHERE id = ?').bind(user_id).first();
    if (!target) return json({ ok: false, error: 'User not found' }, 404);
    if (target.email === env.OWNER_EMAIL || target.email === CO_OWNER) return json({ ok: false, error: 'Cannot mute owner' }, 403);
    const muteUntil = hours ? new Date(Date.now() + hours * 3600000).toISOString() : null;
    await env.DB.prepare('UPDATE users SET muted_until = ? WHERE id = ?').bind(muteUntil, user_id).run();
    await logAudit(env, user, muteUntil ? 'mute_user' : 'unmute_user', 'user', user_id, `@${target.nickname} ${muteUntil ? `until ${muteUntil}` : ''}`);
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
        }
