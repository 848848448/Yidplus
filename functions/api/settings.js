// functions/api/settings.js
// GET /api/settings              -> { ok, settings: { key: value, ... } } — all public app settings
// PUT /api/settings { key, value } -> upsert one setting (Owner / Super Admin only)
// PUT /api/settings (multipart: key, file) -> upload a file (e.g. logo) to R2 and save its URL as the setting value

import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from './_helpers.js';
import { activateDueScheduledBroadcasts } from './_scheduled.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { env } = context;
  try {
    // Lazy scheduler tick — publishes any due scheduled broadcasts. Throttled
    // internally and fully guarded, so it never affects the settings response.
    context.waitUntil ? context.waitUntil(activateDueScheduledBroadcasts(env)) : await activateDueScheduledBroadcasts(env);
    const { results } = await env.DB.prepare(`SELECT key, value FROM app_settings`).all();
    const settings = {};
    for (const row of results) settings[row.key] = row.value;
    return json({ ok: true, settings });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) {
      return json({ ok: false, error: 'Only the Owner can change app settings' }, 403);
    }

    const contentType = request.headers.get('content-type') || '';
    let key, value;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      key = form.get('key');
      const file = form.get('file');
      if (!key || !file || typeof file !== 'object' || !file.arrayBuffer) {
        return json({ ok: false, error: 'key and file are required' }, 400);
      }
      const ext = (file.name && file.name.includes('.')) ? file.name.split('.').pop() : 'png';
      const objectKey = `app-settings/${key}-${Date.now()}.${ext}`;
      await env.MY_BUCKET.put(objectKey, await file.arrayBuffer(), {
        httpMetadata: { contentType: file.type || 'image/png' },
      });
      value = `/api/media/${encodeURIComponent(objectKey)}`;
    } else {
      const body = await request.json();
      key = body.key;
      value = body.value;
      if (!key) return json({ ok: false, error: 'key is required' }, 400);
    }

    await env.DB.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).bind(key, String(value), new Date().toISOString()).run();

    return json({ ok: true, key, value });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
  }
