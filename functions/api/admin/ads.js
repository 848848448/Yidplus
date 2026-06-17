// functions/api/admin/ads.js
// GET    /api/admin/ads        -> list all ads (admin view, includes inactive)
// POST   /api/admin/ads        -> multipart { title, subtitle, link_url, media } create ad (Super Admin)
// PUT    /api/admin/ads        -> { id, active } toggle active (Super Admin)
// DELETE /api/admin/ads?id=xxx -> delete ad (Super Admin)

import { json, corsHeaders, requireUser, isSuperOrOwner } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isSuperOrOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const { results } = await env.DB.prepare(
      `SELECT id, title, subtitle, media_key, link_url, active, sort_order, created_at
       FROM ads ORDER BY sort_order ASC, created_at DESC`
    ).all();

    const out = results.map(a => ({
      ...a,
      media_url: a.media_key ? `/api/media/${encodeURIComponent(a.media_key)}` : null,
    }));

    return json({ ok: true, ads: out });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isSuperOrOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const form = await request.formData();
    const title = (form.get('title') || '').toString().trim();
    const subtitle = (form.get('subtitle') || '').toString();
    const linkUrl = (form.get('link_url') || '').toString();
    const media = form.get('media');

    if (!title) return json({ ok: false, error: 'title is required' }, 400);

    let mediaKey = null;
    if (media && typeof media === 'object' && media.arrayBuffer) {
      const ext = (media.name && media.name.includes('.')) ? media.name.split('.').pop() : 'jpg';
      mediaKey = `ads/${Date.now()}_${crypto.randomUUID()}.${ext}`;
      await env.MY_BUCKET.put(mediaKey, await media.arrayBuffer(), {
        httpMetadata: { contentType: media.type || 'application/octet-stream' },
      });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO ads (id, title, subtitle, media_key, link_url, active, sort_order, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)`
    ).bind(id, title, subtitle, mediaKey, linkUrl, user.id, now).run();

    return json({ ok: true, id }, 201);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isSuperOrOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const body = await request.json();
    if (!body.id) return json({ ok: false, error: 'id is required' }, 400);

    if (typeof body.active === 'boolean') {
      await env.DB.prepare(`UPDATE ads SET active = ? WHERE id = ?`).bind(body.active ? 1 : 0, body.id).run();
    }
    if (typeof body.sort_order === 'number') {
      await env.DB.prepare(`UPDATE ads SET sort_order = ? WHERE id = ?`).bind(body.sort_order, body.id).run();
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isSuperOrOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return json({ ok: false, error: 'id is required' }, 400);

    const row = await env.DB.prepare(`SELECT media_key FROM ads WHERE id = ?`).bind(id).first();
    if (row && row.media_key) await env.MY_BUCKET.delete(row.media_key);

    await env.DB.prepare(`DELETE FROM ads WHERE id = ?`).bind(id).run();
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
      }
