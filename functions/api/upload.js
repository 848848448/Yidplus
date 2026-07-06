// functions/api/upload.js
// POST /api/upload  (multipart/form-data: file, folder?)
// Uploads to R2 MY_BUCKET, returns { key, url }

import { json, corsHeaders, requireUser } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const form = await request.formData();
    const file = form.get('file');
    const folder = (form.get('folder') || 'misc').toString().replace(/[^a-z0-9_-]/gi, '');

    if (!file || typeof file !== 'object' || !file.arrayBuffer) {
      return json({ ok: false, error: 'file is required' }, 400);
    }

    // Size cap — protects against runaway R2 storage costs and abuse.
    const MAX_BYTES = 100 * 1024 * 1024; // 100MB
    if (file.size > MAX_BYTES) {
      return json({ ok: false, error: 'File too large (max 100MB)' }, 413);
    }

    // Only real media types are allowed. This is a stored-XSS defense, not
    // just tidiness: /api/media/ serves uploads back from the app's OWN
    // origin with the stored content type — an uploaded .html (or SVG,
    // which can carry scripts) would execute as a page on yidplus.com and
    // could call the API as whoever opened it.
    const ALLOWED_EXT = ['jpg','jpeg','png','gif','webp','avif','heic','mp4','webm','mov','m4v','mp3','m4a','aac','wav','ogg','opus'];
    const rawExt = (file.name && file.name.includes('.')) ? file.name.split('.').pop().toLowerCase() : '';
    const ext = ALLOWED_EXT.includes(rawExt) ? rawExt : null;
    const type = (file.type || '').toLowerCase();
    const typeOk = type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/');
    if (!ext || !typeOk || type === 'image/svg+xml') {
      return json({ ok: false, error: 'Only image, video, and audio files are allowed' }, 415);
    }

    const key = `${folder}/${user.id}/${Date.now()}_${crypto.randomUUID()}.${ext}`;

    await env.MY_BUCKET.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: type },
    });

    return json({ ok: true, key, url: `/api/media/${encodeURIComponent(key)}` }, 201);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
