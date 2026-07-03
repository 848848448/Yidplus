// functions/api/chat/stickers.js
// GET    /api/chat/stickers            -> list custom stickers (own + everyone's, newest first)
// POST   /api/chat/stickers            -> upload a new custom sticker (multipart: file)
// DELETE /api/chat/stickers?id=X       -> delete your own custom sticker (or any, if admin)

import { json, corsHeaders, requireUser, isAdminRole } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const { results } = await env.DB.prepare(
      `SELECT id, owner_id, media_key, created_at FROM custom_stickers
       ORDER BY created_at DESC LIMIT 100`
    ).all().catch(() => ({ results: [] }));

    const stickers = results.map(s => ({
      id: s.id,
      owner_id: s.owner_id,
      url: `/api/media/${encodeURIComponent(s.media_key)}`,
      created_at: s.created_at,
    }));
    return json({ ok: true, stickers });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file !== 'object' || !file.arrayBuffer) {
      return json({ ok: false, error: 'file is required' }, 400);
    }
    if (!file.type || !file.type.startsWith('image/')) {
      return json({ ok: false, error: 'Stickers must be an image' }, 400);
    }

    const ext = (file.name && file.name.includes('.')) ? file.name.split('.').pop() : 'png';
    const mediaKey = `stickers/${user.id}/${Date.now()}_${crypto.randomUUID()}.${ext}`;
    await env.MY_BUCKET.put(mediaKey, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    });

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      await env.DB.prepare(
        `INSERT INTO custom_stickers (id, owner_id, media_key, created_at) VALUES (?, ?, ?, ?)`
      ).bind(id, user.id, mediaKey, now).run();
    } catch (e) {
      return json({ ok: false, error: 'Custom stickers are not migrated yet on the server.' }, 500);
    }

    return json({ ok: true, sticker: { id, owner_id: user.id, url: `/api/media/${encodeURIComponent(mediaKey)}`, created_at: now } });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return json({ ok: false, error: 'id is required' }, 400);

    const sticker = await env.DB.prepare('SELECT owner_id FROM custom_stickers WHERE id = ?').bind(id).first();
    if (!sticker) return json({ ok: false, error: 'Sticker not found' }, 404);
    if (sticker.owner_id !== user.id && !isAdminRole(user, env.OWNER_EMAIL)) {
      return json({ ok: false, error: 'Forbidden' }, 403);
    }

    await env.DB.prepare('DELETE FROM custom_stickers WHERE id = ?').bind(id).run();
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
