import { json, corsHeaders } from '../_helpers.js';
export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const email = (body.email || '').toLowerCase().trim();
    if (!email) return json({ ok: false, error: 'email required' }, 400);
    const user = await env.DB.prepare('SELECT role, email FROM users WHERE email = ?').bind(email).first();
    const isOwner = user && (email === env.OWNER_EMAIL || email === "Jmittelman2@gmail.com");
    const isAdmin = user && (isOwner || user.role === 'admin_super' || user.role === 'admin_limited');
    // Deliberately identical response whether the email doesn't exist at all or
    // simply isn't an admin — distinguishing the two would let anyone probe
    // which emails are registered on the platform (enumeration).
    if (!isAdmin) return json({ ok: false, error: 'This account does not have admin access' }, 403);
    const role = isOwner ? 'owner' : user.role;
    return json({ ok: true, role });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
