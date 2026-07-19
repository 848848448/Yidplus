// functions/api/admin/security-log.js
// GET    /api/admin/security-log?limit=100  -> recent blocked attack attempts
// DELETE /api/admin/security-log            -> clear the whole security log
// Owner / Co-owner only. This surfaces everything the security middleware and
// the brute-force guard record: who tried to attack the site, from where, and
// what they tried.

import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    // Table may not exist yet if no attack has ever been blocked. Create it so
    // the panel loads cleanly (empty) instead of erroring.
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS attack_logs (
         id TEXT PRIMARY KEY, ip TEXT, country TEXT, city TEXT, region TEXT,
         asn TEXT, method TEXT, path TEXT, attack_type TEXT, user_agent TEXT,
         referer TEXT, status INTEGER, created_at TEXT
       )`
    ).run().catch(() => {});

    const url = new URL(request.url);
    const limit = Math.min(300, parseInt(url.searchParams.get('limit') || '100', 10));

    const { results } = await env.DB.prepare(
      `SELECT id, ip, country, city, region, asn, method, path, attack_type,
              user_agent, referer, status, created_at
       FROM attack_logs ORDER BY created_at DESC LIMIT ?`
    ).bind(limit).all();

    // A few quick headline numbers for the panel summary.
    const stats = await env.DB.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN created_at > datetime('now', '-24 hours') THEN 1 ELSE 0 END) AS last24,
         COUNT(DISTINCT ip) AS unique_ips
       FROM attack_logs`
    ).first().catch(() => ({ total: 0, last24: 0, unique_ips: 0 }));

    return json({ ok: true, logs: results || [], stats: stats || {} });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    await env.DB.prepare('DELETE FROM attack_logs').run().catch(() => {});
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
