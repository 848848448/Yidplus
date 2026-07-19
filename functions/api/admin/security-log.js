// functions/api/admin/security-log.js
// GET    /api/admin/security-log?limit=100  -> recent blocked attack attempts
// DELETE /api/admin/security-log            -> clear the whole security log
// Owner / Co-owner only. This surfaces everything the security middleware and
// the brute-force guard record: who tried to attack the site, from where, and
// what they tried.

import { json, corsHeaders, requireUser, isOwnerOrCoOwner, notifyOwnerAttack } from '../_helpers.js';

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
    // the panel loads cleanly (empty) instead of erroring. Older tables may be
    // missing the meta column — add it idempotently.
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS attack_logs (
         id TEXT PRIMARY KEY, ip TEXT, country TEXT, city TEXT, region TEXT,
         asn TEXT, method TEXT, path TEXT, attack_type TEXT, user_agent TEXT,
         referer TEXT, status INTEGER, created_at TEXT, meta TEXT
       )`
    ).run().catch(() => {});
    await env.DB.prepare('ALTER TABLE attack_logs ADD COLUMN meta TEXT').run().catch(() => {});

    const url = new URL(request.url);
    const limit = Math.min(300, parseInt(url.searchParams.get('limit') || '100', 10));

    const { results } = await env.DB.prepare(
      `SELECT id, ip, country, city, region, asn, method, path, attack_type,
              user_agent, referer, status, created_at, meta
       FROM attack_logs ORDER BY created_at DESC LIMIT ?`
    ).bind(limit).all();

    // Headline numbers for the panel summary.
    const stats = await env.DB.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN created_at > datetime('now', '-24 hours') THEN 1 ELSE 0 END) AS last24,
         COUNT(DISTINCT ip) AS unique_ips
       FROM attack_logs`
    ).first().catch(() => ({ total: 0, last24: 0, unique_ips: 0 }));

    // Repeat offenders: which sources keep coming back, how many times, from
    // where, and when they were first/last seen. This is the "who is really
    // after us" view versus the raw chronological feed.
    const offenders = await env.DB.prepare(
      `SELECT ip,
              MAX(country) AS country, MAX(city) AS city, MAX(asn) AS asn,
              COUNT(*) AS hits,
              MIN(created_at) AS first_seen,
              MAX(created_at) AS last_seen
       FROM attack_logs
       WHERE ip IS NOT NULL AND ip != '' AND ip != 'unknown'
       GROUP BY ip ORDER BY hits DESC LIMIT 25`
    ).all().catch(() => ({ results: [] }));

    // Which sources are already banned, so the panel can show "Banned" instead
    // of a redundant Ban button. Includes the country:/asn: sentinel rows.
    const bans = await env.DB.prepare(
      `SELECT ip FROM device_bans WHERE ip IS NOT NULL`
    ).all().catch(() => ({ results: [] }));
    const bannedSet = (bans.results || []).map((b) => b.ip);

    // Current state of the "text my phone on attack" toggle (default ON).
    const alertRow = await env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = 'sec_push_alerts'"
    ).first().catch(() => null);
    const alertsOn = !(alertRow && alertRow.value === 'false');

    return json({
      ok: true,
      logs: results || [],
      stats: stats || {},
      offenders: offenders.results || [],
      banned: bannedSet,
      alerts: alertsOn,
    });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

// POST /api/admin/security-log
//   { alerts: true|false }  -> turn phone alerts on/off
//   { test: true }          -> send a test alert to the owner's phone right now
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const body = await request.json().catch(() => ({}));

    if (typeof body.alerts === 'boolean') {
      await env.DB.prepare(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('sec_push_alerts', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
      ).bind(body.alerts ? 'true' : 'false').run().catch(() => {});
      return json({ ok: true, alerts: body.alerts });
    }

    if (body.test) {
      // Bypass the throttle for a test so the owner can confirm it works: clear
      // the last-sent marker, then fire.
      await env.DB.prepare("DELETE FROM app_settings WHERE key = 'sec_last_push_at'").run().catch(() => {});
      await env.DB.prepare(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('sec_push_alerts', 'true', datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
      ).bind().run().catch(() => {});
      await notifyOwnerAttack(env, 'Test alert', { ip: '203.0.113.7', country: 'US', city: 'Test City' });
      return json({ ok: true, tested: true });
    }

    return json({ ok: false, error: 'Nothing to do' }, 400);
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
