// functions/api/chat/stickers.js
// GET    /api/chat/stickers            -> list custom stickers (own + everyone's, newest first)
// POST   /api/chat/stickers            -> upload a new custom sticker (multipart: file)
// DELETE /api/chat/stickers?id=X       -> delete your own custom sticker (or any, if admin)

import { json, corsHeaders, requireUser, isAdminRole } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

// The custom_stickers table was never created anywhere, so every upload hit
// the "not migrated yet" error and the feature did nothing. Create it (and its
// indexes) on first use, once per isolate.
let _stickersReady = false;
async function ensureStickersTable(env) {
  if (_stickersReady) return;
  _stickersReady = true;
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS custom_stickers (id TEXT PRIMARY KEY, owner_id TEXT, media_key TEXT, created_at TEXT)`
    ).run().catch(() => {});
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_custom_stickers_created ON custom_stickers(created_at)').run().catch(() => {});
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_custom_stickers_owner ON custom_stickers(owner_id)').run().catch(() => {});
  } catch (e) { _stickersReady = false; }
}

// Map a sticker file extension to a content-type, so WhatsApp .webp (including
// animated) is stored and served correctly even when the browser doesn't
// report file.type on the picked file.
const STICKER_CT = {
  webp: 'image/webp', gif: 'image/gif', png: 'image/png', apng: 'image/apng',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', avif: 'image/avif', bmp: 'image/bmp',
  heic: 'image/heic', heif: 'image/heif',
};

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    await ensureStickersTable(env);

    const { results } = await env.DB.prepare(
      `SELECT id, owner_id, media_key, created_at FROM custom_stickers
       ORDER BY (owner_id = ?) DESC, created_at DESC LIMIT 200`
    ).bind(user.id).all().catch(() => ({ results: [] }));

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
    await ensureStickersTable(env);

    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file !== 'object' || !file.arrayBuffer) {
      return json({ ok: false, error: 'file is required' }, 400);
    }
    // Accept by MIME *or* extension: WhatsApp .webp files picked on some
    // devices arrive with an empty file.type, which the old check rejected.
    const nm = (file.name || '').toLowerCase();
    const typeIsImage = !!file.type && file.type.startsWith('image/');
    const extMatch = /\.(webp|png|gif|apng|jpe?g|avif|bmp|heic|heif)$/i.test(nm);
    if (!typeIsImage && !extMatch) {
      return json({ ok: false, error: 'Stickers must be an image (webp, png, gif or jpg).' }, 400);
    }
    if (file.size > 3 * 1024 * 1024) {
      return json({ ok: false, error: 'Sticker is too large (max 3MB).' }, 413);
    }

    let ext = nm.includes('.') ? nm.split('.').pop().replace(/[^a-z0-9]/g, '') : '';
    if (!ext || ext.length > 5) {
      const t = (file.type || '').toLowerCase();
      ext = t.includes('webp') ? 'webp' : t.includes('gif') ? 'gif' : t.includes('png') ? 'png'
          : t.includes('jpeg') ? 'jpg' : t.includes('avif') ? 'avif' : 'png';
    }
    const contentType = typeIsImage ? file.type : (STICKER_CT[ext] || 'image/png');
    const mediaKey = `stickers/${user.id}/${Date.now()}_${crypto.randomUUID()}.${ext}`;
    await env.MY_BUCKET.put(mediaKey, await file.arrayBuffer(), {
      httpMetadata: { contentType: contentType },
    });

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      await env.DB.prepare(
        `INSERT INTO custom_stickers (id, owner_id, media_key, created_at) VALUES (?, ?, ?, ?)`
      ).bind(id, user.id, mediaKey, now).run();
    } catch (e) {
      return json({ ok: false, error: 'Could not save sticker: ' + e.message }, 500);
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
    await ensureStickersTable(env);

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
