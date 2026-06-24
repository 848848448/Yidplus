import { json, corsHeaders } from '../_helpers.js';
export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const email = (body.email || '').toLowerCase().trim();
    if (!email) return json({ ok: false, error: 'email required' }, 400);
    const user = await env.DB.prepare('SELECT role, email FROM users WHERE email = ?').bind(email).first();
    if (!user) return json({ ok: false, error: 'No admin account with this email' }, 404);
    const isOwner = email === env.OWNER_EMAIL || email === "Jmittelman2@gmail.com";
    const isAdmin = isOwner || user.role === 'admin_super' || user.role === 'admin_limited';
    if (!isAdmin) return json({ ok: false, error: 'This account does not have admin access' }, 403);
    const role = isOwner ? 'owner' : user.role;
    return json({ ok: true, role });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
