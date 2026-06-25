import { corsHeaders, requireUser, isSuperOrOwner } from '../_helpers.js';
export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isSuperOrOwner(user, env.OWNER_EMAIL)) {
      return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403, headers: corsHeaders });
    }
    const { results } = await env.DB.prepare(
      'SELECT id, email, nickname, phone, role, verified, blocked, online, created_at FROM users ORDER BY created_at DESC'
    ).all();
    const header = 'id,email,nickname,phone,role,verified,blocked,online,created_at\n';
    const rows = results.map(u =>
      [u.id, u.email || '', u.nickname || '', u.phone || '', u.role || '', u.verified, u.blocked, u.online, u.created_at]
        .map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')
    ).join('\n');
    return new Response(header + rows, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="yidplus-users.csv"',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: corsHeaders });
  }
      }
