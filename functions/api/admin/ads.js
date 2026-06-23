// functions/api/admin/ads.js
// GET    -> list all ads (admin)
// POST   -> create ad (multipart: title, subtitle, link_url, email_url, interval_minutes, countdown_seconds, pages, media?)
// PUT    -> update ad settings or toggle active
// DELETE -> delete ad
import { json, corsHeaders, requireUser, isSuperOrOwner } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isSuperOrOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const { results } = await env.DB.prepare(
      `SELECT id, title, subtitle, media_key, link_url, email_url, active, sort_order,
              interval_minutes, countdown_seconds, pages, exempt_users, created_at
       FROM ads ORDER BY sort_order ASC, created_at DESC`
    ).all();

    const out = results.map(a => ({
      ...a,
      media_url: a.media_key ? `/api/media/${encodeURIComponent(a.media_key)}` : null,
      is_video: a.media_key ? /\.(mp4|webm|mov)$/i.test(a.media_key) : false,
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
    if (!user || !isSuperOrOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const form = await request.formData();
    const title             = form.get('title') || '';
    const subtitle          = form.get('subtitle') || '';
    const link_url          = form.get('link_url') || '';
    const email_url         = form.get('email_url') || '';
    const interval_minutes  = parseInt(form.get('interval_minutes') || '60', 10);
    const countdown_seconds = parseInt(form.get('countdown_seconds') || '5', 10);
    const pages             = form.get('pages') || 'all';
    const exempt_users      = form.get('exempt_users') || '[]';
    const media             = form.get('media');

    let mediaKey = null;
    if (media && typeof media === 'object' && media.arrayBuffer) {
      const ext = (media.name || 'jpg').split('.').pop();
      mediaKey = `ads/${Date.now()}_${crypto.randomUUID()}.${ext}`;
      await env.MY_BUCKET.put(mediaKey, await media.arrayBuffer(), {
        httpMetadata: { contentType: media.type || 'image/jpeg' },
      });
    }

    const id  = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO ads (id, title, subtitle, media_key, link_url, email_url,
         interval_minutes, countdown_seconds, pages, exempt_users,
         active, sort_order, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`
    ).bind(id, title, subtitle, mediaKey, link_url, email_url,
           interval_minutes, countdown_seconds, pages, exempt_users,
           user.id, now).run();

    return json({ ok: true, id });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isSuperOrOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const body = await request.json();
    if (!body.id) return json({ ok: false, error: 'id is required' }, 400);

    if (typeof body.active === 'boolean') {
      await env.DB.prepare(`UPDATE ads SET active = ? WHERE id = ?`).bind(body.active ? 1 : 0, body.id).run();
    }
    if (body.sort_order !== undefined) {
      await env.DB.prepare(`UPDATE ads SET sort_order = ? WHERE id = ?`).bind(body.sort_order, body.id).run();
    }
    if (body.interval_minutes !== undefined) {
      await env.DB.prepare(`UPDATE ads SET interval_minutes = ? WHERE id = ?`).bind(body.interval_minutes, body.id).run();
    }
    if (body.countdown_seconds !== undefined) {
      await env.DB.prepare(`UPDATE ads SET countdown_seconds = ? WHERE id = ?`).bind(body.countdown_seconds, body.id).run();
    }
    if (body.pages !== undefined) {
      await env.DB.prepare(`UPDATE ads SET pages = ? WHERE id = ?`).bind(body.pages, body.id).run();
    }
    if (body.exempt_users !== undefined) {
      await env.DB.prepare(`UPDATE ads SET exempt_users = ? WHERE id = ?`)
        .bind(JSON.stringify(body.exempt_users), body.id).run();
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
    if (!user || !isSuperOrOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return json({ ok: false, error: 'id required' }, 400);

    const row = await env.DB.prepare(`SELECT media_key FROM ads WHERE id = ?`).bind(id).first();
    if (row && row.media_key) await env.MY_BUCKET.delete(row.media_key).catch(() => {});
    await env.DB.prepare(`DELETE FROM ads WHERE id = ?`).bind(id).run();

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
                                       }
