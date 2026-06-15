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

    const ext = (file.name && file.name.includes('.')) ? file.name.split('.').pop() : 'bin';
    const key = `${folder}/${user.id}/${Date.now()}_${crypto.randomUUID()}.${ext}`;

    await env.MY_BUCKET.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
    });

    return json({ ok: true, key, url: `/api/media/${encodeURIComponent(key)}` }, 201);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
