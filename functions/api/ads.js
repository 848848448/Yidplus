// functions/api/ads.js
// GET /api/ads -> list active ads only, for the home page ad rotator (public)

import { json, corsHeaders } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const { results } = await env.DB.prepare(
      `SELECT id, title, subtitle, media_key, link_url FROM ads
       WHERE active = 1 ORDER BY sort_order ASC, created_at DESC LIMIT 20`
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
