// functions/api/error-log.js
// Captures front-end errors so the owner can review them in admin.
//   POST  (any client) { message, source, line, col, stack, url }  -> log it
//   GET   (owner only)  -> recent errors
//   DELETE(owner only)  -> clear the log

import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from './_helpers.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

async function ensure(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS error_log (
      id TEXT PRIMARY KEY, message TEXT, source TEXT, line INTEGER, col INTEGER,
      level TEXT DEFAULT 'error', stack TEXT, page TEXT, ua TEXT, user_id TEXT, nickname TEXT, count INTEGER DEFAULT 1,
      created_at TEXT
    )`
  ).run().catch(() => {});
  await env.DB.prepare("ALTER TABLE error_log ADD COLUMN level TEXT DEFAULT 'error'").run().catch(() => {});
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    await ensure(env);
    const b = await request.json().catch(() => ({}));
    const message = String(b.message || '').slice(0, 1000);
    const level = String(b.level || 'error').slice(0, 20);
    if (!message) return json({ ok: true });
    // Ignore noise from browser extensions / cross-origin scripts.
    if (/^Script error\.?$/i.test(message)) return json({ ok: true });

    let user = null;
    try { user = await requireUser(request, env); } catch (e) {}
    const source = String(b.source || '').slice(0, 300);
    const line = parseInt(b.line, 10) || 0;
    const page = String(b.url || '').slice(0, 300);
    const stack = String(b.stack || '').slice(0, 2000);

    // De-dupe: same message+source+line → bump the count instead of a new row.
    const existing = await env.DB.prepare(
      'SELECT id, count FROM error_log WHERE message = ? AND source = ? AND line = ? LIMIT 1'
    ).bind(message, source, line).first().catch(() => null);
    if (existing) {
      await env.DB.prepare('UPDATE error_log SET count = count + 1, created_at = ? WHERE id = ?')
        .bind(new Date().toISOString(), existing.id).run().catch(() => {});
    } else {
      await env.DB.prepare(
        'INSERT INTO error_log (id, level, message, source, line, col, stack, page, ua, user_id, nickname, count, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)'
      ).bind(crypto.randomUUID(), level, message, source, line, parseInt(b.col, 10) || 0, stack, page,
        String(request.headers.get('User-Agent') || '').slice(0, 200),
        user ? user.id : null, user ? user.nickname : null, new Date().toISOString()).run();
    }
    // Keep the table from growing forever.
    await env.DB.prepare('DELETE FROM error_log WHERE id NOT IN (SELECT id FROM error_log ORDER BY created_at DESC LIMIT 200)').run().catch(() => {});
    return json({ ok: true });
  } catch (err) { return json({ ok: false }); }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Owner only' }, 403);
    await ensure(env);
    const { results } = await env.DB.prepare(
      'SELECT id, level, message, source, line, col, stack, page, nickname, count, created_at FROM error_log ORDER BY created_at DESC LIMIT 100'
    ).all().catch(() => ({ results: [] }));
    return json({ ok: true, errors: results || [] });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Owner only' }, 403);
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (id) await env.DB.prepare('DELETE FROM error_log WHERE id = ?').bind(id).run().catch(() => {});
    else await env.DB.prepare('DELETE FROM error_log').run().catch(() => {});
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
