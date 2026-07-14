import { json, corsHeaders, requireUser, isSuperOrOwner } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

async function ensureTable(env) {
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS telegram_posts (' +
    'id TEXT PRIMARY KEY, username TEXT NOT NULL, tg_msg_id INTEGER NOT NULL, ' +
    'text TEXT, media_url TEXT, media_type TEXT, link TEXT, posted_at TEXT, created_at TEXT NOT NULL, ' +
    'UNIQUE(username, tg_msg_id))'
  ).run().catch(() => {});
}

// Parse "t.me/channel/123", "https://t.me/channel/123", "@channel 123", etc.
function parseLink(raw) {
  const s = String(raw || '').trim();
  let m = s.match(/(?:t\.me|telegram\.me)\/([a-zA-Z0-9_]+)\/(\d+)/i);
  if (m) return { username: m[1], id: parseInt(m[2]) };
  m = s.match(/^@?([a-zA-Z0-9_]+)[\/\s]+(\d+)$/); // "channel/123" or "@channel 123"
  if (m) return { username: m[1], id: parseInt(m[2]) };
  return null;
}

// GET → all pasted posts (admin list) or ?username=X for one channel.
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    await ensureTable(env);
    const u = (new URL(request.url).searchParams.get('username') || '').replace(/[^a-zA-Z0-9_]/g, '');
    let res;
    if (u) {
      res = await env.DB.prepare('SELECT id, username, tg_msg_id, link, posted_at FROM telegram_posts WHERE username = ? ORDER BY tg_msg_id DESC LIMIT 100').bind(u).all();
    } else {
      res = await env.DB.prepare('SELECT id, username, tg_msg_id, link FROM telegram_posts ORDER BY username ASC, tg_msg_id DESC LIMIT 500').all();
    }
    return json({ ok: true, posts: res.results || [] });
  } catch (err) { return json({ ok: true, posts: [], error: err.message }); }
}

// POST { link } → add one post (owner/super only). Accepts many links at once.
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isSuperOrOwner(user, env.OWNER_EMAIL)) return json({ ok: true, added: 0, error: 'Forbidden' });
    await ensureTable(env);

    const body = await request.json().catch(() => ({}));
    const links = String(body.link || body.links || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    if (!links.length) return json({ ok: true, added: 0, error: 'Paste a t.me post link' });

    let added = 0, bad = 0;
    for (const raw of links) {
      const p = parseLink(raw);
      if (!p) { bad++; continue; }
      await env.DB.prepare(
        'INSERT OR IGNORE INTO telegram_posts (id, username, tg_msg_id, link, created_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), p.username, p.id, 'https://t.me/' + p.username + '/' + p.id, new Date().toISOString()).run();
      added++;
    }
    return json({ ok: true, added, bad });
  } catch (err) { return json({ ok: true, added: 0, error: err.message }); }
}

// DELETE ?id= → remove one (owner/super only).
export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isSuperOrOwner(user, env.OWNER_EMAIL)) return json({ ok: true, error: 'Forbidden' });
    await ensureTable(env);
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return json({ ok: true, error: 'id required' });
    await env.DB.prepare('DELETE FROM telegram_posts WHERE id = ?').bind(id).run();
    return json({ ok: true });
  } catch (err) { return json({ ok: true, error: err.message }); }
}
