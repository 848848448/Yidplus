import { json, corsHeaders, requireUser, isSuperOrOwner } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

async function ensureTable(env) {
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS telegram_channels (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, title TEXT, added_by TEXT, created_at TEXT NOT NULL, sort_order INTEGER DEFAULT 0)'
  ).run().catch(() => {});
}

// Clean a user-supplied handle into a bare Telegram username.
function cleanUsername(raw) {
  if (!raw) return '';
  let u = String(raw).trim();
  u = u.replace(/^https?:\/\/(t\.me|telegram\.me)\//i, ''); // strip full links
  u = u.replace(/^s\//, '');   // strip the /s/ preview prefix
  u = u.replace(/^@/, '');      // strip a leading @
  u = u.split(/[/?#]/)[0];      // drop anything after the name
  return u.replace(/[^a-zA-Z0-9_]/g, '');
}

// GET → list all Telegram channels (shown in everyone's Channels tab)
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    await ensureTable(env);
    const res = await env.DB.prepare(
      'SELECT id, username, title, created_at FROM telegram_channels ORDER BY sort_order ASC, created_at ASC'
    ).all();
    return json({ ok: true, channels: res.results || [] });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

// POST { username, title } → add a channel (owner / super admin only)
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isSuperOrOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
    await ensureTable(env);

    const body = await request.json();
    const username = cleanUsername(body.username);
    if (!username || username.length < 3) return json({ ok: false, error: 'Enter a valid public @username' }, 400);
    const title = (body.title || '').trim().slice(0, 80) || username;

    const exists = await env.DB.prepare('SELECT id FROM telegram_channels WHERE username = ?').bind(username).first();
    if (exists) return json({ ok: false, error: 'That channel is already added' }, 409);

    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO telegram_channels (id, username, title, added_by, created_at, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(id, username, title, user.id, new Date().toISOString(), Date.now()).run();

    return json({ ok: true, channel: { id, username, title } }, 201);
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

// DELETE ?id= → remove a channel (owner / super admin only)
export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isSuperOrOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
    await ensureTable(env);
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return json({ ok: false, error: 'id required' }, 400);
    await env.DB.prepare('DELETE FROM telegram_channels WHERE id = ?').bind(id).run();
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
