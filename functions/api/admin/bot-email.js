// functions/api/admin/bot-email.js
// Owner-only. Configure the Telegram-bot → email forwarding: on/off and the
// list of recipient email addresses.
//   GET  -> { ok, enabled, recipients:[...] }
//   POST { enabled, recipients:[...] } -> saves

import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';

async function ensure(env) {
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS bot_email_config (id INTEGER PRIMARY KEY CHECK (id = 1), enabled INTEGER DEFAULT 0, recipients TEXT DEFAULT \'[]\')'
  ).run().catch(() => {});
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Owner only' }, 403);
    await ensure(env);
    const row = await env.DB.prepare('SELECT enabled, recipients FROM bot_email_config WHERE id = 1').first().catch(() => null);
    let recipients = [];
    try { recipients = JSON.parse((row && row.recipients) || '[]'); } catch (e) { recipients = []; }
    return json({ ok: true, enabled: !!(row && row.enabled), recipients });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Owner only' }, 403);
    await ensure(env);
    const body = await request.json().catch(() => ({}));
    const enabled = body.enabled ? 1 : 0;
    let list = Array.isArray(body.recipients) ? body.recipients : String(body.recipients || '').split(/[\n,;\s]+/);
    list = list.map((s) => String(s).trim()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
    await env.DB.prepare(
      'INSERT INTO bot_email_config (id, enabled, recipients) VALUES (1, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, recipients = excluded.recipients'
    ).bind(enabled, JSON.stringify(list)).run();
    return json({ ok: true, enabled: !!enabled, recipients: list });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
