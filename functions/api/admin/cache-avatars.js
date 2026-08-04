// functions/api/admin/cache-avatars.js
// Owner-only. Downloads users' external avatar URLs (WhatsApp/FB/Instagram/
// Telegram CDNs that expire) into R2 and rewrites photo_url to a stable
// /api/media/… link. Processes a batch per call so it never times out; call
// repeatedly until { remaining: 0 }.

import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';

// Any avatar hosted off-site (Google/Gmail, WhatsApp, Telegram, Facebook, or
// any other company) — i.e. a full http(s) URL that isn't already one of our
// own /api/media/ links. These are what we pull into R2 so they never expire.
const EXTERNAL = "photo_url LIKE 'http%' AND photo_url NOT LIKE '%/api/media/%'";

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Owner only' }, 403);
    const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS c FROM users WHERE ${EXTERNAL}`).first().catch(() => ({ c: 0 }));
    return json({ ok: true, remaining: (totalRow && totalRow.c) || 0 });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Owner only' }, 403);
    if (!env.MY_BUCKET) return json({ ok: false, error: 'No storage bucket' }, 500);

    const { results } = await env.DB.prepare(
      `SELECT id, photo_url FROM users WHERE ${EXTERNAL} LIMIT 12`
    ).all().catch(() => ({ results: [] }));

    let cached = 0, failed = 0;
    for (const u of (results || [])) {
      try {
        // WhatsApp/Telegram URLs may arrive HTML-escaped — normalise.
        const src = String(u.photo_url).replace(/&amp;/g, '&');
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 6000);
        const resp = await fetch(src, { signal: ac.signal }).catch(() => null);
        clearTimeout(timer);
        if (!resp || !resp.ok) {
          // Dead/expired link — clear it so the initial-letter avatar shows and
          // we stop retrying it forever.
          await env.DB.prepare(`UPDATE users SET photo_url = NULL WHERE id = ?`).bind(u.id).run().catch(() => {});
          failed++;
          continue;
        }
        const ct = (resp.headers.get('content-type') || 'image/jpeg').split(';')[0];
        const ext = ct.indexOf('png') !== -1 ? 'png' : ct.indexOf('webp') !== -1 ? 'webp' : 'jpg';
        const bytes = new Uint8Array(await resp.arrayBuffer());
        if (!bytes.length || bytes.length > 5 * 1024 * 1024) { // sanity cap
          await env.DB.prepare(`UPDATE users SET photo_url = NULL WHERE id = ?`).bind(u.id).run().catch(() => {});
          failed++;
          continue;
        }
        const key = `user-avatars/${u.id}_${Date.now()}.${ext}`;
        await env.MY_BUCKET.put(key, bytes, { httpMetadata: { contentType: ct } });
        const url = '/api/media/' + key;
        await env.DB.prepare(`UPDATE users SET photo_url = ? WHERE id = ?`).bind(url, u.id).run();
        cached++;
      } catch (e) {
        try { await env.DB.prepare(`UPDATE users SET photo_url = NULL WHERE id = ?`).bind(u.id).run(); } catch (_) {}
        failed++;
      }
    }

    const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS c FROM users WHERE ${EXTERNAL}`).first().catch(() => ({ c: 0 }));
    return json({ ok: true, cached, failed, remaining: (totalRow && totalRow.c) || 0 });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
