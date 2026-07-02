// functions/api/admin/ads.js
import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const { results } = await env.DB.prepare(
      `SELECT id, title, subtitle, media_key, link_url, email_url, active, sort_order,
              interval_minutes, countdown_seconds, pages, exempt_users, created_at
       FROM ads ORDER BY sort_order ASC, created_at DESC`
    ).all().catch(async () => {
      // fallback if new columns don't exist yet
      const r = await env.DB.prepare(`SELECT id, title, subtitle, media_key, link_url, active, sort_order, created_at FROM ads ORDER BY sort_order ASC, created_at DESC`).all();
      return r;
    });

    const out = results.map(a => ({
      ...a,
      interval_minutes:  a.interval_minutes  ?? 60,
      countdown_seconds: a.countdown_seconds ?? 5,
      pages:             a.pages             ?? 'all',
      exempt_users:      a.exempt_users       ?? '[]',
      email_url:         a.email_url          ?? '',
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
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

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

    // Try with new columns first, fall back to basic insert
    try {
      await env.DB.prepare(
        `INSERT INTO ads (id, title, subtitle, media_key, link_url, email_url,
           interval_minutes, countdown_seconds, pages, exempt_users,
           active, sort_order, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`
      ).bind(id, title, subtitle, mediaKey, link_url, email_url,
             interval_minutes, countdown_seconds, pages, exempt_users,
             user.id, now).run();
    } catch (e) {
      // New columns don't exist yet — use basic insert
      await env.DB.prepare(
        `INSERT INTO ads (id, title, subtitle, media_key, link_url, active, sort_order, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)`
      ).bind(id, title, subtitle, mediaKey, link_url, user.id, now).run();
    }

    return json({ ok: true, id });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const body = await request.json();
    if (!body.id) return json({ ok: false, error: 'id is required' }, 400);

    const updates = [];
    const params  = [];

    if (typeof body.active === 'boolean')     { updates.push('active = ?');             params.push(body.active ? 1 : 0); }
    if (body.sort_order !== undefined)         { updates.push('sort_order = ?');         params.push(body.sort_order); }
    if (body.interval_minutes !== undefined)   { updates.push('interval_minutes = ?');   params.push(body.interval_minutes); }
    if (body.countdown_seconds !== undefined)  { updates.push('countdown_seconds = ?');  params.push(body.countdown_seconds); }
    if (body.pages !== undefined)              { updates.push('pages = ?');              params.push(body.pages); }
    if (body.exempt_users !== undefined)       { updates.push('exempt_users = ?');       params.push(JSON.stringify(body.exempt_users)); }

    if (updates.length) {
      params.push(body.id);
      await env.DB.prepare(`UPDATE ads SET ${updates.join(', ')} WHERE id = ?`)
        .bind(...params).run().catch(() => {});
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
    if (!user || !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

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
