// Admin call oversight: see live calls, recent call history, and force-end a
// call. Owner/co-owner only. This is call metadata (who/when/status) — not
// call content.
import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const q = (sql, args) => env.DB.prepare(sql).bind(...(args || [])).all().catch(() => ({ results: [] }));

    const active = await q(
      `SELECT c.id, c.kind, c.status, c.created_at, c.updated_at,
              cu.nickname AS caller_nick, eu.nickname AS callee_nick
         FROM calls c
         LEFT JOIN users cu ON cu.id = c.caller_id
         LEFT JOIN users eu ON eu.id = c.callee_id
        WHERE c.status IN ('ringing','active')
        ORDER BY c.created_at DESC LIMIT 30`
    );
    const recent = await q(
      `SELECT c.id, c.kind, c.status, c.created_at, c.updated_at,
              cu.nickname AS caller_nick, eu.nickname AS callee_nick
         FROM calls c
         LEFT JOIN users cu ON cu.id = c.caller_id
         LEFT JOIN users eu ON eu.id = c.callee_id
        WHERE c.status IN ('ended','declined')
        ORDER BY c.updated_at DESC LIMIT 40`
    );
    const groupActive = await q(
      `SELECT p.room_id, COUNT(*) AS n, MAX(p.seen_at) AS last_seen, r.name AS room_name
         FROM group_call_participants p LEFT JOIN rooms r ON r.id = p.room_id
        WHERE p.seen_at > ?
        GROUP BY p.room_id ORDER BY n DESC LIMIT 20`,
      [new Date(Date.now() - 20000).toISOString()]
    ).catch(() => ({ results: [] }));

    // Stats
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const totalToday = await env.DB.prepare(`SELECT COUNT(*) AS c FROM calls WHERE created_at > ?`).bind(todayStart.toISOString()).first().catch(() => ({ c: 0 }));

    return json({
      ok: true,
      active: active.results || [],
      recent: recent.results || [],
      group_active: groupActive.results || [],
      calls_today: (totalToday && totalToday.c) || 0,
    });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
    const body = await request.json().catch(() => ({}));

    if (body.action === 'end' && body.call_id) {
      await env.DB.prepare("UPDATE calls SET status='ended', updated_at=? WHERE id=?")
        .bind(new Date().toISOString(), body.call_id).run();
      return json({ ok: true });
    }
    if (body.action === 'end_group' && body.room_id) {
      await env.DB.prepare('DELETE FROM group_call_participants WHERE room_id=?').bind(body.room_id).run();
      return json({ ok: true });
    }
    return json({ ok: false, error: 'Unknown action' }, 400);
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
}
